// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
// import { setTimeout } from 'node:timers';
import {
	ITriggerFunctions,
	INodeType,
	INodeTypeDescription,
	ITriggerResponse,
	NodeOperationError,
	INodeExecutionData,
} from 'n8n-workflow';

import { SignalRPrivateWorkflowClient } from '../../lib/SignalRPrivateWorkflowClient'
import { PrivateWorkflowResponseRegistry } from '../../lib/PrivateWorkflowResponseRegistry';
import { HubProfileService } from "../../lib/HubProfileService";
import { HUB_BASE_URL } from "../../lib/HubConfig";
import { IN8nHttpHelper } from "../../lib/N8nHttpHelper";
import { WorkflowHubService } from "../../lib/WorkflowHubService";
import { PrivateWorkflowPayload } from '../../lib/PrivateWorkflowPayload';

export class PrivateWorkflowTrigger implements INodeType {

	onceResolvers: Array<() => void> = [];

	description: INodeTypeDescription = {
			displayName: 'Private Workflow Trigger',
			name: 'privateWorkflowTrigger',
			group: ['trigger'],
			usableAsTool: true,
			version: 1,
			description: 'When a remote private workflow is executed',
			icon: 'file:icon.svg',
			defaults: {
				name: 'Private Workflow Trigger'
			},
			inputs: [],
			outputs: ['main'],
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
							name: 'Using \'Respond to Private Workflow\' Node',
							value: 'respondToPrivateWorkflow',
							description: 'Wait for a dedicated \'Respond to Private Workflow\' node to send a response',
						},
					],
				},
			],
		};

		// ------------------------------------------------------------------------------------------------------------------------------------------------
		// trigger is called when n8n runs the workflow trigger
		// ------------------------------------------------------------------------------------------------------------------------------------------------
    async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {

			  // eslint-disable-next-line @typescript-eslint/no-this-alias
			  const self = this;
				const http: IN8nHttpHelper = { httpRequest: this.helpers.httpRequest.bind(this.helpers) };
				const hubBase = HUB_BASE_URL;
				const workflowName = this.getNodeParameter('workflowName', 0) as string;
				if (!workflowName)
				{
					throw new NodeOperationError(this.getNode(), "Workflow name is required.");
				}

				const creds = (await this.getCredentials('privateWorkflowApi')) as {
      		apiKey?: string;
      		accessToken?: string;
    		} | null;

				if (!creds?.apiKey) {
     	 		throw new NodeOperationError(this.getNode(), 'API key is missing. Add it in the node credentials.');
    		}
        const apiKey = creds?.apiKey;
				const isManualRun = !!(this.getMode && this.getMode() === 'manual');

        // const accessToken = creds?.accessToken;
        const accessToken = '';

        let started = false;
        let startingPromise: Promise<void> | null = null;
        let isReconnecting = false;

				// Mutable client reference — reassigned on each retry attempt
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				let client: SignalRPrivateWorkflowClient = null as any;
				let hubPath = '';
				let hubInfo: WorkflowHubService | null = null;

				// -----------------------------------------------------------------------
				// Two-phase retry budget (applies to entire activation: hub fetch + connect)
				// -----------------------------------------------------------------------
				const RETRY_MAX_DURATION_MS = 28_800_000;   // 8 hours
				const RETRY_INITIAL_DELAY_MS = 2_000;
				const RETRY_PHASE1_CAP_MS = 60_000;         // 60s cap during phase 1
				const RETRY_PHASE1_DURATION_MS = 3_600_000;  // 1 hour
				const RETRY_PHASE2_INTERVAL_MS = 900_000;    // 15 minutes

				// -----------------------------------------------------------------------
				// connectToHub: fetches hub info, creates client, and starts connection.
				// Throws on any failure so the retry loop can catch and retry.
				// -----------------------------------------------------------------------
				const connectToHub = async () => {

					const hubService = new HubProfileService(hubBase, http);
					hubInfo = await hubService.getHubInfo(apiKey);

					const hubUrl = hubInfo?.hubUrl;
					if (!hubUrl)
					{
						throw new NodeOperationError(self.getNode(), 'Hub URL is unavailable.  Hub service is down.');
					}
					hubPath = hubInfo.accountPath + "/" + workflowName;
					const blobUrl = hubInfo?.blobStorageUrl;
					if (!blobUrl)
					{
						throw new NodeOperationError(self.getNode(), 'Blob URL is unavailable.  Hub service is down.');
					}
					self.logger.info('Hub endpoints resolved');

					client = new SignalRPrivateWorkflowClient({
							hubUrl,
							hubPath,
							apiKey,
							accessToken,
							hubService: hubInfo,
							logLevel: 'info',
							isSingleNodeRun: isManualRun,
							retryMaxDurationMs: RETRY_MAX_DURATION_MS,
							retryInitialDelayMs: RETRY_INITIAL_DELAY_MS,
							retryPhase1CapMs: RETRY_PHASE1_CAP_MS,
							retryPhase1DurationMs: RETRY_PHASE1_DURATION_MS,
							retryPhase2IntervalMs: RETRY_PHASE2_INTERVAL_MS,
							logger: {
										info: (m, ...a) => self.logger.info(m, ...a),
										warn: (m, ...a) => self.logger.warn(m, ...a),
										error: (m, ...a) => self.logger.error(m, ...a),
							},

							// -------------------------------------------------------------------------------------------------------------------------------------------
							// onExecute is called when the SignalR connection receives a message from the hub
							//   The payload may be encrypted. If we have a privateKey defined, then we must decrypt
							//   the payload before we use it
							// -------------------------------------------------------------------------------------------------------------------------------------------
							// eslint-disable-next-line @typescript-eslint/no-unused-vars
							onExecute: async ({ request, inlineJson, inlineText, payload: _payload }) => {

								this.logger.info(`[PrivateWorkflowTrigger] onExecute()`);
								try {
									const raw = inlineJson ?? inlineText ?? null;

									const base =
											raw && typeof raw === 'object' && 'json' in raw
													? (raw as Record<string, unknown>).json
													: raw ?? { text: inlineText ?? null };

									const requestId = request?.requestId ?? 'unknown';

									let respondMode = this.getNodeParameter('respond', 0) as string;
									const isManual = (this.getMode && this.getMode() === 'manual');
									this.logger.info(`respondMode: ${respondMode}, isManual: ${isManual}`);

									// Override respond mode for manual triggers
									if (isManual && respondMode !== 'immediately') {
										this.logger.info("[ManualMode] Overriding respondMode to 'immediately' for test run.");
										respondMode = 'immediately';
									}

									// const correlationId = crypto.randomUUID();
									const correlationId = request?.correlationId;
									if (!correlationId || correlationId == "")
									{
										throw new NodeOperationError(this.getNode(), 'CorrelationId is required!');
									}

									// Decode the workflow request payload
									const wfPayload = request.payload as PrivateWorkflowPayload;

									// ------------------------------------------------------------
									// Normalize reference payload → inline payload
									// ------------------------------------------------------------
									let normalizedPayload = wfPayload;

									this.logger.info(`[PrivateWorkflowTrigger] payloadType = ${wfPayload.type}`);

									if (wfPayload.type === 'reference') {
										const referenceUrl = wfPayload.value;

										this.logger.info('[PrivateWorkflowTrigger] Fetching reference payload')

										if (!referenceUrl) {
											throw new NodeOperationError(this.getNode(), 'Reference payload missing value/url');
										}

										// eslint-disable-next-line @n8n/community-nodes/no-http-request-with-manual-auth
										const refResponse = await self.helpers.httpRequest({
											method: 'GET',
											url: referenceUrl,
											headers: {
												'x-api-key': apiKey,
											},
											encoding: 'arraybuffer',
										});

										const buffer = Buffer.isBuffer(refResponse) ? refResponse : Buffer.from(refResponse);
										let decodedValue: string;

										switch(wfPayload.encoding)
										{
											case 'base64':
												decodedValue = buffer.toString('base64');
												break;

											case 'json':
											case 'text':
												decodedValue = buffer.toString('utf8');
												break;

											default:
												throw new NodeOperationError(this.getNode(), `Unsupported payload encoding: ${wfPayload.encoding}`);
										}

										normalizedPayload = {
											...wfPayload,
											type: 'inline',
											value: decodedValue
										};
									}

									// Emit correlation ID with path prefix for tracking
									const pathPrefixedCorrelationId = `${hubPath}/${correlationId}`;

									const outItem: INodeExecutionData = {
										json: {
											__correlationId: pathPrefixedCorrelationId
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
												'Private Workflow Trigger does not accept array payloads.  Arrays must be wrapped in the Execute Private Workflow node. '
											);
										}
										if (typeof jsonValue !== 'object' || jsonValue === null || Array.isArray(jsonValue)) {
											throw new NodeOperationError(
												this.getNode(),
												'Private workflow payload must be a single JSON object'
											);
										}

										// Emit exactly what was sent to the hub
										Object.assign(outItem.json, jsonValue);
									}

									// ------------------------------------------------------------
									// Start the workflow by emitting the outItem
									// ------------------------------------------------------------
									this.emit([[outItem]]);

									switch (respondMode) {

										// ------------------------------------------------------------------------------------------------
										// 1️⃣ Respond Immediately
										// ------------------------------------------------------------------------------------------------
										case 'immediately': {

											self.logger?.info?.('[Trigger] Sending immediate response to hub...');

											const ackPayload: PrivateWorkflowPayload = {
												type: 'inline',
												value: JSON.stringify({
													ok: true,
													mode: respondMode,
													receivedAt: new Date().toISOString(),
												}),
												encoding: 'json',
												isEncrypted: false,
												length: JSON.stringify({
													ok: true,
													mode: respondMode,
													receivedAt: new Date().toISOString(),
												}).length,
											};

											void client.sendResponseToHub(
												correlationId,
												'Running',
												requestId,
												ackPayload,
												hubPath,
											).catch(err =>
												self.logger?.warn?.(`[Trigger] sendResponseToHub error: ${err}`)
											);

											// ✅ Do NOT return an object — this tells n8n we are done
											return;
										}

										// ------------------------------------------------------------------------------------
										// 2️⃣ RESPOND TO PRIVATE WORKFLOW
										// ------------------------------------------------------------------------------------
										case 'respondToPrivateWorkflow': {

											// Create one output item
											// this.emit([[outItem]]);

											const entry = {
												correlationId,
												client,     // the live SignalRPrivateWorkflowClient
												requestId,  // original hub RequestId
												path: hubPath,
												isManual: this.getMode && this.getMode() === 'manual',
												timeout: setTimeout(() => {
													PrivateWorkflowResponseRegistry.delete(hubPath);
													self.logger?.warn?.(
														`[PrivateWorkflowTrigger] Timeout waiting for response path=${hubPath}`
													);
												}, 120_000),
											};

											// Register the pending response using path as the key
											PrivateWorkflowResponseRegistry.register(hubPath, entry);

											self.logger?.info?.(
												`[PrivateWorkflowTrigger] Registered path=${hubPath} for deferred response (requestId=${requestId})`
											);
											return;
										}

										// ------------------------------------------------------------------------------------------------
										// Default fallback
										// ------------------------------------------------------------------------------------------------
										default: {
											self.logger?.warn?.(`Unknown respond mode: ${respondMode}`);
											self.emit([self.helpers.returnJsonArray([base])]);
											return { ok: true, receivedAt: new Date().toISOString() };
										}
									}

								} catch (err) {

									self.logger?.error?.(`Error in onExecute: ${(err as Error)?.message ?? err}`);
									return { ok: false, error: String(err) };
								}
							},

							// eslint-disable-next-line @typescript-eslint/no-unused-vars
							onConnectionError: async (err: unknown, _ctx?: Record<string, unknown>) => {
								try {
									await client?.stop();
									self.logger?.warn?.(`SignalR connection stopped due to error: ${String(err)}`);
								} catch (stopErr) {
									self.logger?.warn?.(`Error stopping SignalR: ${(stopErr as Error)?.message ?? stopErr}`);
								}

								// Properly propagate the error to n8n so the trigger terminates
								const error = err instanceof Error ? err : new Error(String(err));
								throw new NodeOperationError(self.getNode(), error);
							},

							onConnectionLost: (err: unknown) => {
								if (isReconnecting) {
									self.logger?.info?.('Connection lost again — reconnect already in progress, ignoring');
									return;
								}
								isReconnecting = true;
								self.logger?.warn?.(`Connection lost (all quick reconnects failed): ${String(err)}`);
								self.logger?.info?.('Resetting connection — will re-fetch hubInfo and reconnect...');
								started = false;
								startingPromise = null;
								// Re-enter the full retry loop (getHubInfo → create client → connect)
								ensureStarted().catch((retryErr) => {
									self.logger?.error?.(`Full reconnect failed: ${(retryErr as Error)?.message ?? retryErr}`);
								}).finally(() => {
									isReconnecting = false;
								});
							}
					});

					await client.start();
					started = true;
				};

        // -----------------------------------------------------------------------
				// ensureStarted: idempotent activation with two-phase retry
				// -----------------------------------------------------------------------
        const ensureStarted = async () => {
            if (started) return;
            if (!startingPromise) {
                startingPromise = (async () => {

									// Manual runs: fail immediately, no retry
									if (isManualRun) {
										await connectToHub();
										self.logger.info('SignalR connection established (ensureStarted, manual)');
										return;
									}

									// Production: two-phase retry loop
									const retryStart = Date.now();
									let delay = 0;
									// eslint-disable-next-line @typescript-eslint/no-explicit-any
									let lastError: any;

									while (true) {
										if (delay > 0) {
											await new Promise<void>(r => setTimeout(r, delay));
										}

										const elapsed = Date.now() - retryStart;
										if (elapsed >= RETRY_MAX_DURATION_MS) {
											const err = lastError ?? new Error('Max retry duration exceeded');
											self.logger.error(`Activation failed after ${Math.round(elapsed / 60_000)} minutes: ${err?.message ?? err}`);
											throw err;
										}

										try {
											await connectToHub();
											self.logger.info('SignalR connection established (ensureStarted)');
											return;
										} catch (e: any) {
											lastError = e;

											// Compute next delay based on phase
											const elapsedNow = Date.now() - retryStart;
											if (elapsedNow < RETRY_PHASE1_DURATION_MS) {
												delay = delay === 0
													? RETRY_INITIAL_DELAY_MS
													: Math.min(delay * 2, RETRY_PHASE1_CAP_MS);
											} else {
												delay = RETRY_PHASE2_INTERVAL_MS;
											}

											self.logger.info(`Activation retry in ${delay / 1000}s (elapsed: ${Math.round(elapsedNow / 1000)}s)`);
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
				const closeFunction = async function (this: ITriggerFunctions) {
					try {
						await client.stop();
						started = false;
						self.logger?.info('SignalR client stopped.');
					} catch (e) {
						self.logger?.warn(`Error while stopping SignalR: ${(e as Error)?.message ?? e}`);
					}
				};

				//
        // Manual execution in the editor:
				//
				const manualTriggerFunction = async function (this: ITriggerFunctions) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const self = this as any;

					// Ensure SignalR client is connected
					await ensureStarted();

					const isManual = this.getMode && this.getMode() === 'manual';

					// Manual test mode only affects this function
					if (isManual) {
						self.logger.info('[ManualMode] Manual run — waiting for one SignalR message…');

						let cancelled = false;
						self.onCancel?.(() => {
							cancelled = true;
							self.logger.warn('[ManualMode] Cancel pressed — stopping client.');
							try { client.stop(); } catch { /* stop error suppressed */ }
						});

						try {
							// Wait for exactly one message — onExecute will handle emitting + SignalR reply
							await client.waitForNextMessage(60000);

							if (cancelled) {
								self.logger.warn('[ManualMode] Cancelled — exiting.');
								return;
							}

							self.logger.info('[ManualMode] Message received — closing connection.');

							// Resolve any queued one-shot resolver (if used)
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							const resolver = (client as any).onceResolvers?.shift?.();
							if (resolver) resolver();

							// ✅ DO NOT sendResponseToHub here — onExecute already did it
							await client.stop();
							self.logger.info('[ManualMode] SignalR connection closed. ✅');
						} catch (err) {
							self.logger.warn(`[ManualMode] Timeout or error: ${err}`);
							try { await client.stop(); } catch { /* stop error suppressed */ }
						}

						return;
					}

					// ---------------------------------------------------------
					// Normal workflow mode: do nothing special here
					// (onExecute + Respond Node handle everything)
					// ---------------------------------------------------------
					self.logger.info('[WorkflowMode] Workflow run — trigger standing by.');
				};

				return {
						closeFunction,
						manualTriggerFunction: manualTriggerFunction.bind(this),
				};
    }

}
