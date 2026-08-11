// WorkflowPayloadBlobTransport.ts

/* eslint-disable @typescript-eslint/no-explicit-any */
import { IHttpRequestOptions } from 'n8n-workflow';
import { IN8nHttpHelper } from './N8nHttpHelper';

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

	/**
	 * n8n HTTP helper for making requests
	 */
	http: IN8nHttpHelper;
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
		const blob = new Blob([buffer], { type: contentType });
		form.append('File', blob, fileName);

		// helpers.httpRequest uses axios which supports FormData natively
		const requestOptions: IHttpRequestOptions = {
			method: 'POST',
			url: this.uploadUrl,
			headers: {
				'x-api-key': this.cfg.apiKey,
				...this.cfg.headers,
			},
			body: form as any,
		};

		const body = await this.cfg.http.httpRequest(requestOptions) as BlobUploadResult;

		if (!body?.url) {
			throw new Error('Blob upload response missing url');
		}

		return body;
	}

	// ------------------------------------------------------------
	// Download blob reference → raw bytes
	// ------------------------------------------------------------
	async download(url: string): Promise<Buffer> {
		const requestOptions: IHttpRequestOptions = {
			method: 'GET',
			url,
			headers: {
				'x-api-key': this.cfg.apiKey,
				...this.cfg.headers,
			},
			encoding: 'arraybuffer',
		};

		const response = await this.cfg.http.httpRequest(requestOptions);
		return Buffer.isBuffer(response) ? response : Buffer.from(response);
	}
}
