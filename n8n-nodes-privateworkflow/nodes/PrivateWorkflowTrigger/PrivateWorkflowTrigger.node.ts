import {
	ITriggerFunctions,
	INodeType,
	INodeTypeDescription,
	ITriggerResponse,
	NodeOperationError,
	jsonStringify,
	IDataObject,
	INodeExecutionData
} from 'n8n-workflow';
//import crypto, { OneShotDigestOptionsWithBufferEncoding } from 'crypto'
//import crypto from 'crypto'
import { SignalRPrivateWorkflowClient } from '../../library/SignalRPrivateWorkflowClient'
import { PrivateWorkflowResponseRegistry } from '../../library/PrivateWorkflowResponseRegistry';
import { HubUrlService } from "../../library/HubUrlService";
import { WorkflowHubService } from "../../library/WorkflowHubService";
import { PrivateWorkflowPayload } from '../../library/PrivateWorkflowPayload';

export class PrivateWorkflowTrigger implements INodeType {

	onceResolvers: Array<() => void> = [];

	description: INodeTypeDescription = {
			displayName: 'Private Workflow Trigger',
			name: 'privateWorkflowTrigger',
			group: ['trigger'],
			version: 1,
			description: 'When a remote private workflow is executed',
			icon: 'file:cloud-network-chevron-request.svg',
			defaults: {
				name: 'Private Workflow Trigger',
				color: '#00c896',
			},
			inputs: [],
			outputs: ['main'],
			credentials: [
				{
					name: 'privateWorkflowApiPrivateKey',
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
							name: 'When Last Node Finishes',
							value: 'whenLastNodeFinishes',
							description: 'Returns data of the last-executed node',
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

			  const self = this;
				const hubBase = "https://hub.n8ncloud.io";
				const workflowName = this.getNodeParameter('workflowName', 0) as string;
				if (!workflowName)
				{
					throw new NodeOperationError(this.getNode(), "Workflow name is required.");
				}

				const creds = (await this.getCredentials('privateWorkflowApiPrivateKey')) as {
      		apiKey?: string;
      		accessToken?: string;
    		} | null;

				if (!creds?.apiKey) {
     	 		throw new NodeOperationError(this.getNode(), 'API key is missing. Add it in the node credentials.');
    		}
        var apiKey = creds?.apiKey;
				self.logger.info("Using ApiKey: " + apiKey);

				const hubService = new HubUrlService(hubBase);
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
			  self.logger.info("hubBase: " + hubBase);
				self.logger.info("hubPath: " + hubPath);

				self.logger.info(`Resolved Hub url : ${hubUrl}`);
				self.logger.info(`Resolved Blob url: ${blobUrl}`);

        // const accessToken = creds?.accessToken;
        // const apiKey = 'AN9FMzZ4ZeHgNutVXJ9OdLYIyRha2ovIrTXJAEvjgD9nypxS'; // <-- for testing only
        const accessToken = '';

        let started = false;
        let startingPromise: Promise<void> | null = null;

        const client = new SignalRPrivateWorkflowClient({
            hubUrl,
            hubPath,
            apiKey,
            accessToken,
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
						onExecute: async ({ request, inlineJson, inlineText, payload }) => {

							try {
								// Prepare the item
								const raw = inlineJson ?? inlineText ?? null;

								const base =
										raw && typeof raw === 'object' && 'json' in raw
												? (raw as any).json
												: raw ?? { text: inlineText ?? null };

							  const requestId =
										request?.requestId ?? 'unknown';

  							// Get the respond mode selected in node UI
								var respondMode = this.getNodeParameter('respond', 0) as string;
								const isManual = (this.getMode && this.getMode() === 'manual');
								this.logger.info("isManual " + isManual);
								this.logger.info('respondMode: '+ respondMode);
								this.logger.info('requestId: ' + requestId);
								this.logger.info('inlineJson: ' + jsonStringify(inlineJson));
								this.logger.info('inlineText: ' + inlineText);

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

								// Emit to workflow (starts a new execution in n8n)
								let workflowItems: IDataObject[];
								if (Array.isArray(base)) {
									// base is an array → each element should be an object or item with a json
									workflowItems = base.map((i: any) => ('json' in i ? i.json : i));
								} else if (typeof base === 'object' && base !== null) {
									// single object → wrap it in an array
									workflowItems = [base as IDataObject];
								} else {
									// fallback for primitives (string, number, etc.)
									workflowItems = [{ value: base }];
								}

								// Decode the workflow request payload
								const wfPayload = request.payload as PrivateWorkflowPayload;

								let outItem: INodeExecutionData = {
									json: {
										__correlationId: correlationId,
										meta: {
											trigger: this.getNode().name,
											timestamp: new Date().toISOString(),
										},
									},
								};
								if (wfPayload.type === 'inline' && wfPayload.encoding === 'base64') {
									outItem.binary = {
										file: {
											data: wfPayload.value, // base64 (no re-encoding!)
											fileName: 'data',
											mimeType: 'application/octet-stream',
										},
									};
								}
								if (wfPayload.type === 'inline' && wfPayload.encoding !== 'base64') {
									const jsonValue = JSON.parse(wfPayload.value);
									workflowItems = Array.isArray(jsonValue)
										? jsonValue
										: [jsonValue];

									outItem.json.workflowItems = workflowItems;
								}
								if (wfPayload.type === 'reference') {
									// You decide how to fetch (HTTP, signed URL, etc.)
									const response = await fetch(wfPayload.url);
									const buffer = Buffer.from(await response.arrayBuffer());
									outItem.binary = {
										file: {
											data: buffer.toString('base64'),
											fileName: 'payload.bin',
											mimeType: response.headers.get('content-type') ?? 'application/octet-stream',
										},
									};
								}
								this.emit([[outItem]]);

								switch (respondMode) {

									// ------------------------------------------------------------------------------------------------
									// 1️⃣ Respond Immediately
									// ------------------------------------------------------------------------------------------------
									case 'immediately': {

										// this.emit([[outItem]]);
										self.logger?.info?.('[Trigger] Sending immediate response to hub...');

										// Send hub response right here
										void client.sendResponseToHub(
											correlationId,
											'Running',
											requestId,
											{ ok: true, mode: respondMode, receivedAt: new Date().toISOString() },
											hubPath,
										).catch(err =>
											self.logger?.warn?.(`[Trigger] sendResponseToHub error: ${err}`)
										);

										// ✅ Do NOT return an object — this tells n8n “we're done”
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
									// 3️⃣ When Last Node Finishes  (placeholder – implemented later)
									// ------------------------------------------------------------------------------------------------
									case 'whenLastNodeFinishes': {
										// We'll fill this in next: wait until workflow execution finishes automatically
										// For now, behave same as immediate
										self.emit([self.helpers.returnJsonArray([base])]);
										return {
											ok: true,
											mode: respondMode,
											receivedAt: new Date().toISOString(),
											message: 'Placeholder until implemented',
										};
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

						onConnectionError: async (err: unknown, ctx?: Record<string, unknown>) => {
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
							try { client.stop(); } catch {}
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
							const resolver = (client as any).onceResolvers?.shift?.();
							if (resolver) resolver();

							// ✅ DO NOT sendResponseToHub here — onExecute already did it
							await client.stop();
							self.logger.info('[ManualMode] SignalR connection closed. ✅');
						} catch (err) {
							self.logger.warn(`[ManualMode] Timeout or error: ${err}`);
							try { await client.stop(); } catch {}
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
