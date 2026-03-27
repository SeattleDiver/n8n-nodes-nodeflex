import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import { randomUUID } from 'crypto';

import { PrivateWorkflowHttpClient } from '../../lib/PrivateWorkflowHttpClient';
import { HubUrlService } from '../../lib/HubUrlService';
import { WorkflowHubService } from '../../lib/WorkflowHubService';
import { PrivateWorkflowRequest } from '../../lib/PrivateWorkflowRequest';
import { PrivateWorkflowResponseHydrator } from '../../lib/PrivateWorkflowResponseHydrator';
import { PrivateWorkflowPayload } from '../../lib/PrivateWorkflowPayload';
import { WorkflowPayloadBlobTransport } from '../../lib/WorkflowPayloadBlobTransport';

export class PrivateWorkflow implements INodeType {
	private static readonly HUB_BASE = 'https://hub.nodeflex.io';

	description: INodeTypeDescription = {
		displayName: 'Execute Private Workflow',
		name: 'privateWorkflow',
		group: ['transform'],
		version: 1,
		description: 'Run a remote private workflow',
		defaults: {
			name: 'Execute Private Workflow',
		},
		icon: 'file:icon.svg',
		inputs: ['main'],
		outputs: ['main', 'main'],
		outputNames: ['Acknowledged', 'Completed'],
		credentials: [
			{
				name: 'privateWorkflowPublicKeyApi', // must match your credentials class name
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
				description: 'The private workflow path to invoke',
			},
			{
				displayName: 'Payload',
				name: 'payloadType',
				type: 'options',
				default: 'json',
				options: [
					{
						name: 'JSON (Input)',
						value: 'json',
						description: 'Use the input JSON as the workflow payload',
					},
					// {
					// 	name: 'Text',
					// 	value: 'text',
					// 	description: 'Specify text to send as the workflow payload',
					// },
					{
						name: 'Binary File',
						value: 'binary',
						description: 'Use a binary file from the input as the workflow payload',
					},
				],
			},
			{
				displayName: 'JSON Source',
				name: 'jsonSource',
				type: 'options',
				default: 'input',
				options: [
					{
						name: 'Input JSON',
						value: 'input',
						description: 'Use the incoming item JSON as the payload',
					},
					{
						name: 'Custom JSON',
						value: 'custom',
						description: 'Provide JSON manually or via expression',
					},
				],
				displayOptions: {
					show: {
						payloadType: ['json'],
					},
				},
			},
			{
				displayName: 'Text',
				name: 'textValue',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						payloadType: ['text'],
					},
				},
			},
			{
				displayName: 'Binary Selection',
				name: 'binarySelection',
				type: 'options',
				default: 'byName',
				options: [
					{ name: 'By Property Name', value: 'byName' },
					{ name: 'First Binary Property', value: 'first' },
				],
				displayOptions: {
					show: {
						payloadType: ['binary'],
					},
				},
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'file',
				displayOptions: {
					show: {
						payloadType: ['binary'],
						binarySelection: ['byName'],
					},
				},
			},
			{
				displayName: 'JSON',
				name: 'jsonText',
				type: 'string',
				default: '',
				placeholder: '{ "foo": "bar" }',
				description: 'JSON object or expression that evaluates to an object',
				displayOptions: {
					show: {
						payloadType: ['json'],
						jsonSource: ['custom'],
					},
				},
			},
			{
				displayName: 'JSON',
				name: 'jsonValue',
				type: 'json',
				default: {},
				description: 'JSON object or expression that evaluates to an object',
				displayOptions: {
					show: {
						payloadType: ['json'],
						jsonSource: ['custom'],
					},
				},
			},
			{
				displayName: 'Wait for Response',
				name: 'waitForResponse',
				type: 'boolean',
				default: false,
				description: 'Whether or not to wait for the private workflow to send a response',
				hint: 'If enabled, this node will wait for the workflow to complete'
			},
			{
				displayName: 'Wait for Response Timeout',
				name: 'waitTimeout',
				type: 'number',
				default: 5,
				typeOptions: {
					minValue: 1,
					maxValue: 15,
				},
				displayOptions: {
					show: {
						waitForResponse: [true],
					},
				},
				description: 'Maximum time to wait for a workflow response',
				hint: 'Wait time can be up to 15 seconds.'
			},
			// {
			// 	displayName: 'Encrypt Workflow Payload in Transit',
			// 	name: 'encryptPayload',
			// 	type: 'boolean',
			// 	default: false,
			// 	description:
			// 		'Encrypt the workflow payload in transit between n8n and the Private Workflow. Configure your public key in the credential.',
			// 	hint: 'When enabled, all requests and responses for this execution are automatically encrypted and decrypted. No additional configuration is required on downstream Private Workflow nodes.',
			// },
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const self = this;
		const items = this.getInputData();
		const ackData: INodeExecutionData[] = [];
		const completedData: INodeExecutionData[] = [];

