import { INodeExecutionData } from 'n8n-workflow';

export interface HydrationOptions {
	binaryPropertyName?: string; // default: 'file'
}

export interface HydrationResult {
	state: 'completed' | 'pending';
	items: INodeExecutionData[];
}

export class PrivateWorkflowResponseHydrator {

	static hydrate(
		body: any,
		options: HydrationOptions = {}
	): HydrationResult {

		const binaryKey = options.binaryPropertyName ?? 'file';
		const status: string | undefined = body?.status;

		if (!status) {
			throw new Error('Response missing status');
		}

		// ------------------------------------------------------------
		// Pending states
		// ------------------------------------------------------------
		if (status === 'Queued' || status === 'Running' || status === 'Pending') {
			return {
				state: 'pending',
				items: [
					{
						json: { status },
					},
				],
			};
		}

		// ------------------------------------------------------------
		// Completed state
		// ------------------------------------------------------------
		if (status !== 'Completed') {
			throw new Error(`Unknown workflow status: ${status}`);
		}

		const payload = body?.payload;

		// ------------------------------------------------------------
		// No payload
		// ------------------------------------------------------------
		if (!payload || payload.value == null) {
			return {
				state: 'completed',
				items: [
					{
						json: { status },
					},
				],
			};
		}

		if (typeof payload.value !== 'string') {
			throw new Error('Payload value must be a string');
		}

		const encoding = payload.encoding as
			| 'json'
			| 'text'
			| 'base64'
			| undefined;

		if (!encoding) {
			throw new Error('Payload encoding is required');
		}

		// ------------------------------------------------------------
		// JSON encoding
		// ------------------------------------------------------------
		if (encoding === 'json') {
			let parsed: any;

			try {
				parsed = JSON.parse(payload.value);
			} catch {
				throw new Error('Invalid JSON payload');
			}

			if (Array.isArray(parsed)) {
				return {
					state: 'completed',
					items: parsed.map((element) => ({
						json: {
							status,
							...(element ?? {}),
						},
					})),
				};
			}

			return {
				state: 'completed',
				items: [
					{
						json: {
							status,
							...(parsed ?? {}),
						},
					},
				],
			};
		}

		// ------------------------------------------------------------
		// TEXT encoding
		// ------------------------------------------------------------
		if (encoding === 'text') {
			return {
				state: 'completed',
				items: [
					{
						json: {
							status,
							text: payload.value,
						},
					},
				],
			};
		}

		// ------------------------------------------------------------
		// BASE64 (binary) encoding
		// ------------------------------------------------------------
		if (encoding === 'base64') {
			return {
				state: 'completed',
				items: [
					{
						json: { status },
						binary: {
							[binaryKey]: {
								data: payload.value,
								mimeType: 'application/octet-stream',
								fileName: 'workflow-response.bin',
							},
						},
					},
				],
			};
		}

		// ------------------------------------------------------------
		// Exhaustive guard
		// ------------------------------------------------------------
		throw new Error(`Unsupported payload encoding: ${encoding}`);
	}
}
