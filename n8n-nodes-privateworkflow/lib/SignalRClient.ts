/* eslint-disable @typescript-eslint/no-explicit-any */
// SignalRClient.ts
// A zero-dependency shim that provides:
// 1. Microsoft SignalR compatibility (HubConnection, HubConnectionBuilder, Enums)
// 2. A simplified, GENERIC TinySignalRClient class
// 3. Robust connection resilience (Auto-reconnect, Negotiation, Keep-Alive)

// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { setTimeout, clearTimeout, setInterval, clearInterval } from 'node:timers';
import { IN8nHttpHelper } from './N8nHttpHelper';

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

    private isStopped = true;
    private options: IHttpConnectionOptions;
    private reconnectDelays: number[] = [0, 2000, 5000, 10000, 30000];
    private logLevel: LogLevel = LogLevel.Information;
    private http: IN8nHttpHelper;

    // Callbacks
    private onReconnectingCallbacks: Array<(error?: Error) => void> = [];
    private onReconnectedCallbacks: Array<(connectionId?: string) => void> = [];
    private onCloseCallbacks: Array<(error?: Error) => void> = [];

    constructor(url: string, apiKey: string, group: string, options: IHttpConnectionOptions, http: IN8nHttpHelper) {
        this.baseUrl = url;
        this.apiKey = apiKey;
        this.group = group;
        this.options = options;
        this.http = http;
    }

    // ---------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------

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

    public on(methodName: string, handler: (...args: any[]) => void): void {
        const key = methodName.toLowerCase();
        if (!this.listeners.has(key)) this.listeners.set(key, []);
        this.listeners.get(key)!.push(handler);
    }

    public off(methodName: string, handler: (...args: any[]) => void): void {
        const key = methodName.toLowerCase();
        const handlers = this.listeners.get(key);
        if (handlers) {
            this.listeners.set(key, handlers.filter(h => h !== handler));
        }
    }

    /** NEW: expose close events to match Microsoft API */
    public onclose(cb: (error?: Error) => void): void {
        this.onCloseCallbacks.push(cb);
    }

    /** Invoke server hub method */
    public invoke(methodName: string, ...args: any[]): Promise<any> {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error(`Cannot invoke '${methodName}': socket not open.`));
        }

        this.invocationId++;
        const invId = this.invocationId.toString();

        const packet = {
            type: 1,
            target: methodName,
            arguments: args,
            invocationId: invId
        };

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (this.pendingInvocations.has(invId)) {
                    this.pendingInvocations.delete(invId);
                    reject(new Error(`Invocation '${methodName}' timed out.`));
                }
            }, 30000);

            this.pendingInvocations.set(invId, {
                resolve: (value) => { clearTimeout(timeout); resolve(value); },
                reject: (err) => { clearTimeout(timeout); reject(err); }
            });

            this.socket?.send(JSON.stringify(packet) + "\x1e");
        });
    }

    // Lifecycle
    public onreconnecting(cb: (error?: Error) => void) { this.onReconnectingCallbacks.push(cb); }
    public onreconnected(cb: (id?: string) => void) { this.onReconnectedCallbacks.push(cb); }
    public _setReconnectDelays(delays: number[]) { this.reconnectDelays = delays; }
    public _setLogLevel(level: LogLevel) { this.logLevel = level; }

    // ---------------------------------------------------------------------
    // Core connection logic
    // ---------------------------------------------------------------------

    private async connectInternal(isReconnect = false): Promise<void> {
        let finalUrl = this.baseUrl;
        let accessToken = '';

        if (this.options.accessTokenFactory) {
            try { accessToken = await this.options.accessTokenFactory(); }
            catch { /* token factory failed — continue without token */ }
        }

        // ---------------- Negotiate ----------------
        if (!this.options.skipNegotiation) {
            let negotiateUrl = `${this.baseUrl}/negotiate?apiKey=${encodeURIComponent(this.apiKey)}`;
            if (this.group) negotiateUrl += `&group=${encodeURIComponent(this.group)}`;

            const headers: any = {};
            if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

            const negotiation = await this.http.httpRequest({
                method: 'POST',
                url: negotiateUrl,
                headers,
                json: true,
            }) as {
								url?: string;
								accessToken?: string;
								connectionId?: string;
						};
						if (negotiation.url) {
								finalUrl = negotiation.url;
								if (negotiation.accessToken) accessToken = negotiation.accessToken;

						} else if (negotiation.connectionId) {
								this.connectionId = negotiation.connectionId;
								const sep = finalUrl.includes("?") ? "&" : "?";
								finalUrl += `${sep}id=${encodeURIComponent(negotiation.connectionId)}`;
						}
        }

        // ---------------- WebSocket URL ----------------
        let wsUrl = finalUrl.replace(/^http/, "ws");

        if (accessToken) {
            const sep = wsUrl.includes("?") ? "&" : "?";
            wsUrl += `${sep}access_token=${encodeURIComponent(accessToken)}`;
        }

        // Add WebSocket-only query params (group)
        if (this.options.webSocketQueryParams) {
            for (const [k, v] of Object.entries(this.options.webSocketQueryParams)) {
                const sep = wsUrl.includes("?") ? "&" : "?";
                wsUrl += `${sep}${k}=${encodeURIComponent(v)}`;
            }
        }

        // ---------------- WebSocket Connect ----------------
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            this.socket = ws;

            ws.onopen = () => {
                ws.send(`{"protocol":"json","version":1}\x1e`);
            };

            ws.onerror = (e: any) => {
                if (!isReconnect && !this.connectionId) {
                    reject(new Error(e.message || "WebSocket Error"));
                }
                this.log(LogLevel.Error, "WebSocket error", e.message);
            };

            ws.onclose = (e) => {
                this.cleanup();
                if (this.isStopped) {
                    this.fireCloseCallbacks(new Error(e.reason || "Closed"));
                } else {
                    this.handleAutomaticReconnect();
                }
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

    // ---------------------------------------------------------------------
    // Reconnect logic
    // ---------------------------------------------------------------------

    private async handleAutomaticReconnect() {
        this.fireReconnectingCallbacks(new Error("Reconnecting"));

        for (const delay of this.reconnectDelays) {
            if (this.isStopped) return;
            await new Promise(r => setTimeout(r, delay));

            try {
                await this.connectInternal(true);
                return;
            } catch {
                this.log(LogLevel.Warning, "Reconnect failed");
            }
        }

        this.isStopped = true;
        this.fireCloseCallbacks(new Error("All reconnect attempts failed"));
    }

    // ---------------------------------------------------------------------
    // Message handling
    // ---------------------------------------------------------------------

    private handleRawMessage(event: any, onHandshake: () => void) {
        const raw = event.data.toString();
        const chunks = raw.split("\x1e");

        for (const msg of chunks) {
            if (!msg) continue;
            if (msg === "{}") { onHandshake(); continue; }

            try {
                const data = JSON.parse(msg);
                if (data.type === 1) {
                    const target = (data.target || "").toLowerCase();
                    this.listeners.get(target)?.forEach(h => h(...(data.arguments || [])));
                } else if (data.type === 3) {
                    const pending = this.pendingInvocations.get(data.invocationId);
                    if (pending) {
                        this.pendingInvocations.delete(data.invocationId);
                        if (data.error) {
                        pending.reject(new Error(data.error));
                    } else {
                        pending.resolve(data.result);
                    }
                    }
                }
            } catch (err) {
                this.log(LogLevel.Error, "Failed to parse incoming message", err);
            }
        }
    }

    private startKeepAlive() {
        clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = setInterval(() => {
            if (this.socket?.readyState === WebSocket.OPEN) {
                this.socket.send(`{"type":6}\x1e`);
            }
        }, 15000);
    }

    private cleanup() {
        clearInterval(this.keepAliveInterval);
        for (const p of this.pendingInvocations.values()) {
            p.reject(new Error("Connection closed"));
        }
        this.pendingInvocations.clear();
    }

    private fireReconnectingCallbacks(err?: Error) {
        this.onReconnectingCallbacks.forEach(cb => { try { cb(err); } catch { /* callback error suppressed */ } });
    }

    private fireReconnectedCallbacks() {
        const id = this.connectionId || undefined;
        this.onReconnectedCallbacks.forEach(cb => { try { cb(id); } catch { /* callback error suppressed */ } });
    }

    private fireCloseCallbacks(err?: Error) {
        this.onCloseCallbacks.forEach(cb => { try { cb(err); } catch { /* callback error suppressed */ } });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private log(level: LogLevel, _msg: string, ..._args: unknown[]) {
        if (level < this.logLevel) return;
        // Logging is handled by the SignalRPrivateWorkflowClient wrapper.
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
    private reconnectDelays = [0, 2000, 2000, 2000, 5000, 5000, 5000, 10000];
    private logLevel = LogLevel.Information;
    private http!: IN8nHttpHelper;

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

    public withHttpHelper(http: IN8nHttpHelper): this {
        this.http = http;
        return this;
    }

    public withAutomaticReconnect(delays?: number[]): this {
        if (delays) this.reconnectDelays = delays;
        return this;
    }

    public configureLogging(level: LogLevel): this {
        this.logLevel = level;
        return this;
    }

    public build(): HubConnection {
        if (!this.url) throw new Error("HubConnectionBuilder.withUrl(url) is required.");
        if (!this.http) throw new Error("HubConnectionBuilder.withHttpHelper(http) is required.");

        const conn = new HubConnection(this.url, this.apiKey, this.group, this.options, this.http);
        conn._setReconnectDelays(this.reconnectDelays);
        conn._setLogLevel(this.logLevel);
        return conn;
    }
}

// -------------------------------------------------------------------------
// 5. TinySignalRClient wrapper
// -------------------------------------------------------------------------
export class SignalRClient {
    private _connection: HubConnection;

    constructor(hubUrl: string, apiKey: string, hubPath: string, http: IN8nHttpHelper) {
        const wsParams: Record<string, string> = {};
        if (hubPath) wsParams["group"] = hubPath;

        this._connection = new HubConnectionBuilder()
            .withUrl(hubUrl, { webSocketQueryParams: wsParams })
            .withApiKey(apiKey)
            .withGroup(hubPath)
            .withHttpHelper(http)
            .withAutomaticReconnect()
            .configureLogging(LogLevel.Information)
            .build();
    }

    /** Expose raw HubConnection for clients like SignalRPrivateWorkflowClient */
    public get raw(): HubConnection {
        return this._connection;
    }

    public async start(): Promise<void> {
        return this._connection.start();
    }

    public async stop(): Promise<void> {
        return this._connection.stop();
    }

    public on(methodName: string, handler: (...args: any[]) => void) {
        this._connection.on(methodName, handler);
    }

    public onReconnected(cb: (connectionId?: string) => void) {
        this._connection.onreconnected(cb);
    }

    /** NEW: expose onclose() for compatibility */
    public onClose(cb: (err?: Error) => void) {
        this._connection.onclose(cb);
    }

    public async send(methodName: string, ...args: any[]) {
        return this._connection.invoke(methodName, ...args);
    }
}
