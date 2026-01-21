// PayloadFileUploader.ts

export interface FileUploadResult {
	url: string;
	sizeBytes: number;
	contentType: string;
}

export interface UploadOptions {
	fileName: string;
	mimeType?: string;
	headers?: Record<string, string>;
}

export class PayloadFileUploader {

	constructor(
		private readonly uploadEndpoint: string,
		private readonly apiKey: string,
	) {}

	/**
	 * Uploads a binary payload and returns a reference URL
	 */
	async upload(
		data: Buffer,
		options: UploadOptions
	): Promise<FileUploadResult> {

		const response = await fetch(this.uploadEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': options.mimeType ?? 'application/octet-stream',
				'x-api-key': this.apiKey,
				...options.headers,
			},
			body: data,
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`File upload failed (${response.status}): ${text}`);
		}

		const result = await response.json() as {
			url: string;
		};

		if (!result?.url) {
			throw new Error('Upload response missing URL');
		}

		return {
			url: result.url,
			sizeBytes: data.length,
			contentType: options.mimeType ?? 'application/octet-stream',
		};
	}
}