		// Get credentials (keep existing behavior)
		const creds = await this.getCredentials('privateWorkflowPublicKeyApi');
		const apiKey = creds.apiKey as string;

		for (let i = 0; i < items.length; i++) {
			try {
				// ------------------------------------------------------------
				// Get the hubBase, extract the hubProfile and setup all the URL's and profile parameters
				// ------------------------------------------------------------
				const hubBase = PrivateWorkflow.HUB_BASE;
				const hubService = new HubUrlService(hubBase);
				const hubInfo: WorkflowHubService | null = await hubService.getHubInfo(apiKey);

				const hubUrl = hubInfo?.hubUrl;
				if (!hubUrl) {
					throw new NodeOperationError(
						this.getNode(),
						'Hub URL is unavailable.  Hub service is down.',
						{
							itemIndex: i,
						},
					);
				}

				const workflowName = this.getNodeParameter('workflowName', i) as string;
				if (!workflowName) {
					throw new NodeOperationError(this.getNode(), 'Workflow name is required.', {
						itemIndex: i,
					});
				}

				const hubPath = hubInfo.accountPath + '/' + workflowName;
				const blobUrl = hubInfo?.blobStorageUrl;
				if (!blobUrl) {
					throw new NodeOperationError(
						this.getNode(),
						'Blob URL is unavailable.  Hub service is down.',
						{
							itemIndex: i,
						},
					);
				}

				const apiUrl = hubInfo?.apiUrl;
				if (!apiUrl) {
					throw new NodeOperationError(
						this.getNode(),
						'Endpoint URL is unavailable.  Hub service is down.',
						{
							itemIndex: i,
						},
					);
				}

				self.logger.info(`Resolved hub URLs for ${hubPath}`);

				// Construct target URL (keep existing behavior)
				const normalizedUrl = apiUrl.replace(/\/+$/, '');
				const normalizedPath = hubPath.replace(/^\/+/, '');
				const targetUrl = `${normalizedUrl}/${normalizedPath}`;

				// ------------------------------------------------------------
				// Process the item
				// ------------------------------------------------------------
				const item = items[i];

				// ------------------------------------------------------------
				// Extract new node parameters
				// ------------------------------------------------------------
				const payloadType = this.getNodeParameter('payloadType', i) as 'json' | 'binary';

				const waitForResponse = this.getNodeParameter('waitForResponse', i) as boolean;
				let waitTimeout = 0;
				if (waitForResponse) {
					waitTimeout = this.getNodeParameter('waitTimeout', i) as number;
				}

				// ------------------------------------------------------------
				// Build the payload based on user-selected payloadType
				// ------------------------------------------------------------
				let encodedPayload: string;
				let payloadLength: number;
				let payloadEncoding: 'json' | 'base64' | 'text' = 'json';

				if (payloadType === 'binary') {
					const binarySelection = this.getNodeParameter('binarySelection', i) as 'byName' | 'first';
					const configuredBinaryPropertyName = this.getNodeParameter(
						'binaryPropertyName',
						i,
					) as string;

					if (!item.binary || Object.keys(item.binary).length === 0) {
						throw new NodeOperationError(
							this.getNode(),
							'Payload is set to Binary File, but no binary data exists on the incoming item.',
							{ itemIndex: i },
						);
					}

					let binaryPropertyNameToUse: string;

					if (binarySelection === 'first') {
						binaryPropertyNameToUse = Object.keys(item.binary)[0];
					} else {
						// byName
						binaryPropertyNameToUse = configuredBinaryPropertyName || 'file';
						if (!item.binary[binaryPropertyNameToUse]) {
							throw new NodeOperationError(
								this.getNode(),
								`Binary property "${binaryPropertyNameToUse}" was not found on the incoming item.`,
								{ itemIndex: i },
							);
						}
					}

					const binary = item.binary[binaryPropertyNameToUse];

					if (!binary?.data || typeof binary.data !== 'string') {
						throw new NodeOperationError(
							this.getNode(),
							`Binary property "${binaryPropertyNameToUse}" does not contain valid base64 data.`,
							{ itemIndex: i },
						);
					}

					// n8n stores binary.data as base64 already
					encodedPayload = binary.data;
					payloadLength = Buffer.byteLength(binary.data, 'base64');
					payloadEncoding = 'base64';

					this.logger.info(
						`Encoded binary payload "${binaryPropertyNameToUse}" as base64 (${payloadLength} bytes, ${binary.mimeType ?? 'unknown mime'})`,
					);
				} else {
					// payloadType === 'json'
					const jsonSource = this.getNodeParameter('jsonSource', i) as 'input' | 'custom';

					let objToSend: Record<string, unknown>;

					if (jsonSource === 'input') {
						objToSend = item.json ?? {};
					} else {
						// custom JSON (Text / Expression)
						const raw = this.getNodeParameter('jsonText', i) as unknown;

						if (raw === null || raw === undefined) {
							throw new NodeOperationError(
								this.getNode(),
								'JSON is required when JSON Source is custom.',
								{
									itemIndex: i,
								},
							);
						}

						if (typeof raw === 'string') {
							// If user typed JSON text (or an expression produced a JSON string)
							try {
								objToSend = JSON.parse(raw);
							} catch {
								throw new NodeOperationError(this.getNode(), 'Invalid JSON in JSON field.', {
									itemIndex: i,
								});
							}
						} else if (typeof raw === 'object' && !Array.isArray(raw)) {
							// If expression evaluated to an object
							objToSend = raw as Record<string, unknown>;
						} else {
							throw new NodeOperationError(
								this.getNode(),
								'JSON field must be a JSON object or a JSON string that parses to an object.',
								{ itemIndex: i },
							);
						}
					}

					encodedPayload = JSON.stringify(objToSend);
					payloadLength = Buffer.byteLength(encodedPayload, 'utf8');
					payloadEncoding = 'json';

					this.logger.info(`Encoded JSON payload (${payloadLength} bytes)`);
				}

				// ------------------------------------------------------------
				// Decide payload transport (inline vs reference) - keep existing behavior
				// (You said you want to "forget" this later; leaving it intact for now.)
				// ------------------------------------------------------------
				const useReference = payloadLength > hubInfo.maxPayload && !!blobUrl;
				let payload: PrivateWorkflowPayload;

				if (useReference) {

					const blobTransport = new WorkflowPayloadBlobTransport({
						baseUrl: blobUrl,
						apiKey,
					});

					const buffer =
						payloadEncoding === 'base64'
							? Buffer.from(encodedPayload, 'base64')
							: Buffer.from(encodedPayload, 'utf8');

					const upload = await blobTransport.upload(buffer);

					payload = {
						type: 'reference',
						value: upload.url,
						length: payloadLength,
						isEncrypted: false,
						encoding: payloadEncoding,
					};

					this.logger.info(
						`[PrivateWorkflow (execute)] Payload uploaded (${payloadLength} bytes) → ${upload.url}`,
					);

				} else {

					payload = {
						type: 'inline',
						value: encodedPayload,
						length: payloadLength,
						isEncrypted: false,
						encoding: payloadEncoding,
					};
				}

				// ------------------------------------------------------------
				// Construct request (keep existing behavior)
				// ------------------------------------------------------------
				const request: PrivateWorkflowRequest = {
					correlationId: randomUUID(),
					requestId: randomUUID(),
					path: hubPath,
					payload,
					waitForResponse,
					waitTimeout,
				};

				// Send request (keep existing behavior)
				const client = new PrivateWorkflowHttpClient({
					apiKey,
					verifySSL: !targetUrl.includes('localhost'),
				});

				this.logger.info(`Calling private workflow at ${targetUrl}`);

				const response = await client.post(targetUrl, request);

				// --------------------------------------------------------------------
				// Output the responses (keep existing behavior)
				// --------------------------------------------------------------------
				const statusCode = (response as Record<string, unknown>)?.statusCode;
				if (typeof statusCode === 'number' && statusCode >= 500) {
					throw new NodeOperationError(this.getNode(), `Hub error (${statusCode})`, {
						itemIndex: i,
					});
				}

				const body = ((response as Record<string, unknown>).body ?? response) as Record<string, unknown>;
				if (!body || typeof body !== 'object') {
					throw new NodeOperationError(this.getNode(), 'Invalid response body from hub', {
						itemIndex: i,
					});
				}

				ackData.push({
					json: {
						correlationId: body.correlationId as string,
						path: body.path as string,
						status: body.status as string,
						timeStampUtc: body.timeStampUtc as string,
					},
				});

				// Completed output when waiting and workflow completed
				if (body?.status) {
					if (waitForResponse && body.status === 'Completed') {
						const result = PrivateWorkflowResponseHydrator.hydrate(body, {
							binaryPropertyName: 'file', // you can wire this to a node param later if desired
						});

						if (result.state === 'completed') {
							completedData.push(...result.items);
						}
					}
				} else {
					throw new NodeOperationError(this.getNode(), 'Missing body in response', {
						itemIndex: i,
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					const message = error instanceof Error ? error.message : String(error);
					ackData.push({
						json: {
							error: true,
							message,
							itemIndex: i,
						},
					});
					continue;
				}

				if (error instanceof NodeOperationError) {
					throw error;
				}

				const message = error instanceof Error ? error.message : 'Unexpected error executing private workflow';
				throw new NodeOperationError(
					this.getNode(),
					message,
					{ itemIndex: i },
				);
			}
		}

		return [ackData, completedData];
	}
}
