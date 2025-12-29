"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalRPrivateWorkflowClient = void 0;
const signalr_1 = require("@microsoft/signalr");
const ws_1 = __importDefault(require("ws"));
if (typeof globalThis.WebSocket === 'undefined') {
    globalThis.WebSocket = ws_1.default;
}
function mask(s, keep = 4) {
    if (!s)
        return '(empty)';
    return s.length <= keep ? '*'.repeat(s.length) : s.slice(0, keep) + '…';
}
function decodePayloadString(payload) {
    if (!payload)
        return null;
    const s = String(payload).trim();
    const looksJson = (s.startsWith('{') && s.endsWith('}')) ||
        (s.startsWith('[') && s.endsWith(']'));
    if (looksJson)
        return s;
    try {
        const utf8 = Buffer.from(s, 'base64').toString('utf8');
        JSON.parse(utf8);
        return utf8;
    }
    catch {
        return s;
    }
}
function pick(a, b) {
    return a !== undefined ? a : b;
}
class SignalRPrivateWorkflowClient {
    constructor(cfg) {
        this.conn = null;
        this.onceResolvers = [];
        this.cfg = cfg;
        this.urlWithPath = `${cfg.hubUrl}?group=${encodeURIComponent(cfg.hubPath)}`;
        this.log('info', 'SignalR client created', {
            hubUrl: cfg.hubUrl,
            hubPath: cfg.hubPath,
            apiKeySet: Boolean(cfg.apiKey),
            tokenSet: Boolean(cfg.accessToken),
            urlWithPath: this.urlWithPath,
        });
    }
    waitForNextMessage(timeoutMs = 60000) {
        return new Promise((resolve, reject) => {
            let done = false;
            const finish = () => {
                if (!done) {
                    done = true;
                    resolve();
                }
            };
            this.onceResolvers.push(finish);
            if (timeoutMs > 0) {
                setTimeout(() => {
                    if (!done) {
                        done = true;
                        reject(new Error(`Timed out waiting for next message after ${timeoutMs} ms`));
                    }
                }, timeoutMs);
            }
        });
    }
    async start() {
        try {
            this.conn = this.buildConnection({
                skipNegotiation: false,
                transport: undefined,
            });
            await this.conn.start();
            this.log('info', 'Connected via negotiate', { connectionId: this.conn.connectionId });
        }
        catch (e) {
            this.log('warn', 'Negotiate failed; trying direct WebSockets…', (e === null || e === void 0 ? void 0 : e.message) || e);
            this.conn = this.buildConnection({
                skipNegotiation: true,
                transport: signalr_1.HttpTransportType.WebSockets,
            });
            await this.conn.start();
            this.log('info', 'Connected via direct WebSockets', { connectionId: this.conn.connectionId });
        }
        this.wireHandlers();
        await this.registerClient();
        this.log('info', 'Ready. Listening for ExecutePrivateWorkflow', { url: this.urlWithPath });
    }
    async stop() {
        if (this.conn) {
            try {
                await this.conn.stop();
            }
            finally {
                this.conn = null;
            }
            this.log('info', 'SignalR connection stopped');
        }
    }
    buildConnection(opts) {
        const { accessToken, logLevel } = this.cfg;
        const builder = new signalr_1.HubConnectionBuilder()
            .withUrl(this.urlWithPath, {
            accessTokenFactory: accessToken ? () => accessToken : undefined,
            skipNegotiation: opts.skipNegotiation,
            transport: opts.transport,
        })
            .withAutomaticReconnect([0, 1000, 1500, 2000, 5000, 10000, 30000])
            .configureLogging(logLevel === 'debug'
            ? signalr_1.LogLevel.Debug
            : logLevel === 'info'
                ? signalr_1.LogLevel.Information
                : signalr_1.LogLevel.None);
        return builder.build();
    }
    wireHandlers() {
        if (!this.conn)
            return;
        this.conn.on('ExecutePrivateWorkflow', async (req) => {
            await this.handleExecute(req).catch((err) => {
                this.log('error', 'Error in ExecutePrivateWorkflow handler', err);
            });
        });
        this.conn.onreconnecting((err) => {
            this.log('warn', 'Reconnecting…', (err === null || err === void 0 ? void 0 : err.message) || '');
        });
        this.conn.onreconnected(async (id) => {
            this.log('info', 'Reconnected', { connectionId: id });
            await this.registerClient().catch((err) => {
                this.log('error', 'Re-registration after reconnect failed', err);
            });
        });
        this.conn.onclose((err) => {
            this.log('warn', 'Connection closed', (err === null || err === void 0 ? void 0 : err.message) || '');
        });
    }
    async registerClient() {
        var _a, _b, _c, _d, _e;
        if (!this.conn)
            return;
        const payload = {
            apiKey: (_a = this.cfg.apiKey) !== null && _a !== void 0 ? _a : '',
            path: this.cfg.hubPath,
        };
        try {
            const ack = await this.conn.invoke('RegisterPrivateWorkflow', payload);
            this.log('info', 'Registration sent', { path: this.cfg.hubPath, apiKey: mask(this.cfg.apiKey) });
            this.log('info', JSON.stringify(ack));
            const failed = ack === false ||
                (ack && typeof ack === 'object' && 'success' in ack && ack.success === false);
            if (failed) {
                const err = new Error('API key invalid or registration rejected');
                (_c = (_b = this.cfg).onConnectionError) === null || _c === void 0 ? void 0 : _c.call(_b, err, {
                    phase: 'register',
                    reason: 'Failed to register this workflow with cloud hub.  Verify you have the correct API key.',
                    payload,
                    ack,
                });
                this.log('error', err.message, { payload, ack });
                return;
            }
            if (ack)
                this.log('debug', 'Registration ack', ack);
        }
        catch (e) {
            (_e = (_d = this.cfg).onConnectionError) === null || _e === void 0 ? void 0 : _e.call(_d, e, {
                phase: 'register',
                reason: 'invokeError',
                payload,
                op: 'invoke.RegisterPrivateWorkflow',
            });
            this.log('error', 'Registration failed', (e === null || e === void 0 ? void 0 : e.message) || e);
        }
    }
    async handleExecute(req) {
        var _a, _b, _c, _d, _e;
        if (!this.conn)
            return;
        const requestId = (_a = pick(req.requestId, req.RequestId)) !== null && _a !== void 0 ? _a : '';
        const path = (_b = pick(req.path, req.Path)) !== null && _b !== void 0 ? _b : '';
        const payloadStr = (_c = pick(req.payload, req.Payload)) !== null && _c !== void 0 ? _c : '';
        this.log('info', 'ExecutePrivateWorkflow received', {
            requestId,
            path,
        });
        const decodedText = (_d = decodePayloadString(payloadStr)) !== null && _d !== void 0 ? _d : undefined;
        let decodedJson = undefined;
        if (decodedText) {
            try {
                decodedJson = JSON.parse(decodedText);
            }
            catch {
            }
        }
        const result = await this.cfg.onExecute({ raw: req, decodedJson, decodedText });
        let bodyBytes;
        if (Buffer.isBuffer(result)) {
            bodyBytes = result;
        }
        else if (result instanceof Uint8Array) {
            bodyBytes = Buffer.from(result);
        }
        else if (typeof result === 'string') {
            bodyBytes = Buffer.from(result, 'utf8');
        }
        else {
            bodyBytes = Buffer.from(JSON.stringify(result !== null && result !== void 0 ? result : {}), 'utf8');
        }
        const response = {
            requestId: requestId,
            // sessionId: (_e = req.SessionId) !== null && _e !== void 0 ? _e : req.sessionId,
            path: path,
						payload: {
								type: "inline",
								value: encodedPayload,
								length: encodedPayload.length,
								isEncrypted: false
						}
					};
        await this.conn.invoke('CompletePrivateWorkflow', response);
        this.log('info', 'CompletePrivateWorkflow sent', { requestId });
        const resolver = this.onceResolvers.shift();
        if (resolver)
            resolver();
    }
    log(level, msg, ...args) {
        var _a, _b, _c, _d;
        const l = this.cfg.logger;
        if (level === 'none')
            return;
        if (level === 'debug' && this.cfg.logLevel !== 'debug')
            return;
        switch (level) {
            case 'info':
                (_a = l === null || l === void 0 ? void 0 : l.info) === null || _a === void 0 ? void 0 : _a.call(l, msg, ...args);
                break;
            case 'warn':
                (_b = l === null || l === void 0 ? void 0 : l.warn) === null || _b === void 0 ? void 0 : _b.call(l, msg, ...args);
                break;
            case 'error':
                (_c = l === null || l === void 0 ? void 0 : l.error) === null || _c === void 0 ? void 0 : _c.call(l, msg, ...args);
                break;
            case 'debug':
                (_d = l === null || l === void 0 ? void 0 : l.info) === null || _d === void 0 ? void 0 : _d.call(l, `[debug] ${msg}`, ...args);
                break;
        }
    }
}
exports.SignalRPrivateWorkflowClient = SignalRPrivateWorkflowClient;
//# sourceMappingURL=SignalRPrivateWorkflowClient.js.map
