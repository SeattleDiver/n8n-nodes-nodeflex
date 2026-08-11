import { IHttpRequestOptions } from 'n8n-workflow';
import { WorkflowHubService } from "./WorkflowHubService";
import { IN8nHttpHelper } from "./N8nHttpHelper";

export class HubProfileService {
	constructor(
			private readonly apiBaseUrl: string,
			private readonly http: IN8nHttpHelper,
	) {}

	public async getHubInfo(apiKey: string): Promise<WorkflowHubService> {
			const options : IHttpRequestOptions = {
					method: 'GET',
					url: `${this.apiBaseUrl}/api/apikeys/hub`,
					qs: {
						apiKey
					},
					json: true,
					// Development only: set to true when debugging against a local hub (e.g. localhost).
					// Must remain false in production.
					skipSslCertificateValidation: false,
			};

			const json = await this.http.httpRequest(options);

			// Validate shape
			if (!json || typeof json.hubUrl !== 'string') {
					throw new Error('Hub endpoint JSON missing required hubUrl property.');
			}

			// Return the typed object with defaults
			return {
					accountPath: json.accountPath,
					apiUrl: json.apiUrl,
					hubUrl: json.hubUrl,
					blobStorageUrl: json.blobStorageUrl ?? '',
					tier: json.tier ?? 'Free',
					maxPayload: json.maxPayload ?? 0,
					maxConcurrentWorkflows: json.maxConcurrentWorkflows ?? 1,
					ackTimeoutSeconds: json.ackTimeoutSeconds ?? 5,
					maxRetries: json.maxRetries ?? 0,
					retryInterval: json.retryInterval ?? 0,
					useStorage: json.useStorage ?? false,
					maxStorageSize: json.maxStorageSize ?? 0,
					storageTtl: json.storageTtl ?? 0,
					metadata: json.metadata,
			};
	}
}