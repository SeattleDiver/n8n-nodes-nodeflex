import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { HUB_BASE_URL } from '../../lib/HubConfig';
import { HubProfileService } from '../../lib/HubProfileService';
import { IN8nHttpHelper } from '../../lib/N8nHttpHelper';
import {
	PrivateWorkflowPayload,
	PrivateWorkflowPayloadEncoding,
} from '../../lib/PrivateWorkflowPayload';
import { PrivateWorkflowResponse } from '../../lib/PrivateWorkflowResponse';
import { WorkflowPayloadBlobTransport } from '../../lib/WorkflowPayloadBlobTransport';

export class RespondToPrivateWorkflow implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Respond to Private Workflow',
		name: 'respondToPrivateWorkflow',
		icon: { light: 'file:icon.svg', dark: 'file:icon.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["respondWith"]}}',
		description: 'Sends a response back to the Private Workflow Trigger',
		defaults: {
			name: 'Respond to Private Workflow',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'privateWorkflowApi',
				required: true,
			},
		],
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
						description: 'Return all incoming items as JSON objects (binary data is not supported)',
					},
					{
						name: 'Binary File',
						value: 'binary',
						description: 'Return a binary file from the incoming items',
					},
					{
						name: 'First Incoming Item',
						value: 'firstItem',
						description:
							'Return the first incoming item as a JSON object (binary data is not supported)',
					},
					{
						name: 'JSON',
						value: 'json',
						description: 'Return a custom JSON object defined in this node',
					},
					{
						name: 'No Data',
						value: 'none',
						description: 'Return no response payload',
					},
					{
						name: 'Text',
						value: 'text',
						description: 'Return a plain text response',
					},
				],
			},

			// JSON Response
			{
				displayName: 'Response Body',
				name: 'responseData',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: ``,
				description: 'The JSON to send in the response',
				displayOptions: {
					show: {
						respondWith: ['json'],
					},
				},
			},

			// Text Response
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

			// Binary Source Mode
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
				description:
					'Select the correlation ID from your Private Workflow Trigger output, example: {{ $json.__correlationId }}',
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
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const outputItems: INodeExecutionData[] = [];
		const creds = (await this.getCredentials('privateWorkflowApi')) as {
			apiKey?: string;
		} | null;
		const apiKey = creds?.apiKey;
		if (!apiKey) {
			throw new NodeOperationError(
				this.getNode(),
				'API key is missing. Add it in the node credentials.',
			);
		}
		const http: IN8nHttpHelper = { httpRequest: this.helpers.httpRequest.bind(this.helpers) };
		const hubService = new HubProfileService(HUB_BASE_URL, http);
		const hubInfo = await hubService.getHubInfo(apiKey);
		if (!hubInfo.apiUrl) {
			throw new NodeOperationError(this.getNode(), 'API URL is unavailable. Hub service is down.');
		}

		let correlationId = this.getNodeParameter('correlationId', 0) as string;
		correlationId = correlationId.trim();
		if (!correlationId) {
			throw new NodeOperationError(this.getNode(), 'Correlation ID is required.');
		}
		const completedUrl = `${hubInfo.apiUrl.replace(/\/+$/, '')}/completed/${encodeURIComponent(correlationId)}`;

		let encoding: PrivateWorkflowPayloadEncoding = 'json';
		const respondWith = this.getNodeParameter('respondWith', 0) as string;

		try {
			let payload: IDataObject | IDataObject[] | string | null | undefined;
			switch (respondWith) {
				case 'allItems': {
					// Reject binary explicitly
					for (const item of items) {
						if (item.binary && Object.keys(item.binary).length > 0) {
							throw new NodeOperationError(
								this.getNode(),
								'"All Items" response does not support binary data. Use "Binary File" instead.',
							);
						}
					}

					// Collect JSON items
					const jsonItems: IDataObject[] = [];

					for (let idx = 0; idx < items.length; idx++) {
						const item = items[idx];
						if (item.json && typeof item.json === 'object') {
							jsonItems.push(item.json as IDataObject);
							outputItems.push({ json: item.json as IDataObject, pairedItem: { item: idx } });
						}
					}

					// Hub payload = array of JSON objects
					payload = jsonItems;
					break;
				}

				case 'firstItem': {
					// Reuse allItems logic
					if (items.length === 0) {
						outputItems.push({ json: {}, pairedItem: { item: 0 } });
						break;
					}

					const item = items[0];

					if (item.binary && Object.keys(item.binary).length > 0) {
						throw new NodeOperationError(
							this.getNode(),
							'"First Item" response does not support binary data. Use "Binary File" instead.',
						);
					}

					if (!item.json || typeof item.json !== 'object' || Array.isArray(item.json)) {
						throw new NodeOperationError(
							this.getNode(),
							'"First Item" requires the item to be a JSON object.',
						);
					}

					const clean = { ...(item.json as IDataObject) };
					delete (clean as Record<string, unknown>).__correlationId;

					payload = clean;
					outputItems.push({ json: clean, pairedItem: { item: 0 } });
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
								'Response Body is empty; expected valid JSON',
							);
						}

						try {
							parsed = JSON.parse(trimmed);
						} catch {
							throw new NodeOperationError(this.getNode(), 'Response Body must contain valid JSON');
						}
					}

					// Everything else is invalid
					else {
						throw new NodeOperationError(
							this.getNode(),
							`Response Body resolved to unsupported type (${typeof raw})`,
						);
					}

					// Canonical hub payload
					payload = parsed;

					// Canonical n8n output
					if (Array.isArray(parsed)) {
						outputItems.push(
							...parsed.map((p) => ({ json: p as IDataObject, pairedItem: { item: 0 } })),
						);
					} else {
						outputItems.push({ json: parsed as IDataObject, pairedItem: { item: 0 } });
					}

					break;
				}

				case 'text': {
					const text = String(this.getNodeParameter('responseText', 0));
					payload = text;
					encoding = 'text';

					// workflow output: keep it JSON-safe
					outputItems.push({
						json: { text: text },
						pairedItem: { item: 0 },
					});

					break;
				}

				case 'binary': {
					encoding = 'base64';
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
						throw new NodeOperationError(
							this.getNode(),
							'"Binary File" response requires a binary property on the input item, but none was found.',
						);
					}

					// Extract the binary base64 code as n8n expects
					payload = binaryData.data;

					outputItems.push({
						json: { correlationId, status: 'Success' },
						binary: {
							[binaryPropertyName]: binaryData,
						},
						pairedItem: { item: 0 },
					});

					break;
				}

				case 'none':
				default:
					payload = null;
					encoding = 'json';
					outputItems.push({
						json: { correlationId, status: 'Success' },
						pairedItem: { item: 0 },
					});
					break;
			}

			// Cleanup internal fields (__correlationId)

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

			// Build serialized payload value.
			// A null payload with 'json' encoding (the "No Data" mode) must still
			// serialize to valid JSON — an empty string fails JSON.parse when
			// GetPrivateWorkflowResult/Execute later reads the response back.
			const serializedValue =
				payload == null
					? encoding === 'json'
						? '{}'
						: ''
					: typeof payload === 'string'
						? payload
						: JSON.stringify(payload);

			const payloadLength =
				encoding === 'base64'
					? Buffer.byteLength(serializedValue, 'base64')
					: Buffer.byteLength(serializedValue, 'utf8');

			// Decide transport: inline vs reference (Respond node)
			const useReference =
				hubInfo.useStorage && payloadLength > hubInfo.maxPayload && !!hubInfo.blobStorageUrl;

			// Build canonical PrivateWorkflowPayload for hub
			let hubPayload: PrivateWorkflowPayload;

			if (useReference) {
				// Build the buffer to upload based on encoding
				const buffer =
					encoding === 'base64'
						? Buffer.from(serializedValue, 'base64')
						: Buffer.from(serializedValue, 'utf8');

				// Create the blob transport using hub service info
				const blobTransport = new WorkflowPayloadBlobTransport({
					baseUrl: hubInfo.blobStorageUrl,
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
					value: uploadResult.url,
					encoding,
					isEncrypted: false,
					length: payloadLength,
				};

				this.logger?.info?.(
					`[RespondToPrivateWorkflow] Payload uploaded (${payloadLength} bytes) → ${uploadResult.url}`,
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

			// Send a single response to the hub after collecting the payload
			this.logger?.info?.(
				`[RespondToPrivateWorkflow] Sending response → corr=${correlationId}, mode=${respondWith}`,
			);
			const completedResponse: PrivateWorkflowResponse = {
				correlationId,
				status: 'Completed',
				payload: hubPayload,
			};
			await this.helpers.httpRequestWithAuthentication.call(this, 'privateWorkflowApi', {
				method: 'POST',
				url: completedUrl,
				headers: {
					accept: 'application/json',
				},
				body: completedResponse,
				json: true,
			});

			this.logger?.info?.(`[RespondToPrivateWorkflow] Response sent (corr=${correlationId})`);

			// Return items to workflow
			return [outputItems];
		} catch (err) {
			// Send failure to hub (best effort)
			try {
				const failureMessage = err instanceof Error ? err.message : String(err);
				const failurePayload: PrivateWorkflowPayload = {
					type: 'inline',
					value: JSON.stringify({ error: failureMessage }),
					encoding: 'json',
					isEncrypted: false,
					length: Buffer.byteLength(JSON.stringify({ error: failureMessage }), 'utf8'),
				};
				const failedResponse: PrivateWorkflowResponse = {
					correlationId,
					status: 'Failed',
					payload: failurePayload,
				};
				// eslint-disable-next-line @n8n/community-nodes/no-http-request-with-manual-auth
				await this.helpers.httpRequest({
					method: 'POST',
					url: completedUrl,
					headers: {
						'x-api-key': apiKey,
						accept: 'application/json',
					},
					body: failedResponse,
					json: true,
				});
			} catch (hubErr) {
				// Never let hub failures mask the real error
				this.logger.error('[RespondToPrivateWorkflow] Failed to report error to hub', hubErr);
			}

			// Now fail the node properly
			if (err instanceof NodeOperationError) {
				// eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- already a NodeOperationError, guarded above
				throw err;
			}

			throw new NodeOperationError(
				this.getNode(),
				err instanceof Error ? err.message : String(err),
			);
		}
	}
}
