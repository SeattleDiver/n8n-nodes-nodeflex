import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import { HubUrlService } from '../../lib/HubUrlService';
import { HUB_BASE_URL } from '../../lib/HubConfig';
import { WorkflowHubService } from '../../lib/WorkflowHubService';
import { PrivateWorkflowPayload } from '../../lib/PrivateWorkflowPayload';

export class GetPrivateWorkflowResult implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Get Private Workflow Result',
		name: 'getPrivateWorkflowResult',
		group: ['input'],
		usableAsTool: true,
		version: 1,
		description: 'Retrieves the current status or result of a Private Workflow execution',
		icon: 'file:icon.svg',
		defaults: {
			name: 'Get Private Workflow Result'
		},
		inputs: ['main'],
		outputs: ['main', 'main'],
		outputNames: ['Completed', 'Pending'],
		credentials: [
			{
				name: 'privateWorkflowPublicKeyApi',
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
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const completed: INodeExecutionData[] = [];
		const pending: INodeExecutionData[] = [];

		// ------------------------------------------------------------
		// Credentials
		// ------------------------------------------------------------
		const creds = (await this.getCredentials('privateWorkflowPublicKeyApi')) as {
			apiKey?: string;
		};

		if (!creds?.apiKey) {
			throw new NodeOperationError(
				this.getNode(),
				'API key is missing. Configure the Private Workflow credentials.',
			);
		}

		const apiKey = creds.apiKey;

		// ------------------------------------------------------------
		// Parameters (SINGLE-SHOT)
		// ------------------------------------------------------------
		let correlationId = this.getNodeParameter('correlationId', 0) as string;
		correlationId = correlationId.trim();

		// ------------------------------------------------------------
		// Resolve execution hub via control plane
		// ------------------------------------------------------------
		const hubBase = HUB_BASE_URL;
		const hubService: HubUrlService = new HubUrlService(hubBase);
		const hubInfo: WorkflowHubService | null = await hubService.getHubInfo(apiKey);

		if (!hubInfo?.hubUrl || !hubInfo?.apiUrl || !hubInfo?.blobStorageUrl) {
			throw new NodeOperationError(
				this.getNode(),
				'Hub service information is incomplete or unavailable.',
			);
		}
		const targetUrl = `${hubInfo.apiUrl.replace(/\/+$/, '')}/results/${correlationId}`;
		this.logger.info(`[GetPrivateWorkflowResult] targetUrl = ${targetUrl}`);

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
		const payload = body?.payload as PrivateWorkflowPayload | undefined;

		if (!status) {
			throw new NodeOperationError(this.getNode(), 'Hub response missing status field');
		}

		// ------------------------------------------------------------
		// Normalize the payload if reference type
		// ------------------------------------------------------------
		let normalizedPayload = payload;
		if (status === 'Completed' && payload?.type === 'reference') {

			const referenceUrl = payload.value;
			if (!referenceUrl) {
				throw new NodeOperationError(
					this.getNode(),
					'Reference payload missing URL'
				);
			}

			this.logger.info(
				`[GetPrivateWorkflowResult] Downloading reference payload from ${referenceUrl}`
			);

			// eslint-disable-next-line @n8n/community-nodes/no-http-request-with-manual-auth
			const response = await this.helpers.httpRequest({
				method: 'GET',
				url: referenceUrl,
				headers: {
					'x-api-key': apiKey,
				},
			});

			const buffer = Buffer.isBuffer(response)
				? response
				: Buffer.from(response);

			let decodedValue: string;

			switch (payload.encoding) {
				case 'base64':
					decodedValue = buffer.toString('base64');
					break;

				case 'json':
				case 'text':
					decodedValue = buffer.toString('utf8');
					break;

				default:
					throw new NodeOperationError(
						this.getNode(),
						`Unsupported payload encoding: ${payload.encoding}`
					);
			}

			normalizedPayload = {
				...payload,
				type: 'inline',
				value: decodedValue,
			};
		}


		// ------------------------------------------------------------
		// Pending states
		// ------------------------------------------------------------
		if (status === 'Queued' || status === 'Running' || status === 'Pending') {
			pending.push({
				json: {
					status,
					correlationId,
				},
			});
			return [completed, pending];
		}

		// ------------------------------------------------------------
		// Completed with NO payload
		// ------------------------------------------------------------
		if (status === 'Completed' && !payload) {
			completed.push({
				json: {
					status,
					correlationId,
				},
			});
			return [completed, pending];
		}

		// ------------------------------------------------------------
		// Completed WITH payload
		// ------------------------------------------------------------
		if (status === 'Completed' && normalizedPayload?.type === 'inline') {
			// -------------------------
			// JSON
			// -------------------------
			if (normalizedPayload.encoding === 'json') {
				const parsed = JSON.parse(normalizedPayload.value);

				completed.push({
					json: parsed,
				});
			}

			// -------------------------
			// TEXT
			// -------------------------
			else if (normalizedPayload.encoding === 'text') {
				completed.push({
					json: {
						text: normalizedPayload.value,
					},
				});
			}

			// -------------------------
			// BINARY (base64)
			// -------------------------
			else if (normalizedPayload.encoding === 'base64') {
				const binaryData = Buffer.from(normalizedPayload.value, 'base64');

				completed.push({
					json: {
						status,
						correlationId,
					},
					binary: {
						file: {
							data: binaryData.toString('base64'),
							mimeType: 'application/octet-stream',
							fileName: 'workflow-result.bin',
						},
					},
				});
			} else {
				throw new NodeOperationError(
					this.getNode(),
					`Unsupported payload encoding: ${normalizedPayload.encoding}`,
				);
			}

			return [completed, pending];
		}

		// ------------------------------------------------------------
		// Fallback
		// ------------------------------------------------------------
		throw new NodeOperationError(this.getNode(), `Unknown workflow status: ${status}`);
	}
}
