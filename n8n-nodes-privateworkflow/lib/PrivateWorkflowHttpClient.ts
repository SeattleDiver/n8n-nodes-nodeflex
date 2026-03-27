// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { setTimeout, clearTimeout } from 'node:timers';
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import https from 'node:https';

export interface PrivateWorkflowClientOptions {
	apiKey?: string;          // optional bearer token
	verifySSL?: boolean;      // false for self-signed localhost certs
	timeoutMs?: number;       // default 15s
}

/**
 * Lightweight HTTP client that posts a prepared PrivateWorkflowRequest
 * to a fully constructed target URL.
 *
 * You build the URL externally (including workflow path or query params).
 */
export class PrivateWorkflowHttpClient {

	constructor(private options: PrivateWorkflowClientOptions) {}

	/**
	 * Posts the given body to the target URL.
	 * The body should match the C# PrivateWorkflowRequest model.
	 */
	async post(targetUrl: string, body: Record<string, unknown>): Promise<unknown> {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(),
			this.options.timeoutMs ?? 15000
		);

		try {
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
			};
			if (this.options.apiKey) {
				headers['x-api-key'] = this.options.apiKey;
			}

			const fetchOpts: RequestInit & { agent?: https.Agent } = {
				method: 'POST',
				headers,
				body: JSON.stringify(body),
				signal: controller.signal,
			};

			if (this.options.verifySSL === false) {
				fetchOpts.agent = new https.Agent({ rejectUnauthorized: false });
			}

			const resp = await fetch(targetUrl, fetchOpts);
			clearTimeout(timeout);

			if (!resp.ok) {
				const text = await resp.text();
				throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text}`);
			}

			const contentType = resp.headers.get('content-type') ?? '';
			if (contentType.includes('application/json')) {
				return await resp.json();
			}
			return await resp.text();
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				throw new Error('Request timeout');
			}
			throw err;
		}
	}
}
