import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { HUB_BASE_URL } from '../../lib/HubConfig';
import { HubProfileService } from '../../lib/HubProfileService';
import { IN8nHttpHelper } from '../../lib/N8nHttpHelper';
import { PrivateWorkflowResponseHydrator } from '../../lib/PrivateWorkflowResponseHydrator';
import { WorkflowHubService } from '../../lib/WorkflowHubService';

export class GetPrivateWorkflowResult implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Get Private Workflow Result',
		name: 'getPrivateWorkflowResult',
		icon: 'file:icon.svg',
		group: ['input'],
		version: 1,
		description: 'Retrieves the current status or result of a Private Workflow execution',
		defaults: {
			name: 'Get Private Workflow Result',
		},
		usableAsTool: true,
		inputs: ['main'],
		outputs: ['main', 'main'],
		outputNames: ['Completed', 'Pending'],
		credentials: [
			{
				name: 'privateWorkflowApi',
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
				displayName: 'Continue Workflow When Private Workflow Status Returns',
				name: 'continueOn',
				type: 'multiOptions',
				default: ['Completed'],
				required: true,
				description:
					'Select which workflow statuses should emit to the Completed output and continue the workflow. Unselected statuses will emit to the Pending output.',
				options: [
					{
						name: 'Completed',
						value: 'Completed',
						description: 'Workflow execution is complete',
					},
					{
						name: 'Running',
						value: 'Running',
						description: 'Workflow is currently running',
					},
					{
						name: 'Pending',
						value: 'Pending',
						description: 'Workflow is pending execution',
					},
					{
						name: 'Queued',
						value: 'Queued',
						description: 'Workflow is queued for execution',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const completed: INodeExecutionData[] = [];
		const pending: INodeExecutionData[] = [];

		// Credentials
		const creds = (await this.getCredentials('privateWorkflowApi')) as {
			apiKey?: string;
		};

		if (!creds?.apiKey) {
			throw new NodeOperationError(
				this.getNode(),
				'API key is missing. Configure the Private Workflow credentials.',
			);
		}

		const apiKey = creds.apiKey;

		// Parameters (single-shot, not per-item)
		let correlationId = this.getNodeParameter('correlationId', 0) as string;
		correlationId = correlationId.trim();

		const continueOn = this.getNodeParameter('continueOn', 0) as string[];
		const continueOnCompleted = continueOn.includes('Completed');
		const continueOnRunning = continueOn.includes('Running');
		const continueOnPending = continueOn.includes('Pending');
		const continueOnQueued = continueOn.includes('Queued');

		// Resolve execution hub via control plane
		const hubBase = HUB_BASE_URL;
		const http: IN8nHttpHelper = { httpRequest: this.helpers.httpRequest.bind(this.helpers) };
		const hubService = new HubProfileService(hubBase, http);
		let hubInfo: WorkflowHubService;
		try {
			hubInfo = await hubService.getHubInfo(apiKey);
		} catch {
			throw new NodeOperationError(this.getNode(), 'Hub service is unavailable.');
		}

		if (!hubInfo.hubUrl || !hubInfo.apiUrl || !hubInfo.blobStorageUrl) {
			throw new NodeOperationError(
				this.getNode(),
				'Hub service information is incomplete or unavailable.',
			);
		}
		const targetUrl = `${hubInfo.apiUrl.replace(/\/+$/, '')}/results/${correlationId}`;
		this.logger.info('[GetPrivateWorkflowResult] Fetching workflow result');

		// Auth uses x-api-key header; httpRequestWithAuthentication not applicable
		// because the credential doesn't define a generic authenticate property.
		// eslint-disable-next-line @n8n/community-nodes/no-http-request-with-manual-auth
		const response = await this.helpers.httpRequest({
			method: 'GET',
			url: targetUrl,
			headers: {
				'x-api-key': apiKey,
				accept: 'application/json',
			},
			returnFullResponse: true,
		});

		const body = response.body as Record<string, unknown>;
		const status: string | undefined = body?.status as string | undefined;

		if (!status) {
			throw new NodeOperationError(this.getNode(), 'Hub response missing status field');
		}

		// Routing: non-Completed statuses
		const shouldContinue =
			(status === 'Queued' && continueOnQueued) ||
			(status === 'Running' && continueOnRunning) ||
			(status === 'Pending' && continueOnPending) ||
			(status === 'Completed' && continueOnCompleted);

		this.logger.info(
			`[GetPrivateWorkflowResult] status=${status}, shouldContinue=${shouldContinue}`,
		);

		if (status !== 'Completed') {
			if (shouldContinue) {
				completed.push({ json: { status, correlationId } });
			} else {
				pending.push({ json: { status, correlationId } });
			}
			return [completed, pending];
		}

		// Completed: decode payload (hydrator handles blob resolution)
		const result = await PrivateWorkflowResponseHydrator.hydrate(body, {
			http,
			apiKey,
		});

		if (result.state === 'completed') {
			completed.push(...result.items);
		}

		return [completed, pending];
	}
}
