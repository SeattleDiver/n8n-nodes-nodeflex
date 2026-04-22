/* eslint-disable @typescript-eslint/no-explicit-any */
// SignalRPrivateWorkflowClient.ts
// Updated to use the new zero-dependency SignalRClient engine.

// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { setTimeout } from 'node:timers';
import { SignalRClient, HubConnection } from './SignalRClient';
import { PrivateWorkflowAck } from './PrivateWorkflowAck';
import { PrivateWorkflowPayload } from './PrivateWorkflowPayload';
import { PrivateWorkflowRequest } from './PrivateWorkflowRequest';
import { PrivateWorkflowResponse } from './PrivateWorkflowResponse';
import { SignalRClientConfig } from './SignalRClientConfig';
import { WorkflowHubService } from './WorkflowHubService';

// ====================================================================
// Helpers
// ====================================================================

function mask(s?: string, keep = 4): string {
	if (!s) return '(empty)';
	return s.length <= keep ? '*'.repeat(s.length) : s.slice(0, keep) + '…';
}

// ====================================================================
// SignalRPrivateWorkflowClient implementation
// ====================================================================

export class SignalRPrivateWorkflowClient {

	private conn: HubConnection | null = null;
	private client!: SignalRClient; // wrapper
	private readonly cfg: SignalRClientConfig;
	private hubService: WorkflowHubService;

	private onceResolvers: Array<() => void> = [];

	// ------------------------------------------------------------------
	// Retry budget defaults
	// ------------------------------------------------------------------
	private readonly retryMaxDurationMs: number;
	private readonly retryInitialDelayMs: number;
	private readonly retryPhase1CapMs: number;
	private readonly retryPhase1DurationMs: number;
	private readonly retryPhase2IntervalMs: number;

	constructor(cfg: SignalRClientConfig) {
		this.cfg = cfg;
		this.hubService = cfg.hubService;

		this.retryMaxDurationMs = cfg.retryMaxDurationMs ?? 28_800_000;      // 8 hours
		this.retryInitialDelayMs = cfg.retryInitialDelayMs ?? 2_000;
		this.retryPhase1CapMs = cfg.retryPhase1CapMs ?? 60_000;
		this.retryPhase1DurationMs = cfg.retryPhase1DurationMs ?? 3_600_000; // 1 hour
		this.retryPhase2IntervalMs = cfg.retryPhase2IntervalMs ?? 900_000;   // 15 minutes

		this.log('info', 'SignalRPrivateWorkflowClient created', {
			hubUrl: cfg.hubUrl,
			hubPath: cfg.hubPath,
			apiKeySet: Boolean(cfg.apiKey),
			tokenSet: Boolean(cfg.accessToken)
		});
	}

	// Get the hubService
	public getHubService(): WorkflowHubService {
		return this.hubService;
	}

	// Get the API key used for this connection
	public getApiKey(): string | undefined {
		return this.cfg.apiKey;
	}

