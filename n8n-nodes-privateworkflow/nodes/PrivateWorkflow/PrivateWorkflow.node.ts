import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError
 } from 'n8n-workflow';

import { PrivateWorkflowHttpClient } from '../../library/PrivateWorkflowHttpClient';
import { HubUrlService } from "../../library/HubUrlService";
import { WorkflowHubService } from "../../library/WorkflowHubService";
import { PrivateWorkflowRequest } from "../../library/PrivateWorkflowRequest";
import { PrivateWorkflowResponseHydrator } from '../../library/PrivateWorkflowResponseHydrator';

// import { PayloadEncryptor } from '../../library/PayloadEncryptor';

export class PrivateWorkflow implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Execute Private Workflow',
		name: 'privateWorkflow',
		group: ['transform'],
		version: 1,
		description: 'Run a remote private workflow',
		defaults: {
			name: 'Execute Private Workflow',
		},
		icon: 'file:cloud-network.svg',
		inputs: ['main'],
		outputs: ['main', 'main'],
		outputNames: ['Acknowledged', 'Completed'],
		credentials: [
			{
				name: 'privateWorkflowApiPublicKey', // must match your credentials class name
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
				description: 'The private workflow path to invoke.',
			},
			{
				displayName: 'Payload (JSON)',
				name: 'payload',
				type: 'json',
				default: '{{ $json }}',
				description: 'The JSON payload to send to the Private Workflow.',
			},
			{
				displayName: 'Wait for Response',
				name: 'waitForResponse',
				type: 'boolean',
				default: false,
				description: 'Wait for the private workflow to send a response (up to 15 seconds).',
			},
			{
				displayName: 'Wait for Response Timeout (max 15 seconds)',
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
				description: 'Maximum time to wait for a workflow response.',
			},
			{
				displayName: 'Encrypt Workflow Payload in Transit',
				name: 'encryptPayload',
				type: 'boolean',
				default: false,
				description:
					'Encrypt the workflow payload in transit between n8n and the Private Workflow. Configure your public key in the credential.',
				hint:
				  'When enabled, all requests and responses for this execution are automatically encrypted and decrypted. No additional configuration is required on downstream Private Workflow nodes.',
			}
		]
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {

		const self = this;
		const items = this.getInputData();
		const ackData: INodeExecutionData[] = [];
		const completedData: INodeExecutionData[] = [];

		// Get credentials
		const creds = await this.getCredentials('privateWorkflowApiPublicKey');
		const apiKey = creds.apiKey as string;

		for (let i = 0; i < items.length; i++) {
			try {
				// Extract parameters
				const hubBase = "https://hub.n8ncloud.io";
				const workflowName = this.getNodeParameter('workflowName', i) as string;
				if (!workflowName)
				{
					throw new NodeOperationError(this.getNode(), "Workflow name is required.");
				}

				const item = items[i];

				let encodedPayload: string;
				let payloadLength: number;

				// ------------------------------------------------------------
				// BINARY PAYLOAD
				// ------------------------------------------------------------
				if (item.binary && Object.keys(item.binary).length > 0) {

					const binaryPropertyName = Object.keys(item.binary)[0];
					const binary = item.binary[binaryPropertyName];

					// n8n already stores binary.data as base64
					encodedPayload = binary.data;

					// Compute actual byte length from base64
					payloadLength = Buffer.byteLength(binary.data, 'base64');

					this.logger.info(
						`Encoded binary payload as base64 (${payloadLength} bytes, ${binary.mimeType})`
					);
				}
				// ------------------------------------------------------------
				// JSON PAYLOAD
				// ------------------------------------------------------------
				else {
					const payload = this.getNodeParameter('payload', i);

					if (typeof payload === 'string') {
						try {
							JSON.parse(payload);
							encodedPayload = payload;
						}
						catch {
							throw new NodeOperationError(
								this.getNode(),
								'Payload must be valid JSON. Do not mix JSON and expressions.',
								{ itemIndex: i }
							);
						}
					}
					else {
						encodedPayload = JSON.stringify(payload);
					}

					payloadLength = encodedPayload.length;

					this.logger.info(
						`Encoded JSON payload (${payloadLength} chars)`
					);
				}

				const waitForResponse = this.getNodeParameter('waitForResponse', i) as boolean;

				let waitTimeout = 0;
				if (waitForResponse) {
					waitTimeout = this.getNodeParameter('waitTimeout', i) as number;
				}

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
				const apiUrl = hubInfo?.apiUrl;
				if (!apiUrl)
				{
					throw new NodeOperationError(this.getNode(), 'Endpoint URL is unavailable.  Hub service is down.');
				}
				self.logger.info(`Resolved  API url: ${apiUrl}`);
				self.logger.info(`Resolved  Hub url: ${hubUrl}`);
				self.logger.info(`Resolved Blob url: ${blobUrl}`);
//				self.logger.info(`Resolved  Payload: ${encodedPayload}`);

				// Construct target URL
				const normalizedUrl = apiUrl.replace(/\/+$/, '');
				const normalizedPath = hubPath.replace(/^\/+/, '');
				const targetUrl = `${normalizedUrl}/${normalizedPath}`;

				const request: PrivateWorkflowRequest = {
					correlationId: crypto.randomUUID(),			// Note: the correlationId is generated in the hub
					requestId: crypto.randomUUID(),
					path: hubPath,
					payload: {
							type: "inline",
							value: encodedPayload,
							length: payloadLength,
							isEncrypted: false,
							encoding: item.binary ? "base64" : "json"
					},
					waitForResponse: waitForResponse,
					waitTimeout: waitTimeout
				};

				// Send request
				const client = new PrivateWorkflowHttpClient({
					apiKey,
					verifySSL: !targetUrl.includes('localhost'),
				});

			  this.logger.info("Calling private workflow at " + targetUrl + " at API Url:" + apiUrl + " apiKey:" + apiKey);
				const response = await client.post(targetUrl, request);
				this.logger.info(JSON.stringify(response));

				// --------------------------------------------------------------------
				// Output the responses
				// --------------------------------------------------------------------

				// Defensive: treat 500+ as real failure
				const statusCode = (response as any)?.statusCode;
				if (typeof statusCode === 'number' && statusCode >= 500) {
					throw new NodeOperationError(
						this.getNode(),
						`Hub error (${statusCode})`,
						{ itemIndex: i }
					);
				}

				// Always emit ACK (request accepted, correlationId exists)
				ackData.push({ json: response });

				// Route to Completed output when workflow is finished
				const status = (response as any)?.status;

				if (waitForResponse && status === 'Completed') {
					const result = PrivateWorkflowResponseHydrator.hydrate(response, {
						binaryPropertyName: 'file',
					});

					if (result.state === 'completed') {
						completedData.push(...result.items);
					}
				}

			} catch (error: any) {

				// If user enabled "Continue On Fail", emit error as data
				if (this.continueOnFail()) {

					ackData.push({
						json: {
							error: true,
							message: error.message,
							name: error.name,
							stack: error.stack,
							itemIndex: i,
						},
					});

					continue;
				}

				// Otherwise, fail the node properly
				if (error instanceof NodeOperationError) {
					throw error;
				}

				throw new NodeOperationError(
					this.getNode(),
					error.message || 'Unexpected error executing private workflow',
					{ itemIndex: i }
				);
			}
		}
		return [ackData, completedData];
	}
}
