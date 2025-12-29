/* eslint-disable @typescript-eslint/no-explicit-any */
// SignalRPrivateWorkflowClient.ts
// Updated to use the new zero-dependency SignalRClient engine.

import { SignalRClient, HubConnection } from './SignalRClient';
import { jsonStringify } from 'n8n-workflow';
import { PrivateWorkflowAck } from './PrivateWorkflowAck';
import { PrivateWorkflowPayload } from './PrivateWorkflowPayload';
import { PrivateWorkflowRequest } from './PrivateWorkflowRequest';
import { PrivateWorkflowResponse } from './PrivateWorkflowResponse';
import { SignalRClientConfig } from './SignalRClientConfig';

// ====================================================================
// Helpers
// ====================================================================

function mask(s?: string, keep = 4): string {
	if (!s) return '(empty)';
	return s.length <= keep ? '*'.repeat(s.length) : s.slice(0, keep) + '…';
}

function extractInlineText(payload?: PrivateWorkflowPayload): string | undefined {
    if (!payload) return undefined;
    if (payload.type !== 'inline') return undefined;
    return payload.value;
}

function extractInlineJson(text?: string): any | undefined {
    if (!text) return undefined;
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

// ====================================================================
// SignalRPrivateWorkflowClient implementation
// ====================================================================

export class SignalRPrivateWorkflowClient {

	private conn: HubConnection | null = null;
	private client!: SignalRClient; // wrapper
	private readonly cfg: SignalRClientConfig;

	private onceResolvers: Array<() => void> = [];

	constructor(cfg: SignalRClientConfig) {
		this.cfg = cfg;

		this.log('info', 'SignalRPrivateWorkflowClient created', {
			hubUrl: cfg.hubUrl,
			hubPath: cfg.hubPath,
			apiKeySet: Boolean(cfg.apiKey),
			tokenSet: Boolean(cfg.accessToken)
		});
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

			const correlationId = req.correlationId ?? '';
			const requestId = req.requestId ?? '';
			const path = req.path ?? '';

			// ACK immediately
			await this.sendAckToHub(correlationId, requestId, path);

			// Get the payload object
			const payload = req.payload;
			const inlineText = extractInlineText(payload);
			const inlineJson = extractInlineJson(inlineText);

			this.log('info', 'ExecutePrivateWorkflow received', {
					requestId,
					path,
					payloadType: payload?.type,
			});

			// Call user handler with new fields
			const result = await this.cfg.onExecute({
					request: req,
					inlineJson,
					inlineText,
					payload,
			});

			this.log('info', jsonStringify(result));

			// Manual-run resolver
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
							timestampUtc: new Date().toISOString(),
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

	public async sendResponseToHub(correlationId: string, requestId: string, body: any, path: string): Promise<void> {
				if (!this.conn) {
						this.log('warn', 'Cannot send response: connection not active');
						return;
				}

				try {
						const jsonString = JSON.stringify(body ?? {});
						const byteLength = Buffer.byteLength(jsonString, 'utf8');

						const payload: PrivateWorkflowPayload = {
								type: 'inline',
								value: jsonString,
								length: byteLength,
						};

						const response: PrivateWorkflowResponse = {
							  correlationId,
								requestId,
								path,
								payload,
						};

						await this.conn.invoke('CompletePrivateWorkflow', response);
						this.log('info', `CompletePrivateWorkflow sent for ${requestId}`);
				} catch (err: any) {
						this.log('error', `Failed to send response for ${requestId}`, err);
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
