import type {
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { setTimeout as setTimeoutPromise } from 'timers/promises';

import { HUB_BASE_URL } from '../../lib/HubConfig';
import { HubProfileService } from '../../lib/HubProfileService';
import { IN8nHttpHelper } from '../../lib/N8nHttpHelper';
import { PrivateWorkflowPayload } from '../../lib/PrivateWorkflowPayload';
import { SignalRPrivateWorkflowClient } from '../../lib/SignalRPrivateWorkflowClient';
import { WorkflowHubService } from '../../lib/WorkflowHubService';

// This node only implements trigger(), not execute(), so it can never be a valid
// AI Agent tool; the rule's type only allows `true | UsableAsToolDescription`, so
// there's no way to declare "not usable" other than omitting the property.
// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool
export class PrivateWorkflowTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Private Workflow Trigger',
		name: 'privateWorkflowTrigger',
		icon: { light: 'file:icon.svg', dark: 'file:icon.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["workflowName"]}}',
		description: 'When a remote private workflow is executed',
		defaults: {
			name: 'Private Workflow Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'privateWorkflowApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Workflow Name',
				name: 'workflowName',
				type: 'string',
				default: '',
				placeholder: 'e.g. my-workflow',
				required: true,
				description: 'The name of the workflow (required)',
			},
			{
				displayName: 'Respond',
				name: 'respond',
				type: 'options',
				default: 'immediately',
				description: 'Specifies when to send a response to the SignalR client or private workflow',
				options: [
					{
						name: 'Immediately',
						value: 'immediately',
						description: 'Send an acknowledgement immediately after this node runs',
					},
					{
						name: "Using 'Respond to Private Workflow' Node",
						value: 'respondToPrivateWorkflow',
						description:
							"Wait for a dedicated 'Respond to Private Workflow' node to send a response",
					},
				],
			},
			{
				displayName: 'Respond With Status',
				name: 'immediateResponseStatus',
				type: 'options',
				default: 'Completed',
				description:
					'Status to send when using immediate response mode. "Completed" means request accepted and workflow running independently.',
				displayOptions: {
					show: {
						respond: ['immediately'],
					},
				},
				options: [
					{
						name: 'Completed',
						value: 'Completed',
						description:
							'Request accepted, workflow running independently (clears hub cache immediately)',
					},
					{
						name: 'Running',
						value: 'Running',
						description: 'Workflow is running (hub cache expires at timeout)',
					},
				],
			},
		],
	};

	// trigger is called when n8n runs the workflow trigger
	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const http: IN8nHttpHelper = { httpRequest: this.helpers.httpRequest.bind(this.helpers) };
		const hubBase = HUB_BASE_URL;
		const workflowName = this.getNodeParameter('workflowName', 0) as string;
		if (!workflowName) {
			throw new NodeOperationError(this.getNode(), 'Workflow name is required.');
		}

		const creds = (await this.getCredentials('privateWorkflowApi')) as {
			apiKey?: string;
		} | null;

		if (!creds?.apiKey) {
			throw new NodeOperationError(
				this.getNode(),
				'API key is missing. Add it in the node credentials.',
			);
		}
		const apiKey = creds?.apiKey;
		const isManualRun = this.getMode() === 'manual';

		let started = false;
		let startingPromise: Promise<void> | null = null;
		let isReconnecting = false;

		// Mutable client reference — reassigned on each retry attempt
		let client: SignalRPrivateWorkflowClient | null = null;
		let hubPath = '';
		let hubInfo: WorkflowHubService | null = null;

		// Two-phase retry budget (applies to entire activation: hub fetch + connect)
		const RETRY_MAX_DURATION_MS = 28_800_000; // 8 hours
		const RETRY_INITIAL_DELAY_MS = 2_000;
		const RETRY_PHASE1_CAP_MS = 60_000; // 60s cap during phase 1
		const RETRY_PHASE1_DURATION_MS = 3_600_000; // 1 hour
		const RETRY_PHASE2_INTERVAL_MS = 900_000; // 15 minutes
		const MANUAL_WAIT_TIMEOUT_MS = 60_000; // 60s timeout for manual test runs

		// connectToHub: fetches hub info, creates client, and starts connection.
		// Throws on any failure so the retry loop can catch and retry.
		const connectToHub = async () => {
			const hubService = new HubProfileService(hubBase, http);
			try {
				hubInfo = await hubService.getHubInfo(apiKey);
			} catch (err) {
				throw new NodeApiError(this.getNode(), err as JsonObject, {
					message: 'Hub service is unavailable.',
				});
			}

			const hubUrl = hubInfo?.hubUrl;
			if (!hubUrl) {
				throw new NodeApiError(this.getNode(), hubInfo as unknown as JsonObject, {
					message: 'Hub URL is unavailable.  Hub service is down.',
				});
			}
			hubPath = hubInfo.accountPath + '/' + workflowName;
			const blobUrl = hubInfo?.blobStorageUrl;
			if (!blobUrl) {
				throw new NodeApiError(this.getNode(), hubInfo as unknown as JsonObject, {
					message: 'Blob URL is unavailable.  Hub service is down.',
				});
			}
			this.logger.info('Hub endpoints resolved');

			const conn = new SignalRPrivateWorkflowClient({
				hubUrl,
				hubPath,
				apiKey,
				accessToken: '',
				hubService: hubInfo,
				logLevel: 'info',
				isSingleNodeRun: isManualRun,
				retryMaxDurationMs: RETRY_MAX_DURATION_MS,
				retryInitialDelayMs: RETRY_INITIAL_DELAY_MS,
				retryPhase1CapMs: RETRY_PHASE1_CAP_MS,
				retryPhase1DurationMs: RETRY_PHASE1_DURATION_MS,
				retryPhase2IntervalMs: RETRY_PHASE2_INTERVAL_MS,
				logger: {
					info: (m, ...a) => this.logger.info(m, ...a),
					warn: (m, ...a) => this.logger.warn(m, ...a),
					error: (m, ...a) => this.logger.error(m, ...a),
				},

				// onExecute is called when the SignalR connection receives a message from the hub.
				// The payload may be encrypted; if a privateKey is defined it must be decrypted before use.
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				onExecute: async ({ request, inlineJson, inlineText, payload: _payload }) => {
					this.logger.info(`[PrivateWorkflowTrigger] onExecute()`);
					try {
						const raw = inlineJson ?? inlineText ?? null;

						const base =
							raw && typeof raw === 'object' && 'json' in raw
								? (raw as Record<string, unknown>).json
								: (raw ?? { text: inlineText ?? null });

						const requestId = request?.requestId ?? 'unknown';

						let respondMode = this.getNodeParameter('respond', 0) as string;
						const immediateResponseStatus =
							(this.getNodeParameter('immediateResponseStatus', 0) as string) ?? 'Completed';
						const isManual = this.getMode() === 'manual';
						this.logger.info(
							`respondMode: ${respondMode}, immediateResponseStatus: ${immediateResponseStatus}, isManual: ${isManual}`,
						);

						// Override respond mode for manual triggers
						if (isManual && respondMode !== 'immediately') {
							this.logger.info(
								"[ManualMode] Overriding respondMode to 'immediately' for test run.",
							);
							respondMode = 'immediately';
						}

						const correlationId = request?.correlationId;
						if (!correlationId || correlationId == '') {
							throw new NodeOperationError(this.getNode(), 'CorrelationId is required!');
						}

						// Decode the workflow request payload
						const wfPayload = request.payload as PrivateWorkflowPayload;

						// Normalize reference payload → inline payload
						let normalizedPayload = wfPayload;

						this.logger.info(`[PrivateWorkflowTrigger] payloadType = ${wfPayload.type}`);

						if (wfPayload.type === 'reference') {
							const referenceUrl = wfPayload.value;

							this.logger.info('[PrivateWorkflowTrigger] Fetching reference payload');

							if (!referenceUrl) {
								throw new NodeOperationError(this.getNode(), 'Reference payload missing value/url');
							}

							const refResponse = await this.helpers.httpRequestWithAuthentication.call(
								this,
								'privateWorkflowApi',
								{
									method: 'GET',
									url: referenceUrl,
									encoding: 'arraybuffer',
								},
							);

							const buffer = Buffer.isBuffer(refResponse) ? refResponse : Buffer.from(refResponse);
							let decodedValue: string;

							switch (wfPayload.encoding) {
								case 'base64':
									decodedValue = buffer.toString('base64');
									break;

								case 'json':
								case 'text':
									decodedValue = buffer.toString('utf8');
									break;

								default:
									throw new NodeOperationError(
										this.getNode(),
										`Unsupported payload encoding: ${wfPayload.encoding}`,
									);
							}

							normalizedPayload = {
								...wfPayload,
								type: 'inline',
								value: decodedValue,
							};
						}

						const outItem: INodeExecutionData = {
							json: {
								__correlationId: correlationId,
							},
						};
						if (normalizedPayload.type === 'inline' && normalizedPayload.encoding === 'base64') {
							outItem.binary = {
								file: {
									data: normalizedPayload.value, // base64 (no re-encoding!)
									fileName: 'data',
									mimeType: 'application/octet-stream',
								},
							};
						}
						if (normalizedPayload.type === 'inline' && normalizedPayload.encoding !== 'base64') {
							const jsonValue = JSON.parse(normalizedPayload.value);

							// Block arrays.  User must wrap them.
							if (Array.isArray(jsonValue)) {
								throw new NodeOperationError(
									this.getNode(),
									'Private Workflow Trigger does not accept array payloads.  Arrays must be wrapped in the Execute Private Workflow node. ',
								);
							}
							if (typeof jsonValue !== 'object' || jsonValue === null || Array.isArray(jsonValue)) {
								throw new NodeOperationError(
									this.getNode(),
									'Private workflow payload must be a single JSON object',
								);
							}

							// Emit exactly what was sent to the hub
							Object.assign(outItem.json, jsonValue);
						}

						// Start the workflow by emitting the outItem
						this.emit([[outItem]]);

						switch (respondMode) {
							// Respond immediately
							case 'immediately': {
								this.logger.info('[PrivateWorkflowTrigger] Sending immediate response to hub...');

								if (!hubInfo) {
									this.logger.error(
										'[PrivateWorkflowTrigger] hubInfo not available for immediate response',
									);
									return;
								}

								const payloadValue = JSON.stringify({
									correlationId: correlationId,
									path: hubPath,
									status: 'Running',
								});
								const ackPayload: PrivateWorkflowPayload = {
									type: 'inline',
									value: payloadValue,
									encoding: 'json',
									isEncrypted: false,
									length: payloadValue.length,
								};

								// Send status to hub based on user configuration
								// "Completed": request accepted, workflow running independently (clears hub cache immediately)
								// "Running": workflow is running (hub cache expires at timeout)
								const completedUrl = `${hubInfo.apiUrl.replace(/\/+$/, '')}/completed/${encodeURIComponent(correlationId)}`;
								const completedResponse = {
									correlationId,
									status: immediateResponseStatus,
									payload: ackPayload,
								};

								try {
									await this.helpers.httpRequestWithAuthentication.call(
										this,
										'privateWorkflowApi',
										{
											method: 'POST',
											url: completedUrl,
											headers: {
												accept: 'application/json',
											},
											body: completedResponse,
											json: true,
										},
									);
									this.logger.info('[PrivateWorkflowTrigger] Immediate response sent via POST');
								} catch (err) {
									this.logger.warn(
										`[PrivateWorkflowTrigger] Failed to send immediate response: ${err}`,
									);
								}

								// Do NOT return an object — this tells n8n we are done
								return;
							}

							// Deferred response, handled by the Respond to Private Workflow node
							case 'respondToPrivateWorkflow': {
								this.logger.info(
									`[PrivateWorkflowTrigger] Deferred response mode active for correlationId=${correlationId} (requestId=${requestId})`,
								);
								return;
							}

							// Default fallback
							default: {
								this.logger.warn(`Unknown respond mode: ${respondMode}`);
								this.emit([this.helpers.returnJsonArray([base])]);
								return { ok: true, receivedAt: new Date().toISOString() };
							}
						}
					} catch (err) {
						this.logger.error(`Error in onExecute: ${(err as Error)?.message ?? err}`);
						return { ok: false, error: String(err) };
					}
				},

				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				onConnectionError: async (err: unknown, _ctx?: Record<string, unknown>) => {
					try {
						await client?.stop();
						this.logger.warn(`SignalR connection stopped due to error: ${String(err)}`);
					} catch (stopErr) {
						this.logger.warn(`Error stopping SignalR: ${(stopErr as Error)?.message ?? stopErr}`);
					}

					// Properly propagate the error to n8n so the trigger terminates
					throw new NodeApiError(this.getNode(), err as JsonObject, {
						message: err instanceof Error ? err.message : String(err),
					});
				},

				onConnectionLost: async (err: unknown) => {
					if (isReconnecting) {
						this.logger.info('Connection lost again — reconnect already in progress, ignoring');
						return;
					}
					isReconnecting = true;
					this.logger.warn(`Connection lost (all quick reconnects failed): ${String(err)}`);

					// Stop the old client to clean up resources and event handlers
					if (client) {
						try {
							await client.stop();
							this.logger.info('Old SignalR client stopped');
						} catch (stopErr) {
							this.logger.warn(
								`Error stopping old SignalR client: ${(stopErr as Error)?.message ?? stopErr}`,
							);
						}
					}

					this.logger.info('Resetting connection — will re-fetch hubInfo and reconnect...');
					started = false;
					startingPromise = null;
					// Re-enter the full retry loop (getHubInfo → create client → connect)
					ensureStarted()
						.catch((retryErr) => {
							this.logger.error(
								`Full reconnect failed: ${(retryErr as Error)?.message ?? retryErr}`,
							);
						})
						.finally(() => {
							isReconnecting = false;
						});
				},
			});

			client = conn;
			await conn.start();
			started = true;
		};

		// ensureStarted: idempotent activation with two-phase retry
		const ensureStarted = async () => {
			if (started) return;
			if (!startingPromise) {
				startingPromise = (async () => {
					// Manual runs: fail immediately, no retry
					if (isManualRun) {
						await connectToHub();
						this.logger.info('SignalR connection established (ensureStarted, manual)');
						return;
					}

					// Production: two-phase retry loop
					const retryStart = Date.now();
					let delay = 0;
					let failedAttempts = 0;
					const quickRetry4sCount = 3;
					const quickRetry8sCount = 4;
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					let lastError: any;

					while (true) {
						if (delay > 0) {
							await setTimeoutPromise(delay);
						}

						const elapsed = Date.now() - retryStart;
						if (elapsed >= RETRY_MAX_DURATION_MS) {
							const err = lastError ?? new Error('Max retry duration exceeded');
							this.logger.error(
								`Activation failed after ${Math.round(elapsed / 60_000)} minutes: ${err?.message ?? err}`,
							);
							throw err;
						}

						try {
							await connectToHub();
							this.logger.info('SignalR connection established (ensureStarted)');
							return;
						} catch (e) {
							lastError = e;
							failedAttempts++;

							// Compute next delay based on phase
							const elapsedNow = Date.now() - retryStart;
							if (failedAttempts <= quickRetry4sCount) {
								delay = 4_000;
							} else if (failedAttempts <= quickRetry4sCount + quickRetry8sCount) {
								delay = 8_000;
							} else if (elapsedNow < RETRY_PHASE1_DURATION_MS) {
								delay =
									delay <= 8_000
										? RETRY_INITIAL_DELAY_MS
										: Math.min(delay * 2, RETRY_PHASE1_CAP_MS);
								if (delay < 8_000) {
									delay = 8_000;
								}
							} else {
								delay = RETRY_PHASE2_INTERVAL_MS;
							}

							this.logger.info(
								`Activation retry in ${delay / 1000}s (elapsed: ${Math.round(elapsedNow / 1000)}s)`,
							);
						}
					}
				})().catch((err) => {
					startingPromise = null;
					throw err;
				});
			}
			await startingPromise;
		};

		// Start on activation so scheduled/active workflows connect immediately
		await ensureStarted();

		// Clean shutdown when the workflow deactivates
		const closeFunction = async () => {
			try {
				await client?.stop();
				started = false;
				this.logger.info('SignalR client stopped.');
			} catch (e) {
				this.logger.warn(`Error while stopping SignalR: ${(e as Error)?.message ?? e}`);
			}
		};

		// Manual execution in the editor
		const manualTriggerFunction = async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const anyThis = this as any;

			// Ensure SignalR client is connected
			await ensureStarted();
			const conn = client;
			if (!conn) return;

			const isManual = this.getMode() === 'manual';

			// Manual test mode only affects this function
			if (isManual) {
				this.logger.info('[ManualMode] Manual run — waiting for one SignalR message…');

				let cancelled = false;
				anyThis.onCancel?.(() => {
					cancelled = true;
					this.logger.warn('[ManualMode] Cancel pressed — stopping client.');
					try {
						conn.stop();
					} catch {
						/* stop error suppressed */
					}
				});

				try {
					// Wait for exactly one message — onExecute will handle emitting + SignalR reply
					await conn.waitForNextMessage(MANUAL_WAIT_TIMEOUT_MS);

					if (cancelled) {
						this.logger.warn('[ManualMode] Cancelled — exiting.');
						return;
					}

					this.logger.info('[ManualMode] Message received — closing connection.');

					// Resolve any queued one-shot resolver (if used)
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const resolver = (conn as any).onceResolvers?.shift?.();
					if (resolver) resolver();

					// DO NOT sendResponseToHub here — onExecute already did it
					await conn.stop();
					this.logger.info('[ManualMode] SignalR connection closed.');
				} catch (err) {
					this.logger.warn(`[ManualMode] Timeout or error: ${err}`);
					try {
						await conn.stop();
					} catch {
						/* stop error suppressed */
					}
				}

				return;
			}

			// Normal workflow mode: do nothing special here (onExecute + Respond Node handle everything)
			this.logger.info('[WorkflowMode] Workflow run — trigger standing by.');
		};

		return {
			closeFunction,
			manualTriggerFunction,
		};
	}
}
