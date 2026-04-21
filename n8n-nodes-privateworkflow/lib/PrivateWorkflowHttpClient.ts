import { IHttpRequestOptions } from 'n8n-workflow';
import { IN8nHttpHelper } from './N8nHttpHelper';

export interface PrivateWorkflowClientOptions {
	apiKey?: string;
	timeoutMs?: number;       // default 15s
}

/**
 * Lightweight HTTP client that posts a prepared PrivateWorkflowRequest
 * to a fully constructed target URL.
 *
 * You build the URL externally (including workflow path or query params).
 */
export class PrivateWorkflowHttpClient {

	constructor(
		private options: PrivateWorkflowClientOptions,
		private http: IN8nHttpHelper,
	) {}

	/**
	 * Posts the given body to the target URL.
	 * The body should match the C# PrivateWorkflowRequest model.
	 */
	async post(targetUrl: string, body: Record<string, unknown>): Promise<unknown> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (this.options.apiKey) {
			headers['x-api-key'] = this.options.apiKey;
		}

		const requestOptions: IHttpRequestOptions = {
			method: 'POST',
			url: targetUrl,
			headers,
			body: JSON.stringify(body),
			timeout: this.options.timeoutMs ?? 15000,
			returnFullResponse: true,
			json: false,
		};

		const resp = await this.http.httpRequest(requestOptions);

		const responseBody = resp.body;
		if (typeof responseBody === 'string') {
			try {
				return JSON.parse(responseBody);
			} catch {
				return responseBody;
			}
		}
		return responseBody;
	}
}
