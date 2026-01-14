import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
	NodeOperationError
} from 'n8n-workflow';
import { PrivateWorkflowResponseRegistry } from '../../library/PrivateWorkflowResponseRegistry';
import type { WorkflowPayloadEncoding } from '../../library/WorkflowPayloadEncoding';


export class RespondToPrivateWorkflow implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Respond to Private Workflow 0031',
		name: 'respondToPrivateWorkflow',
		group: ['output'],
		version: 1,
		description: 'Sends a response back to the Private Workflow Trigger via SignalR RESPOND NODE - NEW DEFAULT LOADED',
		icon: 'file:cloud-network-chevron-response.svg',
		defaults: {
			name: 'Respond to Private Workflow',
			color: '#00c896',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Respond With',
				name: 'respondWith',
				type: 'options',
				default: 'allItems',
				description: 'What data should be returned to the Private Workflow Trigger',
				options: [
					{
						name: 'All Incoming Items',
						value: 'allItems',
						description: 'Return all incoming items as JSON objects (binary data is not supported).'
					},
					{
						name: 'Binary File',
						value: 'binary',
						description: 'Return a binary file from the incoming items.'
					},
					{
						name: 'First Incoming Item',
						value: 'firstItem',
						description: 'Return the first incoming item as a JSON object (binary data is not supported).'
					},
					{
						name: 'JSON',
						value: 'json',
						description: 'Return a custom JSON object defined in this node.'
					},
					{
						name: 'No Data',
						value: 'none',
						description: 'Return no response payload.'
					},
					{
						name: 'Text',
						value: 'text',
						description: 'Return a plain text response.'
					},
				],

			},

			// ---------- JSON Response ----------
			{
				displayName: 'Response Body',
				name: 'responseData',
				type: 'string',
				typeOptions: {
					rows: 4
				},
				default: ``,
				description: 'The JSON to send in the response',
				displayOptions: {
					show: {
						respondWith: ['json'],
					},
				},
			},

			// ---------- Text Response ----------
			{
				displayName: 'Response Text',
				name: 'responseText',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				placeholder: 'Enter plain text response here...',
				description: 'Text to return to the Private Workflow Trigger',
				displayOptions: {
					show: {
						respondWith: ['text'],
					},
				},
			},

			// ---------- Binary Source Mode ----------
			{
				displayName: 'Response Data Source',
				name: 'binaryMode',
				type: 'options',
				default: 'auto',
				description: 'How to select the binary data to return',
				displayOptions: {
					show: {
						respondWith: ['binary'],
					},
				},
				options: [
					{
						name: 'Choose Automatically from Input',
						value: 'auto',
						description: 'Use the first binary property found on the incoming item',
					},
					{
						name: 'Specify Myself',
						value: 'manual',
						description: 'Select a specific binary property from input',
					},
				],
			},
			{
				displayName: 'Correlation ID',
				name: 'correlationId',
				type: 'string',
				default: '',
				required: true,
				description:
					'Select the correlation ID from your Private Workflow Trigger output, e.g. {{ $("Private Workflow Trigger").item.json.__correlationId }}',
				hint: 'Use expression editor to choose it from your trigger node',
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property to return',
				displayOptions: {
					show: {
						respondWith: ['binary'],
						binaryMode: ['manual'],
					},
				},
			},
		]
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		this.logger.info(`getInputData() returns: ${JSON.stringify(items)}`)
		const outputItems: INodeExecutionData[] = [];

	  const correlationId = this.getNodeParameter('correlationId', 0) as string;
		const entry = PrivateWorkflowResponseRegistry.get(correlationId);

		if (!entry) {
			this.logger?.warn?.(
				`[RespondToPrivateWorkflow] No pending SignalR entry for correlation=${correlationId}`
			);
			// still return items so workflow debugging isn't broken
			return [items];
		}

		//let payload: any;
		let encoding: WorkflowPayloadEncoding = "json";

		const respondWith = this.getNodeParameter('respondWith', 0) as string;

		// // Helper: extract the payload interior only
		// const extractPayload = (item: INodeExecutionData) => {
		// 	const { payload } = item.json as any;
		// 	return payload ?? null;
		// };

		// ---------------------------------------------------------------------
		// Send the response
		// ---------------------------------------------------------------------
		const sendResponseToHubSafe = async (
			correlationId: string,
			status: 'Completed' | 'Failed',
			requestId: string,
			basePayload: any,
			path: string,
			encoding: WorkflowPayloadEncoding,
			client: {
				sendResponseToHub: (
					correlationId: string,
					status: string,
					requestId: string,
					payload: IDataObject,
					path: string,
					encoding: WorkflowPayloadEncoding
				) => Promise<void>;
			},
		): Promise<void> => {

			let payload = basePayload;

			if (status === 'Failed') {
				if (basePayload instanceof Error) {
					payload = {
						error: true,
						message: basePayload.message,
						code: 'RESPOND_NODE_ERROR',
						retryable: false,
						encoding: encoding
					};
				} else if (basePayload == null) {
					payload = {
						error: true,
						message: 'Unknown error',
						code: 'RESPOND_NODE_ERROR',
						retryable: false,
						encoding: encoding
					};
				}
			}

			await client.sendResponseToHub(
				correlationId,
				status,
				requestId,
				payload,
				path,
				encoding
			);
		};

		try
		{
			let payload: any;
			switch (respondWith) {

				case 'allItems': {
					// 1️⃣ Reject binary explicitly
					for (const item of items) {
						if (item.binary && Object.keys(item.binary).length > 0) {
							throw new NodeOperationError(
								this.getNode(),
								'"All Items" response does not support binary data. Use "Binary File" instead.'
							);
						}
					}

					// 2️⃣ Collect JSON items
					const jsonItems: IDataObject[] = [];

					for (const item of items) {
						if (item.json && typeof item.json === 'object') {
							jsonItems.push(item.json as IDataObject);
							outputItems.push({ json: item.json as IDataObject });
						}
					}

					// 3️⃣ Hub payload = array of JSON objects
					payload = jsonItems;
					break;
				}

				case 'firstItem': {
					// Reuse allItems logic
					if (items.length === 0) {
						//payload = null;
						outputItems.push({ json: {} });
						break;
					}

					const item = items[0];

					if (item.binary && Object.keys(item.binary).length > 0) {
						throw new NodeOperationError(
							this.getNode(),
							'"First Item" response does not support binary data. Use "Binary File" instead.'
						);
					}

					if (!item.json || typeof item.json !== 'object' || Array.isArray(item.json)) {
						throw new NodeOperationError(
							this.getNode(),
							'"First Item" requires the item to be a JSON object.'
						);
					}

					const clean = { ...(item.json as IDataObject) };
					delete (clean as any).__correlationId;

					payload = clean;
					outputItems.push({ json: clean });
					break;
				}

				case 'json': {
					const raw = this.getNodeParameter('responseData', 0);
					let parsed: IDataObject | IDataObject[] | null;

					// Already a resolved object or array (expression like {{ $json.client }})
					if (raw !== null && typeof raw === 'object') {
						// Deep clone to detach n8n internals
						parsed = JSON.parse(JSON.stringify(raw));
					}

					// String → attempt JSON.parse (JSON literal with expressions)
					else if (typeof raw === 'string') {
						const trimmed = raw.trim();

						if (!trimmed) {
							throw new NodeOperationError(
								this.getNode(),
								'Response Body is empty; expected valid JSON'
							);
						}

						try {
							parsed = JSON.parse(trimmed);
						} catch {
							throw new NodeOperationError(
								this.getNode(),
								'Response Body must contain valid JSON'
							);
						}
					}

					// Everything else is invalid
					else {
						throw new NodeOperationError(
							this.getNode(),
							`Response Body resolved to unsupported type (${typeof raw})`
						);
					}

					// Canonical hub payload
					payload = parsed;

					// Canonical n8n output
					if (Array.isArray(parsed)) {
						outputItems.push(
							...parsed.map(p => ({ json: p as IDataObject }))
						);
					} else {
						outputItems.push({ json: parsed as IDataObject });
					}

					break;
				}

				case 'text': {
					const text = String(this.getNodeParameter('responseText', 0));
					payload = text;
					encoding = "text";

					// workflow output: keep it JSON-safe
					outputItems.push({
						json: { "text": text },
					});

					break;
				}

				case 'binary': {
					encoding = "base64";
					const binaryMode = this.getNodeParameter('binaryMode', 0) as string;

					let binaryData;
					let binaryPropertyName: string | undefined;

					if (binaryMode === 'manual') {
						binaryPropertyName = this.getNodeParameter('binaryPropertyName', 0) as string;
						binaryData = items[0].binary?.[binaryPropertyName];
					} else {
						const binaryObj = items[0].binary;
						if (binaryObj && Object.keys(binaryObj).length > 0) {
							binaryPropertyName = Object.keys(binaryObj)[0];
							binaryData = binaryObj[binaryPropertyName];
						}
					}

					if (!binaryData || !binaryPropertyName) {
						this.logger?.warn?.(
							`[RespondToPrivateWorkflow] No binary data for correlation=${correlationId}`
						);

						payload = null;

						outputItems.push({
							json: { correlationId, status: 'Success' },
						});

					} else {
						// Extract the binary base64 code as n8n expects
						payload = binaryData.data;

						outputItems.push({
							json: { correlationId, status: 'Success' },
							binary: {
								[binaryPropertyName]: binaryData,
							},
						});
					}

					break;
				}

				case 'none':
				default:
					payload = null;
					encoding = "none";
						outputItems.push({
							json: { correlationId, status: 'Success' },
						});
					break;
			}

			//const responseItem: any = outputItems[0];
			// const responseItem: any = payload;

			// Clean JSON for hub
			// let hubPayload: IDataObject | string | null = null;

			// if (respondWith === 'text') {
			// 	hubPayload = responseItem.json as string;
			// }
			// else if (respondWith === 'json') {
			// 	const clean = { ...(responseItem.json as IDataObject) };
			// 	delete (clean as any).__correlationId;
			// 	hubPayload = clean;
			// }
			// else if (respondWith === 'binary') {
			// 	const clean = { ...(responseItem.json as IDataObject) };
			// 	delete (clean as any).__correlationId;

			// 	if (responseItem.binary?.file) {
			// 		(clean as IDataObject).__binary = {
			// 			data: responseItem.binary.file.data,
			// 			mimeType: responseItem.binary.file.mimeType,
			// 			fileName: responseItem.binary.file.fileName,
			// 		};
			// 	}

			// 	hubPayload = clean;
			// }
			// else {
			// 	hubPayload = null;
			// }


			// ------------------------------------------------------------------------------------
			// Cleanup internal fields (__correlationId)
			// ------------------------------------------------------------------------------------

			// Clean workflow output items
			for (let i = 0; i < outputItems.length; i++) {
				const item = outputItems[i];
				const json = item.json;

				if (json && typeof json === 'object' && !Array.isArray(json)) {
					const clean = { ...(json as IDataObject) };
					delete (clean as any).__correlationId;
					outputItems[i] = {
						...item,
						json: clean,
					};
				}
			}

			// Clean hub payload
			if (Array.isArray(payload)) {
				for (let i = 0; i < payload.length; i++) {
					const obj = payload[i];
					if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
						const clean = { ...(obj as IDataObject) };
						delete (clean as any).__correlationId;
						payload[i] = clean;
					}
				}
			} else if (payload && typeof payload === 'object') {
				const clean = { ...(payload as IDataObject) };
				delete (clean as any).__correlationId;
				payload = clean;
			}

			// Capture binary from outputItems (hub path)
			let binaryPayload: IDataObject | null = null;
			if (outputItems.length > 0 && outputItems[0].binary?.file) {
				const bin = outputItems[0].binary.file;

				binaryPayload = {
					data: bin.data,
					mimeType: bin.mimeType,
					fileName: bin.fileName,
				};
			}

			// Canonical payload
			let basePayload: IDataObject | IDataObject[] | string | null;

			if (payload === null) {
				basePayload = null;
			} else if (typeof payload === 'string') {
					// Strings are only valid in TEXT mode
					if (respondWith === 'text' || respondWith === 'binary') {
						basePayload = payload; // send raw string to hub
					} else {
						// Defensive: user misconfigured something
						throw new NodeOperationError(
							this.getNode(),
							'[RespondToPrivateWorkflow] Payload resolved to string; expected JSON object. ' +
							'Use "Text" response type for plain text.'
						);
					}
			} else if (typeof payload === 'object') {
				// Deep clone to break n8n refs
				basePayload = JSON.parse(JSON.stringify(payload));
				this.logger.info(`object type base payload: ${JSON.stringify(basePayload)}`);
			} else {
				throw new NodeOperationError(this.getNode(), `[RespondToPrivateWorkflow] Invalid payload type: ${typeof payload}`);
			}

			// Attach binary to the hub payload (if present)
			if (binaryPayload && basePayload && typeof basePayload === 'object') {
				(basePayload as IDataObject).__binary = binaryPayload;
			}

			// ------------------------------------------------------------------------------------
			// Send a single response to the hub AFTER collecting payload
			// ------------------------------------------------------------------------------------
			this.logger?.info?.(
				`[RespondToPrivateWorkflow] Sending response → req=${entry.requestId}, corr=${correlationId}, mode=${respondWith}`
			);

			await sendResponseToHubSafe(
				correlationId,
				'Completed',
				entry.requestId,
				basePayload,
				entry.path,
				encoding,
				entry.client
			);

			// Cleanup once
			clearTimeout(entry.timeout);
			PrivateWorkflowResponseRegistry.delete(correlationId);

			this.logger?.info?.(
				`[RespondToPrivateWorkflow] ✅ Response sent & cleared (corr=${correlationId})`
			);

			// Return items to workflow
			return [outputItems];
		}
		catch(err)
		{
			// 1️⃣ Send failure to hub (best effort)
			try {
				await sendResponseToHubSafe(
					entry.correlationId,
					'Failed',
					entry.requestId,
					err,          // can be Error or payload
					entry.path,
					"json",
					entry.client
				);
			}
			catch (hubErr) {
				// Never let hub failures mask the real error
				this.logger.error(
					'[RespondToPrivateWorkflow] Failed to report error to hub',
					hubErr
				);
			}

			// 2️⃣ Now fail the node properly
			if (err instanceof NodeOperationError) {
				throw err;
			}

			throw new NodeOperationError(
				this.getNode(),
				err instanceof Error ? err.message : String(err)
			);
		}
	}
}
