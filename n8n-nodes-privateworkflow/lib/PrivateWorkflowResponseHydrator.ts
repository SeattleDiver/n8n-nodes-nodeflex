/* eslint-disable @typescript-eslint/no-explicit-any */
import { INodeExecutionData } from 'n8n-workflow';
import { IN8nHttpHelper } from './N8nHttpHelper';
import { PrivateWorkflowPayload } from './PrivateWorkflowPayload';

export interface HydrationOptions {
	binaryPropertyName?: string; // default: 'file'
	/** Required only when the hub may return a reference (blob) payload */
	http?: IN8nHttpHelper;
	apiKey?: string;
}

export interface HydrationResult {
	state: 'completed' | 'pending';
	items: INodeExecutionData[];
}

export class PrivateWorkflowResponseHydrator {

	static async hydrate(
		body: any,
		options: HydrationOptions = {}
	): Promise<HydrationResult> {

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
				items: [{ json: { status } }],
			};
		}

		// ------------------------------------------------------------
		// Completed state
		// ------------------------------------------------------------
		if (status !== 'Completed') {
			throw new Error(`Unknown workflow status: ${status}`);
		}

		let payload: PrivateWorkflowPayload | undefined = body?.payload;

		// ------------------------------------------------------------
		// No payload
		// ------------------------------------------------------------
		if (!payload || payload.value == null) {
			return {
				state: 'completed',
				items: [{ json: { status } }],
			};
		}

		if (typeof payload.value !== 'string') {
			throw new Error('Payload value must be a string');
		}

		// ------------------------------------------------------------
		// Resolve reference payload (blob download)
		// ------------------------------------------------------------
		if (payload.type === 'reference') {
			if (!options.http || !options.apiKey) {
				throw new Error('http and apiKey are required to resolve reference payloads');
			}

			const response = await options.http.httpRequest({
				method: 'GET',
				url: payload.value,
				headers: { 'x-api-key': options.apiKey },
			});

			const buffer = Buffer.isBuffer(response) ? response : Buffer.from(response);

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
					throw new Error(`Unsupported payload encoding: ${payload.encoding}`);
			}

			payload = { ...payload, type: 'inline', value: decodedValue };
		}

		const encoding = payload.encoding;
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
						json: { status, ...(element ?? {}) },
					})),
				};
			}

			return {
				state: 'completed',
				items: [{ json: { status, ...(parsed ?? {}) } }],
			};
		}

		// ------------------------------------------------------------
		// TEXT encoding
		// ------------------------------------------------------------
		if (encoding === 'text') {
			return {
				state: 'completed',
				items: [{ json: { status, text: payload.value } }],
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
