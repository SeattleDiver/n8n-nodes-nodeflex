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
// import { PrivateWorkflowPayload } from '../../library/PrivateWorkflowPayload';

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
		outputs: ['main'],
		credentials: [
			{
				name: 'privateWorkflowApiPublicKey', // must match your credentials class name
				required: true,
			},
		],
		properties: [
			// {
			// 	displayName: 'Hub Environment',
			// 	name: 'hubUrl',
			// 	type: 'options',
			// 	default: 'http://localhost:5268',
			// 	description: 'Select the environment for the SignalR hub connection.',
			// 	options: [
			// 		{
			// 			name: 'Development',
			// 			value: 'http://localhost:5268',
			// 			description: 'Local development server.',
			// 		},
			// 		{
			// 			name: 'Production',
			// 			value: 'https://hub.n8ncloud.io',
			// 			description: 'Cloud production server.',
			// 		},
			// 	],
			// },
			{
				displayName: 'Workflow Name',
				name: 'hubPath',
				type: 'string',
				default: '',
				placeholder: 'e.g. mediasix/workflow-test',
				required: true,
				description: 'The private workflow path to invoke.',
			},
			{
				displayName: 'Payload (JSON)',
				name: 'payload',
				type: 'json',
				default: '{}',
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
			}
		]
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {

		const self = this;
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Get credentials
		const creds = await this.getCredentials('privateWorkflowApiPublicKey');
		const apiKey = creds.apiKey as string;

		for (let i = 0; i < items.length; i++) {
			try {
				// Extract parameters
				const hubBase = "https://hub.n8ncloud.io";
				// const hubBase = this.getNodeParameter('hubUrl', i) as string;
				const hubPath = this.getNodeParameter('hubPath', i) as string;
				const payload = this.getNodeParameter('payload', i) as object;
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

				// Construct target URL
				const normalizedUrl = apiUrl.replace(/\/+$/, '');
				const normalizedPath = hubPath.replace(/^\/+/, '');
				const targetUrl = `${normalizedUrl}/${normalizedPath}`;

				// Base64 encode payload (already encrypted externally if needed)
				//const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
				const encodedPayload = JSON.stringify(payload);
				const request: PrivateWorkflowRequest = {
					correlationId: crypto.randomUUID(),
					requestId: crypto.randomUUID(),
					path: hubPath,
					payload: {
							type: "inline",
							value: JSON.stringify(encodedPayload),
							length: encodedPayload.length,
							isEncrypted: false
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

				//returnData.push({ json: { request, response } });
				returnData.push({ json: response });
			} catch (error: any) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: error.message } });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}

}
