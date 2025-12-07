/* eslint-disable @typescript-eslint/no-explicit-any */
// SignalRClient.ts
// A zero-dependency shim that provides:
// 1. Microsoft SignalR compatibility (HubConnection, HubConnectionBuilder, Enums)
// 2. A simplified, GENERIC TinySignalRClient class
// 3. Robust connection resilience (Auto-reconnect, Negotiation, Keep-Alive)

// -------------------------------------------------------------------------
// 2. Microsoft SignalR Enums
// -------------------------------------------------------------------------
export enum LogLevel {
    Trace = 0,
    Debug = 1,
    Information = 2,
    Warning = 3,
    Error = 4,
    Critical = 5,
    None = 6,
}

export interface IHttpConnectionOptions {
    skipNegotiation?: boolean;
    accessTokenFactory?: () => string | Promise<string>;
    // Params specific to the WebSocket connection url (not sent to negotiate)
    webSocketQueryParams?: Record<string, string>; 
}

// -------------------------------------------------------------------------
// 3. The Engine: HubConnection
// -------------------------------------------------------------------------
export class HubConnection {
    public connectionId: string | null = null;
    public baseUrl: string;
    public apiKey: string;
    public group: string;

    private socket: WebSocket | null = null;
    private listeners = new Map<string, Array<(...args: any[]) => void>>();
    private invocationId = 0;
    private pendingInvocations = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();
    private keepAliveInterval: any;
    
    // State
    private isStopped = true; 
    private options: IHttpConnectionOptions;
    private reconnectDelays: number[] = [0, 2000, 5000, 10000, 30000];
    private logLevel: LogLevel = LogLevel.Information;

    // Callbacks
    private onReconnectingCallbacks: Array<(error?: Error) => void> = [];
    private onReconnectedCallbacks: Array<(connectionId?: string) => void> = [];
    private onCloseCallbacks: Array<(error?: Error) => void> = [];

    constructor(url: string, apiKey: string, group: string, options: IHttpConnectionOptions) {
        this.baseUrl = url;
        this.apiKey = apiKey;
        this.group = group;
        this.options = options;
    }

    // --- Public API ---

    public async start(): Promise<void> {
        this.isStopped = false;
        await this.connectInternal();
    }

    public async stop(): Promise<void> {
        this.isStopped = true;
        this.cleanup();
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
    }

    public on(methodName: string, newMethod: (...args: any[]) => void): void {
        const key = methodName.toLowerCase();
        if (!this.listeners.has(key)) {
            this.listeners.set(key, []);
        }
        this.listeners.get(key)?.push(newMethod);
    }

    public off(methodName: string, method: (...args: any[]) => void): void {
        const key = methodName.toLowerCase();
        const handlers = this.listeners.get(key);
        if (handlers) {
            this.listeners.set(key, handlers.filter(h => h !== method));
        }
    }

