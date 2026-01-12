import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import { HubUrlService } from '../../library/HubUrlService';
import { WorkflowHubService } from '../../library/WorkflowHubService';
import { PrivateWorkflowResponseHydrator } from '../../library/PrivateWorkflowResponseHydrator';

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

		const correlationId =
			this.getNodeParameter('correlationId', i) as string;

		try {

			const workflowName =
				this.getNodeParameter('workflowName', i) as string;

			if (!workflowName) {
				throw new NodeOperationError(
					this.getNode(),
					'Workflow name is required.'
				);
			}

			const hubPath = `${hubInfo.accountPath}/${workflowName}`;
			const normalizedPath = hubPath.replace(/^\/+/, '');
			const targetUrl =
				`${apiUrl}/${normalizedPath}/results/${correlationId}`;

			this.logger.info(
				`Getting workflow results for {${correlationId}} at ${targetUrl}`
			);

			// const response = await this.helpers.httpRequest({
			// 	method: 'GET',
			// 	url: targetUrl,
			// 	headers: {
			// 		'x-api-key': apiKey,
			// 		'accept': 'application/json',
			// 	},
			// 	json: true,
			// 	throwOnHttpError: false,
			// 	resolveWithFullResponse: true
			// });

			const response = await this.helpers.request({
				method: 'GET',
				url: targetUrl,
				headers: {
					'x-api-key': apiKey,
					'accept': 'application/json',
				},
				json: true,

				// 🔑 THESE ARE SUPPORTED HERE
				simple: false,
				resolveWithFullResponse: true,
			});

			const body = response.body;
			const status: string | undefined = body?.status;

			if (!status) {
				throw new NodeOperationError(
					this.getNode(),
					'Hub response missing status field',
					{ itemIndex: i }
				);
			}
			// --------------------------------------------------------
			// Pending states
			// --------------------------------------------------------
			else if (status === 'Queued' || status === 'Running' || status === 'Pending') {
				pending.push({
					json: {
						status,
						correlationId,
					},
				});
				continue;
			}
			// ------------------------------------------------------------
			// HANDLE RATE LIMIT (429) FIRST
			// ------------------------------------------------------------
			else if (status == "rate_limited") {
					// Return a normal item with the rate limit message.  User can get the retryAfterMs and use that to wait before retrying
					pending.push({
							json: {
									status: 'rate_limited',
									correlationId,
									message:
											body.message ??
											'Polling too frequently for this workflow execution',
											retryAfterMs: body.retryAfterMs,
							},
					});

					this.logger.warn(`429 Too Many Requests for {${correlationId}}, rate limited.`);
					throw new NodeOperationError(
						this.getNode(),
						`429 Too Many Requests for {${correlationId}}, rate limited.  Polling limit is 1500ms`,
						{ itemIndex: i }
					);
			}
			else if (status !== 'Completed') {
				throw new NodeOperationError(
					this.getNode(),
					`Unknown workflow status: ${status}`,
					{ itemIndex: i }
				);
			}
			else if (status === 'Completed') {
				// --------------------------------------------------------
				// Completed → hydrate payload
				// --------------------------------------------------------
				const result = PrivateWorkflowResponseHydrator.hydrate(body, {
					binaryPropertyName: 'file',
				});

				if (result.state === 'completed') {
					completed.push(...result.items);
				} else {
					pending.push(...result.items);
				}
				continue;
			}
			else
			{
				// --------------------------------------------------------
				// No payload → minimal output
				// --------------------------------------------------------
				completed.push({
					json: {
						status,
						correlationId,
					},
				});
			}

		} catch (err) {

			// ------------------------------------------------------------
			// CONTINUE ON FAIL (generic)
			// ------------------------------------------------------------
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

			// ------------------------------------------------------------
			// RE-THROW KNOWN NODE ERRORS
			// ------------------------------------------------------------
			if (err instanceof NodeOperationError) {
					throw err;
			}

			// ------------------------------------------------------------
			// FALLBACK: UNKNOWN ERROR
			// ------------------------------------------------------------
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
