import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import { HubUrlService } from '../../library/HubUrlService';
import { WorkflowHubService } from '../../library/WorkflowHubService';

export class GetPrivateWorkflowResult implements INodeType {

	description: INodeTypeDescription = {
		displayName: 'Get Private Workflow Result',
		name: 'getPrivateWorkflowResult',
		group: ['input'],
		version: 1,
		description: 'Retrieves the current status or result of a Private Workflow execution',
		icon: 'file:cloud-network-download-drum.svg',
		defaults: {
			name: 'Get Private Workflow Result',
			color: '#00c896',
		},
		inputs: ['main'],
		outputs: ['main', 'main'],
		outputNames: ['Completed', 'Pending'],
		credentials: [
			{
				name: 'privateWorkflowApiPublicKey',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Correlation ID',
				name: 'correlationId',
				type: 'string',
				required: true,
				default: '',
				description: 'Correlation ID returned from Execute Private Workflow',
			},
			{
				displayName: 'Workflow Name',
				name: 'workflowName',
				type: 'string',
				default: '',
				placeholder: 'e.g. my-workflow',
				required: true,
				description: 'The private workflow path to invoke.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {

		const completed: INodeExecutionData[] = [];
		const pending: INodeExecutionData[] = [];

		// ------------------------------------------------------------
		// Resolve credentials (PUBLIC)
		// ------------------------------------------------------------
		const creds = (await this.getCredentials(
			'privateWorkflowApiPublicKey'
		)) as {
			apiKey?: string;
			publicKey?: string;
		} | null;

		if (!creds?.apiKey) {
			throw new NodeOperationError(
				this.getNode(),
				'API key is missing. Configure the Private Workflow (Public Key) credentials.'
			);
		}

		const apiKey = creds.apiKey;

		// ------------------------------------------------------------
		// Resolve execution hub via control plane
		// ------------------------------------------------------------
		const hubBase = 'https://hub.n8ncloud.io';
		const hubService = new HubUrlService(hubBase);
		const hubInfo: WorkflowHubService | null =
			await hubService.getHubInfo(apiKey);

		if (!hubInfo?.hubUrl || !hubInfo?.apiUrl || !hubInfo?.blobStorageUrl) {
			throw new NodeOperationError(
				this.getNode(),
				'Hub service information is incomplete or unavailable.'
			);
		}

		const apiUrl = hubInfo.apiUrl.replace(/\/+$/, '');

		// ------------------------------------------------------------
		// Execute per input item
		// ------------------------------------------------------------
		const items = this.getInputData();

		for (let i = 0; i < items.length; i++) {

			// ✅ Capture once so it survives all paths
			const correlationId =
				this.getNodeParameter('correlationId', i) as string;

			try {

				const workflowName = this.getNodeParameter('workflowName', i) as string;
			  if (!workflowName)
				{
					throw new NodeOperationError(this.getNode(), "Workflow name is required.");
				}
				const hubPath = hubInfo.accountPath + "/" + workflowName;
				const normalizedPath = hubPath.replace(/^\/+/, '');
				const targetUrl =
					`${apiUrl}/${normalizedPath}/results/${correlationId}`;

				this.logger.info(
					`Getting workflow results for {${correlationId}} at ${targetUrl}`
				);

				const response = await this.helpers.httpRequest({
					method: 'GET',
					url: targetUrl,
					headers: {
						'x-api-key': apiKey,
						'accept': 'application/json',
					},
					json: true,
				});

				const status: string | undefined = response?.status;

				if (!status) {
					throw new NodeOperationError(
						this.getNode(),
						'Hub response missing status field',
						{ itemIndex: i }
					);
				}

				const output = {
					...response,
					correlationId,
				};

				if (status === 'Completed') {
					completed.push({ json: output });
				}
				else if (status === 'Queued' || status === 'Running' || status === 'Pending') {
					pending.push({ json: output });
				}
				else {
					throw new NodeOperationError(
						this.getNode(),
						`Unknown workflow status: ${status}`,
						{ itemIndex: i }
					);
				}

			} catch (err) {

				// User explicitly opted into Continue On Fail
				if (this.continueOnFail()) {
					pending.push({
						json: {
							correlationId,
							error: true,
							message: err.message ?? err,
							itemIndex: i,
						},
					});
					continue;
				}

				// Preserve proper n8n error semantics
				if (err instanceof NodeOperationError) {
					throw err;
				}

				throw new NodeOperationError(
					this.getNode(),
					err.message || 'Unexpected error retrieving workflow result',
					{ itemIndex: i }
				);
			}
		}

		return [
			completed,
			pending,
		];
	}
}
