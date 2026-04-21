// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { clearTimeout } from 'node:timers';
import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
	NodeOperationError
} from 'n8n-workflow';
import { PrivateWorkflowResponseRegistry } from '../../lib/PrivateWorkflowResponseRegistry';
import { PrivateWorkflowPayload, PrivateWorkflowPayloadEncoding } from '../../lib/PrivateWorkflowPayload';
import { WorkflowPayloadBlobTransport } from '../../lib/WorkflowPayloadBlobTransport';
import { IN8nHttpHelper } from '../../lib/N8nHttpHelper';

export class RespondToPrivateWorkflow implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Respond to Private Workflow',
		name: 'respondToPrivateWorkflow',
		group: ['output'],
		version: 1,
		description: 'Sends a response back to the Private Workflow Trigger',
		icon: 'file:icon.svg',
		defaults: {
			name: 'Respond to Private Workflow'
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
						description: 'Return all incoming items as JSON objects (binary data is not supported)'
					},
					{
						name: 'Binary File',
						value: 'binary',
						description: 'Return a binary file from the incoming items'
					},
					{
						name: 'First Incoming Item',
						value: 'firstItem',
						description: 'Return the first incoming item as a JSON object (binary data is not supported)'
					},
					{
						name: 'JSON',
						value: 'json',
						description: 'Return a custom JSON object defined in this node'
					},
					{
						name: 'No Data',
						value: 'none',
						description: 'Return no response payload'
					},
					{
						name: 'Text',
						value: 'text',
						description: 'Return a plain text response'
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
						name: 'Choose Automatically From Input',
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
		    // eslint-disable-next-line n8n-nodes-base/node-param-description-miscased-json
				description: 'Select the correlation ID from your Private Workflow Trigger output, example: {{ $json.__correlationId }}',
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
		const outputItems: INodeExecutionData[] = [];

	  let correlationId = this.getNodeParameter('correlationId', 0) as string;
		correlationId = correlationId.trim();
		const entry = PrivateWorkflowResponseRegistry.get(correlationId);

		if (!entry) {
			this.logger?.warn?.(
				`[RespondToPrivateWorkflow] No pending SignalR entry for correlation=${correlationId}`
			);
			// still return items so workflow debugging isn't broken
			return [items];
		}

		let encoding: PrivateWorkflowPayloadEncoding = "json";
		const respondWith = this.getNodeParameter('respondWith', 0) as string;

		try
		{
			let payload: IDataObject | IDataObject[] | string | null | undefined;
			switch (respondWith) {

				case 'allItems': {
					// Reject binary explicitly
					for (const item of items) {
						if (item.binary && Object.keys(item.binary).length > 0) {
							throw new NodeOperationError(
								this.getNode(),
								'"All Items" response does not support binary data. Use "Binary File" instead.'
							);
						}
					}

					// Collect JSON items
					const jsonItems: IDataObject[] = [];

					for (const item of items) {
						if (item.json && typeof item.json === 'object') {
							jsonItems.push(item.json as IDataObject);
							outputItems.push({ json: item.json as IDataObject });
						}
					}

					// Hub payload = array of JSON objects
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
					delete (clean as Record<string, unknown>).__correlationId;

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
					encoding = "json";
						outputItems.push({
							json: { correlationId, status: 'Success' },
						});
					break;
			}

			// ------------------------------------------------------------------------------------
			// Cleanup internal fields (__correlationId)
			// ------------------------------------------------------------------------------------

			// Clean workflow output items
			for (let i = 0; i < outputItems.length; i++) {
				const item = outputItems[i];
				const json = item.json;

				if (json && typeof json === 'object' && !Array.isArray(json)) {
					const clean = { ...(json as IDataObject) };
					delete (clean as Record<string, unknown>).__correlationId;
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
						delete (clean as Record<string, unknown>).__correlationId;
						payload[i] = clean;
					}
				}
			} else if (payload && typeof payload === 'object') {
				const clean = { ...(payload as IDataObject) };
				delete (clean as Record<string, unknown>).__correlationId;
				payload = clean;
			}

			// ------------------------------------------------------------------------------------
			// Build serialized payload value
			// ------------------------------------------------------------------------------------
			const serializedValue =
				payload == null
					? ''
					: typeof payload === 'string'
						? payload
						: JSON.stringify(payload);

			const payloadLength =
				encoding === 'base64'
					? Buffer.byteLength(serializedValue, 'base64')
					: Buffer.byteLength(serializedValue, 'utf8');

			// ------------------------------------------------------------------------------------
			// Decide transport: inline vs reference (Respond node)
			// ------------------------------------------------------------------------------------
			const hubService = entry.client.getHubService();

			const useReference =
				hubService.useStorage &&
				payloadLength > hubService.maxPayload &&
				!!hubService.blobStorageUrl;

			// ------------------------------------------------------------------------------------
			// Build canonical PrivateWorkflowPayload for hub
			// ------------------------------------------------------------------------------------
			let hubPayload: PrivateWorkflowPayload;

			if (useReference) {

				// Build the buffer to upload based on encoding
				const buffer =
					encoding === 'base64'
						? Buffer.from(serializedValue, 'base64')
						: Buffer.from(serializedValue, 'utf8');

				// Create the blob transport using hub service info
				const apiKey = entry.client.getApiKey();
				if (!apiKey)
				{
					throw new NodeOperationError(this.getNode(), 'API key is not available on Private Workflow Trigger');
				}
				const http: IN8nHttpHelper = { httpRequest: this.helpers.httpRequest.bind(this.helpers) };
				const blobTransport = new WorkflowPayloadBlobTransport({
					baseUrl: hubService.blobStorageUrl,
					apiKey,
					http,
				});

				// Perform the upload (multipart/form-data, field name = "File")
				const uploadResult = await blobTransport.upload(buffer, {
					fileName:
						encoding === 'base64'
							? 'response.bin'
							: encoding === 'json'
								? 'response.json'
								: 'response.txt',
					contentType:
						encoding === 'base64'
							? 'application/octet-stream'
							: encoding === 'json'
								? 'application/json'
								: 'text/plain',
				});

				// Build reference payload
				hubPayload = {
					type: 'reference',
					value: uploadResult.url, // ✅ THIS IS THE URL YOU WANTED
					encoding,
					isEncrypted: false,
					length: payloadLength,
				};

				this.logger?.info?.(
					`[RespondToPrivateWorkflow] Payload uploaded (${payloadLength} bytes) → ${uploadResult.url}`
				);


			} else {
				hubPayload = {
					type: 'inline',
					value: serializedValue,
					encoding,
					isEncrypted: false,
					length: payloadLength,
				};
			}

			// ------------------------------------------------------------------------------------
			// Send a single response to the hub AFTER collecting payload
			// ------------------------------------------------------------------------------------
			this.logger?.info?.(
				`[RespondToPrivateWorkflow] Sending response → corr=${correlationId}, mode=${respondWith}`
			);

			await entry.client.sendResponseToHub(
				correlationId,
				'Completed',
				entry.requestId,
				hubPayload,
				entry.path
			);

			// Cleanup once
			clearTimeout(entry.timeout);
			PrivateWorkflowResponseRegistry.delete(correlationId);

			this.logger?.info?.(
				`[RespondToPrivateWorkflow] Response sent & cleared (corr=${correlationId})`
			);

			// Return items to workflow
			return [outputItems];
		}
		catch(err)
		{
			// 1️⃣ Send failure to hub (best effort)
			try {
				await entry.client.sendResponseToHub(
					entry.correlationId,
					'Failed',
					entry.requestId,
					err,          // can be Error or payload
					entry.path
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