	// ------------------------------------------------------------------
	// Manual Mode Waiter
	// ------------------------------------------------------------------
	public waitForNextMessage(timeoutMs = 60000): Promise<void> {
		return new Promise<void>((resolve, reject) => {
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

	// ------------------------------------------------------------------
	// Start / Stop
	// ------------------------------------------------------------------
	public async start(): Promise<void> {

		// Build wrapper + get underlying HubConnection
		this.client = new SignalRClient(
			this.cfg.hubUrl,
			this.cfg.apiKey ?? '',
			this.cfg.hubPath
		);

		this.conn = this.client.raw;

		// Pass retry budget to the underlying HubConnection (for reconnect after drop)
		this.conn._setRetryBudget({
			maxDurationMs: this.retryMaxDurationMs,
			initialDelayMs: this.retryInitialDelayMs,
			phase1CapMs: this.retryPhase1CapMs,
			phase1DurationMs: this.retryPhase1DurationMs,
			phase2IntervalMs: this.retryPhase2IntervalMs,
		});

		// Wire event handlers BEFORE start()
		this.wireHandlers();

		try {
			await this.client.start();
			this.log('info', 'SignalR connection established', {
				connectionId: this.conn.connectionId
			});
		} catch (e: any) {
			this.cfg.onConnectionError?.(e, {
				phase: 'start',
				reason: 'Failed to establish SignalR connection'
			});
			throw e;
		}

		// Now register this workflow path with the cloud hub
		await this.registerClient();

		this.log('info', 'Ready for ExecutePrivateWorkflow messages');
	}

	public async stop(): Promise<void> {
		if (this.client) {
			await this.client.stop();
			this.log('info', 'SignalR connection stopped');
		}
		this.conn = null;
	}

	// ------------------------------------------------------------------
	// Internal Handlers
	// ------------------------------------------------------------------

	private wireHandlers(): void {
		if (!this.conn) return;

		// ExecutePrivateWorkflow → our handler
		this.conn.on('ExecutePrivateWorkflow', async (req: PrivateWorkflowRequest) => {
			await this.handleExecute(req).catch((err) => {
				this.log('error', 'Error in workflow handler', err);
			});
		});

		// Reconnecting
		this.conn.onreconnecting((err) => {
			this.log('warn', 'Reconnecting...', err?.message);
		});

		// Reconnected
		this.conn.onreconnected(async (id) => {
			this.log('info', 'Reconnected', { connectionId: id });

			// Must re-register path after reconnect
			await this.registerClient().catch((err) =>
				this.log('error', 'Re-registration after reconnect failed', err)
			);
		});

		// Closed
		this.conn.onclose((err) => {
			this.log('warn', 'Connection closed', err?.message);
		});
	}

	// ------------------------------------------------------------------
	// Register Workflow Path
	// ------------------------------------------------------------------
	private async registerClient(): Promise<void> {
		if (!this.conn) return;

		const registerMessage = {
			apiKey: this.cfg.apiKey ?? '',
			path: this.cfg.hubPath
		};

		try {
			const ack = await this.conn.invoke('RegisterPrivateWorkflow', registerMessage);
			this.log('info', 'Registration attempt ' + this.cfg.hubPath, {
				path: this.cfg.hubPath,
				apiKey: mask(this.cfg.apiKey)
			});

			const failed =
				ack === false ||
				(ack && typeof ack === 'object' && 'success' in ack && ack.success === false);

			if (failed) {
				const err = new Error('API key invalid or registration rejected');
				this.cfg.onConnectionError?.(err, {
					phase: 'register',
					reason: 'Registration rejected by cloud hub',
					registerMessage,
					ack
				});
				this.log('error', err.message, { registerMessage, ack });
				return;
			}

			if (ack) this.log('debug', 'Registration ack', ack);

		} catch (e: any) {
			this.cfg.onConnectionError?.(e, {
				phase: 'register',
				reason: 'invoke.RegisterPrivateWorkflow failed',
				registerMessage
			});
			this.log('error', 'Registration failed', e?.message || e);
			throw e;
		}
	}

	// ------------------------------------------------------------------
	// Handle Incoming Workflow Execution
	// ------------------------------------------------------------------
	private async handleExecute(req: PrivateWorkflowRequest): Promise<void> {
		if (!this.conn) return;

		this.log("info", `Received ExecutePrivateWorkflow (correlationId=${req.correlationId})`);

		const correlationId = req.correlationId ?? '';
		const requestId = req.requestId ?? '';
		const path = req.path ?? '';

		// ---------------------------------------------------------------------
		// ACK immediately (unchanged behavior)
		// ---------------------------------------------------------------------
		await this.sendAckToHub(correlationId, requestId, path);

		// ---------------------------------------------------------------------
		// Normalize payload using new PrivateWorkflowPayload contract
		// ---------------------------------------------------------------------
		let inlineText: string | undefined;
		let inlineJson: string | undefined;

		const payload = req.payload as PrivateWorkflowPayload | undefined;
		if (payload) {
			if (payload.type === 'inline') {

				switch (payload.encoding) {

					case 'text':
						inlineText = payload.value;
						break;

					case 'json':
						inlineJson = payload.value;
						break;

						case 'base64':
						// Binary payload — no inlineJson/inlineText
						break;

						default:
						this.log('warn', `Unsupported payload encoding: ${payload.encoding}`);
				}
			}

			else if (payload.type === 'reference') {
				// Do NOT fetch here — Trigger already normalizes reference payloads
				this.log(
					'info',
					'Received reference payload (deferred resolution)',
					{ requestId, path }
				);
			}
		}

		this.log('info', 'ExecutePrivateWorkflow received', {
			requestId,
			path,
			payloadType: payload?.type,
			encoding: payload?.encoding,
			length: payload?.length,
		});

		// ---------------------------------------------------------------------
		// Call user handler (contract preserved)
		// ---------------------------------------------------------------------
		await this.cfg.onExecute({
			request: req,
			inlineJson,
			inlineText,
			payload,
		});

		this.log('debug', 'onExecute handler completed');

		// ---------------------------------------------------------------------
		// Manual-run resolver (unchanged)
		// ---------------------------------------------------------------------
		const resolver = this.onceResolvers.shift();
		if (resolver) resolver();
	}




	// ------------------------------------------------------------------
	// Send ACK (message-based, first-wins)
	// ------------------------------------------------------------------

	public async sendAckToHub(correlationId: string, requestId: string, path: string): Promise<void> {
			if (!this.conn) {
					this.log('warn', 'Cannot send ACK: connection not active');
					return;
			}

			try {
					const ack: PrivateWorkflowAck = {
							correlationId,
							requestId,
							path,
							status: 'Started',
							timestampUtc: new Date().toISOString()
					};

					await this.conn.invoke('AcknowledgePrivateWorkflow', ack);

					this.log('debug', `ACK sent for ${requestId}`, {
							requestId,
							path,
					});
			} catch (err: any) {
					this.log('error', `Failed to send ACK for ${requestId}`, err);
			}
	}

	// ------------------------------------------------------------------
	// Send Response
	// ------------------------------------------------------------------
	public async sendResponseToHub(
		correlationId: string,
		status: string,
		requestId: string,
		payload: PrivateWorkflowPayload,
		path: string
	): Promise<void> {

		if (!this.conn) {
			this.log('warn', 'Cannot send response: connection not active');
			return;
		}

		try {
			// Optional defensive check (can be removed later)
			if (!payload || typeof payload.value !== 'string') {
				throw new Error('Invalid PrivateWorkflowPayload: value must be a string');
			}

			// Optional sanity check on length (trust but verify)
			if (payload.length !== payload.value.length) {
				// Not fatal, but useful during refactor
				this.log(
					'warn',
					`Payload length mismatch: declared=${payload.length}, actual=${payload.value.length}`
				);
			}

			const response: PrivateWorkflowResponse = {
				status,
				correlationId,
				requestId,
				path,
				payload,
			};

			await this.conn.invoke('CompletePrivateWorkflow', response);

			this.log('info', `CompletePrivateWorkflow sent for ${requestId}`);
		}
		catch (err: any) {
			this.log('error', `Failed to send response for ${requestId}, ${err}`);
		}

	}

	// ------------------------------------------------------------------
	// Logging passthrough
	// ------------------------------------------------------------------
	private log(level: 'info'|'warn'|'error'|'debug'|'none', msg:string, ...args:any[]) {
		const l = this.cfg.logger;

		if (level === 'none') return;
		if (level === 'debug' && this.cfg.logLevel !== 'debug') return;

		switch (level) {
			case 'info':  l?.info?.(msg, ...args); break;
			case 'warn':  l?.warn?.(msg, ...args); break;
			case 'error': l?.error?.(msg, ...args); break;
			case 'debug': l?.info?.(`[debug] ${msg}`, ...args); break;
		}
	}
}
