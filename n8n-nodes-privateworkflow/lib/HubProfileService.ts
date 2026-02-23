import {
	ITriggerFunctions,
	IExecuteFunctions,
	IHttpRequestOptions
} from 'n8n-workflow';
import { WorkflowHubService } from "./WorkflowHubService";

export class HubProfileService {
	constructor(
			private readonly apiBaseUrl: string,
			// Pass n8n functions to use the built-in request helper
			private readonly n8nContext: IExecuteFunctions | ITriggerFunctions,
	) {}

	public async getHubInfo(apiKey: string): Promise<WorkflowHubService> {
			const options : IHttpRequestOptions = {
					method: 'GET',
					url: `${this.apiBaseUrl}/api/apikeys/hub`,
					qs: {
						apiKey
					},
					json: true,
			};

			try {
					// Using n8n's helper instead of fetch
					const json = await this.n8nContext.helpers.httpRequest(options);

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
			} catch (error) {
					// We do NOT catch 404s here to return null.
					// We let the error bubble up so the Trigger can decide to retry.
					throw error;
			}
	}
}