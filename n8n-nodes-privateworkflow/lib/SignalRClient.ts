/* eslint-disable @typescript-eslint/no-explicit-any */
// SignalRClient.ts
// A zero-dependency shim that provides:
// 1. Microsoft SignalR compatibility (HubConnection, HubConnectionBuilder, Enums)
// 2. A simplified, GENERIC TinySignalRClient class
// 3. Robust connection resilience (Auto-reconnect, Negotiation, Keep-Alive)

// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { setTimeout as setTimeoutPromise } from 'timers/promises';

const INVOCATION_TIMEOUT_MS = 30_000;
const KEEP_ALIVE_INTERVAL_MS = 15_000;
const SERVER_TIMEOUT_CHECK_INTERVAL_MS = 5_000;
const QUICK_RETRY_4S_COUNT = 8;
const QUICK_RETRY_8S_COUNT = 8;

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
    private keepAliveAbortController: AbortController | null = null;
    private serverTimeoutCheckAbortController: AbortController | null = null;
    private lastMessageReceivedAt = 0;
    private serverTimeoutMs = 60_000;

    private isStopped = true;
    private options: IHttpConnectionOptions;
    private logLevel: LogLevel = LogLevel.Information;

    // Timeout for a single connect attempt (negotiate + WebSocket handshake)
    private connectTimeoutMs = 30_000;

    // Two-phase retry budget configuration (short defaults for HubConnection-level reconnect)
    // Long retry with hubInfo re-fetch is handled at the trigger level
    private retryMaxDurationMs = 60_000;          // 60s — quick reconnect for brief blips
    private retryInitialDelayMs = 2_000;
    private retryPhase1CapMs = 10_000;
    private retryPhase1DurationMs = 60_000;
    private retryPhase2IntervalMs = 60_000;

    // Callbacks
    private onReconnectingCallbacks: Array<(error?: Error) => void> = [];
    private onReconnectedCallbacks: Array<(connectionId?: string) => void> = [];
    private onCloseCallbacks: Array<(error?: Error) => void> = [];
    private onRetryAttemptCallbacks: Array<(delayMs: number, elapsedMs: number) => void> = [];

    constructor(url: string, apiKey: string, group: string, options: IHttpConnectionOptions) {
        this.baseUrl = url;
        this.apiKey = apiKey;
        this.group = group;
        this.options = options;
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

        // Create abort controller for this specific invocation's timeout
        const timeoutAbortController = new AbortController();

        // Race between timeout and actual response
        const timeoutPromise = setTimeoutPromise(INVOCATION_TIMEOUT_MS, undefined, { signal: timeoutAbortController.signal })
            .then(() => {
                // Timeout fired - clean up and reject if still pending
                if (this.pendingInvocations.has(invId)) {
                    this.pendingInvocations.delete(invId);
                    throw new Error(`Invocation '${methodName}' timed out.`);
                }
            });

        const responsePromise = new Promise<any>((resolve, reject) => {
            this.pendingInvocations.set(invId, {
                resolve: (value) => {
                    timeoutAbortController.abort(); // Cancel timeout on success
                    resolve(value);
                },
                reject: (err) => {
                    timeoutAbortController.abort(); // Cancel timeout on error
                    reject(err);
                }
            });

            this.socket?.send(JSON.stringify(packet) + "\x1e");
        });

        return Promise.race([timeoutPromise, responsePromise]);
    }

    // Lifecycle
    public onreconnecting(cb: (error?: Error) => void) { this.onReconnectingCallbacks.push(cb); }
    public onreconnected(cb: (id?: string) => void) { this.onReconnectedCallbacks.push(cb); }
    public onretryattempt(cb: (delayMs: number, elapsedMs: number) => void) { this.onRetryAttemptCallbacks.push(cb); }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public _setReconnectDelays(_delays: number[]) { /* legacy no-op, use _setRetryBudget */ }
    public _setRetryBudget(cfg: {
        maxDurationMs?: number;
        initialDelayMs?: number;
        phase1CapMs?: number;
        phase1DurationMs?: number;
        phase2IntervalMs?: number;
    }) {
        if (cfg.maxDurationMs !== undefined) this.retryMaxDurationMs = cfg.maxDurationMs;
        if (cfg.initialDelayMs !== undefined) this.retryInitialDelayMs = cfg.initialDelayMs;
        if (cfg.phase1CapMs !== undefined) this.retryPhase1CapMs = cfg.phase1CapMs;
        if (cfg.phase1DurationMs !== undefined) this.retryPhase1DurationMs = cfg.phase1DurationMs;
        if (cfg.phase2IntervalMs !== undefined) this.retryPhase2IntervalMs = cfg.phase2IntervalMs;
    }
    public _setLogLevel(level: LogLevel) { this.logLevel = level; }

    // ---------------------------------------------------------------------
    // Core connection logic
    // ---------------------------------------------------------------------

    private async connectInternal(isReconnect = false): Promise<void> {
        // Use AbortSignal.timeout() for clean deadline management (available in Node 17.3+)
        const signal = AbortSignal.timeout(this.connectTimeoutMs);

        try {
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

                const response = await fetch(negotiateUrl, { method: "POST", headers, signal });
                if (!response.ok) throw new Error(`Negotiate failed: ${response.status}`);

                const negotiation = await response.json() as {
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

            if (this.options.webSocketQueryParams) {
                for (const [k, v] of Object.entries(this.options.webSocketQueryParams)) {
                    const sep = wsUrl.includes("?") ? "&" : "?";
                    wsUrl += `${sep}${k}=${encodeURIComponent(v)}`;
                }
            }

            // ---------------- WebSocket Connect ----------------
            // Close any previous socket and strip its handlers to prevent ghost callbacks
            if (this.socket) {
                const old = this.socket;
                old.onopen = old.onclose = old.onerror = old.onmessage = null;
                this.socket = null;
                try { old.close(); } catch { /* already closed */ }
            }

            await new Promise<void>((resolve, reject) => {
                // If already timed out before reaching WebSocket phase, bail immediately
                if (signal.aborted) {
                    return reject(new Error(`Connect timed out after ${this.connectTimeoutMs}ms`));
                }

                let settled = false;
                const ws = new WebSocket(wsUrl);
                this.socket = ws;

                const onAbort = () => {
                    if (settled) return;
                    settled = true;
                    ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
                    this.socket = null;
                    try { ws.close(); } catch { /* ignore */ }
                    reject(new Error(`Connect timed out after ${this.connectTimeoutMs}ms`));
                };
                signal.addEventListener('abort', onAbort, { once: true });

                ws.onopen = () => {
                    this.lastMessageReceivedAt = Date.now();
                    ws.send(`{"protocol":"json","version":1}\x1e`);
                };

                ws.onerror = (e: any) => {
                    signal.removeEventListener('abort', onAbort);
                    this.log(LogLevel.Error, "WebSocket error", e.message);
                    if (settled) return;
                    settled = true;
                    reject(new Error(e.message || "WebSocket Error"));
                };

                ws.onclose = (e) => {
                    signal.removeEventListener('abort', onAbort);
                    this.cleanup();
                    // During connection attempt, close should resolve/reject the pending start promise once.
                    if (!settled) {
                        settled = true;
                        if (isReconnect) {
                            // Let handleAutomaticReconnect's catch block handle retry
                            reject(new Error(e.reason || "WebSocket closed during reconnect"));
                        } else if (this.isStopped) {
                            this.fireCloseCallbacks(new Error(e.reason || "Closed"));
                        } else {
                            this.handleAutomaticReconnect();
                        }
                        return;
                    }

                    // After handshake/steady-state, a close must trigger lifecycle handling too.
                    if (this.isStopped) {
                        this.fireCloseCallbacks(new Error(e.reason || "Closed"));
                    } else {
                        this.handleAutomaticReconnect();
                    }
                };

                ws.onmessage = (event) => {
                    signal.removeEventListener('abort', onAbort);
                    this.lastMessageReceivedAt = Date.now();
                    this.handleRawMessage(event, () => {
                        if (settled) return;
                        settled = true;
                        this.startKeepAlive();
                        if (isReconnect) this.fireReconnectedCallbacks();
                        resolve();
                    });
                };
            });
        } catch (err: any) {
            // Normalize AbortError from fetch into a consistent timeout message
            if (err.name === 'AbortError') {
                throw new Error(`Connect timed out after ${this.connectTimeoutMs}ms`);
            }
            throw err;
        }
    }

    // ---------------------------------------------------------------------
    // Reconnect logic
    // ---------------------------------------------------------------------

    private async handleAutomaticReconnect() {
        this.fireReconnectingCallbacks(new Error("Reconnecting"));

        const startTime = Date.now();
        let delay = 0; // first attempt is immediate
        let failedAttempts = 0;
        const quickRetry4sCount = QUICK_RETRY_4S_COUNT;
        const quickRetry8sCount = QUICK_RETRY_8S_COUNT;

        while (!this.isStopped) {
            if (delay > 0) {
                await setTimeoutPromise(delay);
            }

            if (this.isStopped) return;

            const elapsed = Date.now() - startTime;
            if (elapsed >= this.retryMaxDurationMs) break;

            try {
                await this.connectInternal(true);
                return; // success
            } catch {
                failedAttempts++;
                // Compute next delay based on which phase we're in
                const elapsedAfterAttempt = Date.now() - startTime;
                if (failedAttempts <= quickRetry4sCount) {
                    delay = 4_000;
                } else if (failedAttempts <= quickRetry4sCount + quickRetry8sCount) {
                    delay = 8_000;
                } else if (elapsedAfterAttempt < this.retryPhase1DurationMs) {
                    // Phase 1: exponential backoff capped at phase1CapMs
                    delay = delay <= 8_000
                        ? this.retryInitialDelayMs
                        : Math.min(delay * 2, this.retryPhase1CapMs);
                    if (delay < 8_000) {
                        delay = 8_000;
                    }
                } else {
                    // Phase 2: fixed interval
                    delay = this.retryPhase2IntervalMs;
                }
                this.fireRetryAttemptCallbacks(delay, elapsedAfterAttempt);
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

    /**
     * Helper: Create an async interval generator using AbortSignal
     * Yields at regular intervals until signal is aborted
     */
    private async *createInterval(ms: number, signal: AbortSignal) {
        while (!signal.aborted) {
            yield;
            try {
                await setTimeoutPromise(ms, undefined, { signal });
            } catch (e: any) {
                if (e.name === 'AbortError') break;
                throw e;
            }
        }
    }

    private startKeepAlive() {
        // Stop previous intervals if they exist
        if (this.keepAliveAbortController) {
            this.keepAliveAbortController.abort();
        }
        if (this.serverTimeoutCheckAbortController) {
            this.serverTimeoutCheckAbortController.abort();
        }

        // Start keep-alive ping interval (fires every 15s)
        this.keepAliveAbortController = new AbortController();
        (async () => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const _ of this.createInterval(KEEP_ALIVE_INTERVAL_MS, this.keepAliveAbortController!.signal)) {
                if (this.socket?.readyState === WebSocket.OPEN) {
                    try {
                        this.socket.send(`{"type":6}\x1e`);
                    } catch {
                        try { this.socket?.close(); } catch { /* close error suppressed */ }
                    }
                }
            }
        })();

        // Start server timeout check interval (fires every 5s)
        this.serverTimeoutCheckAbortController = new AbortController();
        (async () => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const _ of this.createInterval(SERVER_TIMEOUT_CHECK_INTERVAL_MS, this.serverTimeoutCheckAbortController!.signal)) {
                if (this.isStopped) return;
                if (this.socket?.readyState !== WebSocket.OPEN) return;

                const idleMs = Date.now() - this.lastMessageReceivedAt;
                if (idleMs > this.serverTimeoutMs) {
                    try {
                        this.socket.close();
                    } catch {
                        // close errors are ignored; reconnect path is handled by onclose.
                    }
                }
            }
        })();
    }

    private cleanup() {
        // Abort both interval generators
        if (this.keepAliveAbortController) {
            this.keepAliveAbortController.abort();
        }
        if (this.serverTimeoutCheckAbortController) {
            this.serverTimeoutCheckAbortController.abort();
        }
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

    private fireRetryAttemptCallbacks(delayMs: number, elapsedMs: number) {
        this.onRetryAttemptCallbacks.forEach(cb => { try { cb(delayMs, elapsedMs); } catch { /* callback error suppressed */ } });
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
    private retryBudget: {
        maxDurationMs?: number;
        initialDelayMs?: number;
        phase1CapMs?: number;
        phase1DurationMs?: number;
        phase2IntervalMs?: number;
    } = {};
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

    public withAutomaticReconnect(budget?: {
        maxDurationMs?: number;
        initialDelayMs?: number;
        phase1CapMs?: number;
        phase1DurationMs?: number;
        phase2IntervalMs?: number;
    }): this {
        if (budget) this.retryBudget = budget;
        return this;
    }

    public configureLogging(level: LogLevel): this {
        this.logLevel = level;
        return this;
    }

    public build(): HubConnection {
        if (!this.url) throw new Error("HubConnectionBuilder.withUrl(url) is required.");

        const conn = new HubConnection(this.url, this.apiKey, this.group, this.options);
        conn._setRetryBudget(this.retryBudget);
        conn._setLogLevel(this.logLevel);
        return conn;
    }
}

// -------------------------------------------------------------------------
// 5. TinySignalRClient wrapper
// -------------------------------------------------------------------------
export class SignalRClient {
    private _connection: HubConnection;

    constructor(hubUrl: string, apiKey: string, hubPath: string) {
        const wsParams: Record<string, string> = {};
        if (hubPath) wsParams["group"] = hubPath;

        this._connection = new HubConnectionBuilder()
            .withUrl(hubUrl, { webSocketQueryParams: wsParams })
            .withApiKey(apiKey)
            .withGroup(hubPath)
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