    /**
     * Invokes a hub method on the server.
     * The caller is responsible for passing the correct number and type of arguments.
     */
    public invoke(methodName: string, ...args: any[]): Promise<any> {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error(`Cannot invoke '${methodName}': Socket is not open.`));
        }

        this.invocationId++;
        const invId = this.invocationId.toString();

        const packet = {
            type: 1,
            target: methodName,
            arguments: args, // Arrays/Objects passed here are serialized automatically
            invocationId: invId
        };

        return new Promise((resolve, reject) => {
            // 30s timeout default
            const tm = setTimeout(() => {
                if (this.pendingInvocations.has(invId)) {
                    this.pendingInvocations.delete(invId);
                    reject(new Error(`Invocation '${methodName}' timed out.`));
                }
            }, 30000);

            this.pendingInvocations.set(invId, {
                resolve: (val) => { clearTimeout(tm); resolve(val); },
                reject: (err) => { clearTimeout(tm); reject(err); }
            });

            this.socket?.send(JSON.stringify(packet) + '\x1e');
        });
    }

    // --- Configuration & Events ---
    public onreconnecting(cb: (error?: Error) => void) { this.onReconnectingCallbacks.push(cb); }
    public onreconnected(cb: (id?: string) => void) { this.onReconnectedCallbacks.push(cb); }
    public onclose(cb: (error?: Error) => void) { this.onCloseCallbacks.push(cb); }
    public _setReconnectDelays(delays: number[]) { this.reconnectDelays = delays; }
    public _setLogLevel(level: LogLevel) { this.logLevel = level; }

    // --- Core Logic ---

    private async connectInternal(isReconnect = false): Promise<void> {
        let finalUrl = this.baseUrl;
        let accessToken = '';

        if (this.options.accessTokenFactory) {
            try { accessToken = await this.options.accessTokenFactory(); } 
            catch (e) { console.error("Error getting access token:", e); }
        }

        // 1. Negotiate (Base URL only)
        if (!this.options.skipNegotiation) {
            //const negotiateUrl = this.resolveNegotiateUrl(this.baseUrl);
            var negotiateUrl = `${this.baseUrl}/negotiate?apiKey=${encodeURIComponent(this.apiKey)}`;
            if (this.group) {
                negotiateUrl += `&group=${encodeURIComponent(this.group)}`;
            }        
    
            try {
                const headers: any = {};
                if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

                const response = await fetch(negotiateUrl, { method: 'POST', headers });
                if (!response.ok) throw new Error(`Negotiate failed: ${response.status} ${response.statusText}`);

                // Cast response to known shape
                const negotiation = (await response.json()) as { 
                    url?: string; 
                    accessToken?: string; 
                    connectionId?: string; 
                };

                // 2. Construct WebSocket URL
                let wsUrl = "";

                if (negotiation.url) {
                    // SCENARIO A: Azure SignalR or Server Redirect
                    // The server gave us a specific URL to connect to.
                    wsUrl = negotiation.url.replace(/^http/, "ws");
                } else {
                    // SCENARIO B: Local / Standard SignalR
                    // The server gave us an ID, we must connect to the BASE Hub URL.
                    wsUrl = this.baseUrl.replace(/^http/, "ws");
                    
                    // Attach the connection ID so the server knows who we are
                    if (negotiation.connectionId) {
                        wsUrl += (wsUrl.indexOf("?") < 0 ? "?" : "&") + `id=${encodeURIComponent(negotiation.connectionId)}`;
                    }
                }
                this.log(LogLevel.Information, "WS URL:", wsUrl);
                
                const neg = negotiation;
                
                if (neg.url) {
                    finalUrl = neg.url;
                    if (neg.accessToken) accessToken = neg.accessToken;
                } else if (neg.connectionId) {
                    this.connectionId = neg.connectionId;
                    const symbol = finalUrl.indexOf('?') === -1 ? '?' : '&';
                    finalUrl += `${symbol}id=${neg.connectionId}`;
                }
                this.log(LogLevel.Information, "finalUrl:", finalUrl);

            } catch (e: any) {
                //this.log(LogLevel.Error, 'Negotiation failed', e);
                throw e; 
            }
        }
        this.log(LogLevel.Information, finalUrl);

        // 2. Construct WebSocket URL
        let wsUrl = finalUrl.replace(/^http/, 'ws');
        
        if (accessToken) {
            const symbol = wsUrl.indexOf('?') === -1 ? '?' : '&';
            wsUrl += `${symbol}access_token=${encodeURIComponent(accessToken)}`;
        }

        // Apply WebSocket-specific params (like 'group')
        if (this.options.webSocketQueryParams) {
            for (const [key, value] of Object.entries(this.options.webSocketQueryParams)) {
                const symbol = wsUrl.indexOf('?') === -1 ? '?' : '&';
                wsUrl += `${symbol}${key}=${encodeURIComponent(value)}`;
            }
        }

        // 3. Connect Socket
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            this.socket = ws;

            ws.onopen = () => {
                this.log(LogLevel.Debug, 'WebSocket Connected. Sending Handshake.');
                ws.send(`{"protocol":"json","version":1}\x1e`);
            };

            ws.onerror = (e: any) => {
                const msg = e.message || "WebSocket Error";
                // Don't reject if we are just reconnecting automatically
                if (!isReconnect && !this.connectionId) {
                    // Try to provide a hint if it's the generic non-101 error
                    if (msg.includes('non-101')) {
                        reject(new Error(`${msg} (See logs above for Status Code)`));
                    } else {
                        reject(new Error(msg));
                    }
                } else {
                    this.log(LogLevel.Error, msg);
                }
            };

            ws.onclose = (e) => {
                this.cleanup();
                this.log(LogLevel.Information, `WebSocket Closed. Code: ${e.code} Reason: ${e.reason}`);
                if (this.isStopped) this.fireCloseCallbacks();
                else this.handleAutomaticReconnect();
            };

            ws.onmessage = (event) => {
                this.handleRawMessage(event, () => {
                    this.startKeepAlive();
                    if (isReconnect) this.fireReconnectedCallbacks();
                    resolve();
                });
            };
        });
    }

    private async handleAutomaticReconnect() {
        if (!this.reconnectDelays.length) {
            this.fireCloseCallbacks(new Error('Connection dropped'));
            return;
        }
        this.fireReconnectingCallbacks(new Error('Reconnecting...'));

        for (const delay of this.reconnectDelays) {
            if (this.isStopped) return;
            this.log(LogLevel.Information, `Reconnecting in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));

            try {
                await this.connectInternal(true);
                return;
            } catch (e) {
                this.log(LogLevel.Warning, 'Reconnect attempt failed.');
            }
        }
        this.isStopped = true;
        this.fireCloseCallbacks(new Error('All reconnect attempts failed.'));
    }

    private handleRawMessage(event: any, onHandshake: () => void) {
        const raw = event.data.toString();
        const messages = raw.split('\x1e');

        for (const msg of messages) {
            if (!msg) continue;
            if (msg === '{}') { onHandshake(); continue; }
            try {
                const data = JSON.parse(msg);
                if (data.type === 1) { 
                    const target = (data.target || '').toLowerCase();
                    const handlers = this.listeners.get(target);
                    handlers?.forEach(h => h(...(data.arguments || [])));
                } else if (data.type === 3) {
                    const p = this.pendingInvocations.get(data.invocationId);
                    if (p) {
                        this.pendingInvocations.delete(data.invocationId);
                        if (data.error) p.reject(new Error(data.error));
                        else p.resolve(data.result);
                    }
                }
            } catch (err) { this.log(LogLevel.Error, 'Error parsing message', err); }
        }
    }

    // private resolveNegotiateUrl(url: string): string {
    //     const index = url.indexOf('?');
    //     let base = url;
    //     let query = '';

    //     // Separate the Base URL (Path) from the Query String
    //     if (index !== -1) {
    //         base = url.substring(0, index);
    //         query = url.substring(index);
    //     }

    //     // Append /negotiate to the path
    //     base = base.replace(/\/$/, '') + '/negotiate';

    //     // Reconstruct: Path/negotiate + Original Query + Negotiate Version
    //     let u = base + query;
    //     // u += (u.indexOf('?') === -1 ? '?' : '&') + 'negotiateVersion=1';
    //     // u += "&group=mediasix%2Fworkflow-test";
    //     u += "&group=" + this.group;
    //     return u;
    // }

    private startKeepAlive() {
        clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = setInterval(() => {
            if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(`{"type":6}\x1e`);
        }, 15000);
    }

    private cleanup() {
        clearInterval(this.keepAliveInterval);
        this.pendingInvocations.forEach(p => p.reject(new Error('Connection closed')));
        this.pendingInvocations.clear();
    }

    private fireReconnectingCallbacks(err?: Error)
    {
        this.onReconnectingCallbacks.forEach(cb => { try { cb(err); } catch {} });
    }

    private fireReconnectedCallbacks() 
    {
        const id = this.connectionId || undefined; 
        this.onReconnectedCallbacks.forEach(cb => { try { cb(id); } catch {} }); 
    }
    
    private fireCloseCallbacks(err?: Error) 
    {
         this.onCloseCallbacks.forEach(cb => { try { cb(err); } catch {} }); 
    }
    
    private log(level: LogLevel, msg: string, ...args: any[]) {
        if (level >= this.logLevel) {
            const prefix = `[${new Date().toISOString()}]`;
            if (level >= LogLevel.Error) console.error(prefix, msg, ...args);
            else console.log(prefix, msg, ...args);
        }
    }
}

// -------------------------------------------------------------------------
// 4. HubConnectionBuilder
// -------------------------------------------------------------------------
export class HubConnectionBuilder {
    private url = '';
    private apiKey = '';
    private group = '';
    private options: IHttpConnectionOptions = {};
    private reconnectDelays = [0, 2000, 2000, 2000, 5000, 5000, 5000, 10000, 10000, 10000];
    private logLevel = LogLevel.Information;

    public withUrl(url: string, options?: IHttpConnectionOptions): this {
        this.url = url;
        if (options) this.options = options;
        return this;
    }
    public withApiKey(apiKey: string): this {
        this.apiKey = apiKey;
        return this;
    }
    public withGroup(group: string): this {
        this.group = group;
        return this;
    }
    public withAutomaticReconnect(retryDelays?: number[]): this {
        if (retryDelays) this.reconnectDelays = retryDelays;
        return this;
    }
    public configureLogging(logLevel: LogLevel): this {
        this.logLevel = logLevel;
        return this;
    }
    public build(): HubConnection {
        if (!this.url) throw new Error('HubConnectionBuilder.withUrl is required.');
        const conn = new HubConnection(this.url, this.apiKey, this.group, this.options);
        conn._setReconnectDelays(this.reconnectDelays);
        conn._setLogLevel(this.logLevel);
        return conn;
    }
}

// -------------------------------------------------------------------------
// 5. TinySignalRClient (Simplified Generic Wrapper)
// -------------------------------------------------------------------------
export class SignalRClient {
    private connection: HubConnection;

    constructor(hubUrl: string, apiKey: string, hubPath: string) {
        
        // 1. Construct Base URL (for Negotiate)
        let baseUrl = hubUrl;
        const sym = baseUrl.indexOf('?') === -1 ? '?' : '&';
        //baseUrl += `${sym}apiKey=${encodeURIComponent(apiKey)}`;

        // 2. Prepare WebSocket-only params
        const wsParams: Record<string, string> = {};
        if (hubPath) {
            wsParams['group'] = hubPath;
        }

        this.connection = new HubConnectionBuilder()
            .withUrl(baseUrl, {
                webSocketQueryParams: wsParams
            })
            .withApiKey(apiKey)
            .withGroup(hubPath)
            .withAutomaticReconnect()
            .configureLogging(LogLevel.Information)
            .build();
    }

    public async start(): Promise<void> {
        return this.connection.start();
    }

    public async stop(): Promise<void> {
        return this.connection.stop();
    }

    /**
     * Subscribes to a Hub method.
     * @param methodName The name of the method to listen for.
     * @param callback A function to execute when the method is called.
     */
    public on(methodName: string, callback: (...args: any[]) => void) {
        this.connection.on(methodName, callback);
    }

    /**
     * Sends a message to the Hub.
     * @param methodName The name of the Hub method to invoke.
     * @param args The arguments to pass to the method.
     */
    public async send(methodName: string, ...args: any[]): Promise<any> {
        // Return the promise so the caller can await completion/results if needed
        return this.connection.invoke(methodName, ...args);
    }

    /**
     * Registers a callback to run when the connection is re-established 
     * after being lost. Use this to re-register groups or workflows.
     * @param callback Function to execute. receives the new Connection ID.
     */
    public onReconnected(callback: (connectionId?: string) => void): void {
        this.connection.onreconnected(callback);
    }
}