// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { setTimeout } from 'node:timers';
import {
	ITriggerFunctions,
	INodeType,
	INodeTypeDescription,
	ITriggerResponse,
	NodeOperationError,
	INodeExecutionData,
	jsonStringify
} from 'n8n-workflow';

import { SignalRPrivateWorkflowClient } from '../../lib/SignalRPrivateWorkflowClient'
import { PrivateWorkflowResponseRegistry } from '../../lib/PrivateWorkflowResponseRegistry';
import { HubProfileService } from "../../lib/HubProfileService";
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
					name: 'privateWorkflowPrivateKeyApi',
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
				const hubBase = "https://hub.nodeflex.io";
				const workflowName = this.getNodeParameter('workflowName', 0) as string;
				if (!workflowName)
				{
					throw new NodeOperationError(this.getNode(), "Workflow name is required.");
				}

				const creds = (await this.getCredentials('privateWorkflowPrivateKeyApi')) as {
      		apiKey?: string;
      		accessToken?: string;
    		} | null;

				if (!creds?.apiKey) {
     	 		throw new NodeOperationError(this.getNode(), 'API key is missing. Add it in the node credentials.');
    		}
        const apiKey = creds?.apiKey;

				const hubService = new HubProfileService(hubBase, this);
				const hubInfo: WorkflowHubService | null = await hubService.getHubInfo(apiKey);

				const hubUrl = hubInfo?.hubUrl;
				if (!hubUrl)
				{
     	 		throw new NodeOperationError(this.getNode(), 'Hub URL is unavailable.  Hub service is down.');
				}
				const hubPath = hubInfo.accountPath + "/" + workflowName;
				const blobUrl = hubInfo?.blobStorageUrl;
				if (!blobUrl)
				{
     	 		throw new NodeOperationError(this.getNode(), 'Blob URL is unavailable.  Hub service is down.');
				}
			  self.logger.info(`Resolved hub for path: ${hubPath}`);
				self.logger.info(`${jsonStringify(hubInfo)}`);

        // const accessToken = creds?.accessToken;
        const accessToken = '';

        let started = false;
        let startingPromise: Promise<void> | null = null;

        const client = new SignalRPrivateWorkflowClient({
            hubUrl,
            hubPath,
            apiKey,
            accessToken,
						hubService: hubInfo,
            logLevel: 'info',
						isSingleNodeRun: false,
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

									this.logger.info(`[PrivateWorkflowTrigger] reference URL ${referenceUrl}`)

									if (!referenceUrl) {
										throw new NodeOperationError(this.getNode(), 'Reference payload missing value/url');
									}

									const response = await fetch(referenceUrl, {
										headers: {
											'x-api-key': apiKey, // IMPORTANT if your blob endpoint requires it
										},
									});

									if (!response.ok)
									{
										throw new NodeOperationError(this.getNode(), `Failed to download reference payload (${response.status})`)
									}

									const buffer = Buffer.from(await response.arrayBuffer());
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

								const outItem: INodeExecutionData = {
									json: {
										__correlationId: correlationId
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
												PrivateWorkflowResponseRegistry.delete(correlationId);
												self.logger?.warn?.(
													`[PrivateWorkflowTrigger] Timeout waiting for response correlationId=${correlationId}`
												);
											}, 120_000),
										};

										// Register the pending response in the global registry
										PrivateWorkflowResponseRegistry.register(correlationId, entry);

										self.logger?.info?.(
											`[PrivateWorkflowTrigger] Registered correlationId=${correlationId} for deferred response (requestId=${requestId})`
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
						}
        });

        // Idempotent start helper
        const ensureStarted = async () => {
            if (started) return;
            if (!startingPromise) {
                startingPromise = (async () => {
                    await client.start(); // resolves only after the hub connection is established + registered
                    started = true;
                    startingPromise = null;
                    self.logger.info('SignalR connection established (ensureStarted)');
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
