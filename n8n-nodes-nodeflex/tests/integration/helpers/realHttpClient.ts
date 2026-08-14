import type { IHttpRequestOptions } from 'n8n-workflow';
import type { IN8nHttpHelper } from '../../../lib/N8nHttpHelper';

// The lib/*.ts classes (HubProfileService, SignalR clients, blob transport)
// only depend on the small IN8nHttpHelper interface, not on n8n itself — that
// was a deliberate design choice in the source (see lib/N8nHttpHelper.ts).
// It means we can drive them with real network calls here using plain
// `fetch`, without needing a running n8n instance at all.
export function createRealHttpClient(): IN8nHttpHelper {
	return {
		async httpRequest(options: IHttpRequestOptions) {
			const url = new URL(options.url);
			if (options.qs) {
				for (const [key, value] of Object.entries(options.qs)) {
					url.searchParams.set(key, String(value));
				}
			}

			const headers: Record<string, string> = { ...(options.headers as Record<string, string> | undefined) };
			let body: BodyInit | undefined;
			if (options.body !== undefined) {
				if (options.body instanceof FormData || options.body instanceof Blob) {
					// Pass through as-is — fetch sets the multipart boundary Content-Type
					// itself for FormData. Stringifying it (the old behavior here) silently
					// corrupted every blob upload into a literal "{}" body.
					body = options.body as BodyInit;
				} else if (typeof options.body === 'string') {
					body = options.body;
				} else {
					body = JSON.stringify(options.body);
					if (options.json !== false && !headers['Content-Type']) {
						headers['Content-Type'] = 'application/json';
					}
				}
			}

			const response = await fetch(url, {
				method: options.method ?? 'GET',
				headers,
				body,
			});

			if (!response.ok) {
				throw new Error(`Hub request to ${url.pathname} failed: ${response.status} ${response.statusText}`);
			}

			// Binary downloads (e.g. blob retrieval) must not be routed through
			// text()/JSON.parse — that's how PrivateWorkflowTrigger and the
			// hydrator's reference-payload path fetch raw bytes.
			if (options.encoding === 'arraybuffer') {
				const buffer = Buffer.from(await response.arrayBuffer());
				return options.returnFullResponse ? { statusCode: response.status, body: buffer } : buffer;
			}

			const text = await response.text();
			let parsed: unknown = text;
			try {
				parsed = text ? JSON.parse(text) : undefined;
			} catch {
				// Not JSON — leave as raw text.
			}

			if (options.returnFullResponse) {
				return { statusCode: response.status, body: parsed };
			}
			return parsed;
		},
	};
}

/**
 * Matches the shape n8n's `helpers.httpRequestWithAuthentication` normally
 * provides: a credential-type-aware request that attaches auth automatically.
 * This package only has one credential type, so it just attaches the
 * `x-api-key` header the same way PrivateWorkflowApi.credentials.ts does.
 */
export function createRealHttpRequestWithAuthentication(apiKey: string) {
	const http = createRealHttpClient();
	return async (_credentialType: string, options: IHttpRequestOptions) => {
		return http.httpRequest({
			...options,
			headers: { ...options.headers, 'x-api-key': apiKey },
		});
	};
}
