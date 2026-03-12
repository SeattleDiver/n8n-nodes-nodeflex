// WorkflowPayloadBlobTransport.ts

export interface WorkflowPayloadBlobTransportConfig {
	/**
	 * Blob upload endpoint provided by the hub.
	 * Example:
	 *   https://hub.nodeflex.io/api/blob
	 */
	baseUrl: string;

	/**
	 * API key for authenticating blob operations
	 */
	apiKey: string;

	/**
	 * Optional static headers (correlation IDs, tracing, etc.)
	 */
	headers?: Record<string, string>;
}

export interface BlobUploadResult {
	blobId: string;
	url: string;
	expiresInSeconds: number;
}

export interface UploadOptions {
	fileName?: string; // optional, used for form filename
	contentType?: string; // optional, mime type for file part
}

export class WorkflowPayloadBlobTransport {
	private readonly uploadUrl: string;

	constructor(private readonly cfg: WorkflowPayloadBlobTransportConfig) {
		this.uploadUrl = cfg.baseUrl.replace(/\/+$/, '');
	}

	// ------------------------------------------------------------
	// Upload raw bytes → blob reference
	// ------------------------------------------------------------
	async upload(buffer: Buffer, options: UploadOptions = {}): Promise<BlobUploadResult> {
		const fileName = options.fileName ?? 'payload.bin';
		const contentType = options.contentType ?? 'application/octet-stream';

		const form = new FormData();

		// Node 18+ supports Blob
		const blob = new Blob([buffer], { type: contentType });

		// IMPORTANT: field name must match C# property name: "File"
		form.append('File', blob, fileName);

		const response = await fetch(this.uploadUrl, {
			method: 'POST',
			headers: {
				'x-api-key': this.cfg.apiKey,
				...this.cfg.headers,
				// DO NOT set Content-Type for multipart; fetch will add boundary
			},
			body: form,
		});

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			throw new Error(`Blob upload failed (${response.status}): ${text}`);
		}

		const body = (await response.json()) as BlobUploadResult;

		if (!body?.url) {
			throw new Error('Blob upload response missing url');
		}

		return body;
	}

	// ------------------------------------------------------------
	// Download blob reference → raw bytes
	// ------------------------------------------------------------
	async download(url: string): Promise<Buffer> {
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'x-api-key': this.cfg.apiKey,
				...this.cfg.headers,
			},
		});

		if (!response.ok) {
			throw new Error(`Blob download failed (${response.status})`);
		}

		const arrayBuffer = await response.arrayBuffer();
		return Buffer.from(arrayBuffer);
	}
}
