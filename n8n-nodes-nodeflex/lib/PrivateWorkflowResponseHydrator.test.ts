import { describe, it, expect } from 'vitest';
import { PrivateWorkflowResponseHydrator } from './PrivateWorkflowResponseHydrator';

// PrivateWorkflowResponseHydrator.hydrate() is a pure static function (no `this`,
// no network) so these tests call it directly with no mocking at all — the
// simplest kind of test in this suite. It covers the "data transform" matrix
// (docs/testing.md section 5): every payload encoding the package supports.

describe('PrivateWorkflowResponseHydrator', () => {
	it('returns a pending item for Queued/Running/Pending statuses', async () => {
		for (const status of ['Queued', 'Running', 'Pending']) {
			const result = await PrivateWorkflowResponseHydrator.hydrate({ status });
			expect(result.state).toBe('pending');
			expect(result.items).toEqual([{ json: { status }, pairedItem: undefined }]);
		}
	});

	it('throws when status is missing', async () => {
		await expect(PrivateWorkflowResponseHydrator.hydrate({})).rejects.toThrow('Response missing status');
	});

	it('throws on an unrecognized status', async () => {
		await expect(PrivateWorkflowResponseHydrator.hydrate({ status: 'Bogus' })).rejects.toThrow(
			'Unknown workflow status: Bogus',
		);
	});

	it('returns a bare completed item when there is no payload', async () => {
		const result = await PrivateWorkflowResponseHydrator.hydrate({ status: 'Completed' });
		expect(result).toEqual({ state: 'completed', items: [{ json: { status: 'Completed' }, pairedItem: undefined }] });
	});

	it('decodes an inline JSON object payload', async () => {
		const result = await PrivateWorkflowResponseHydrator.hydrate({
			status: 'Completed',
			payload: { type: 'inline', value: JSON.stringify({ orderId: 'A-1001' }), encoding: 'json' },
		});
		expect(result.state).toBe('completed');
		expect(result.items).toEqual([{ json: { status: 'Completed', orderId: 'A-1001' }, pairedItem: undefined }]);
	});

	it('decodes an inline JSON array payload into one item per element', async () => {
		const result = await PrivateWorkflowResponseHydrator.hydrate({
			status: 'Completed',
			payload: { type: 'inline', value: JSON.stringify([{ id: 1 }, { id: 2 }]), encoding: 'json' },
		});
		expect(result.items).toHaveLength(2);
		expect(result.items[0].json).toEqual({ status: 'Completed', id: 1 });
		expect(result.items[1].json).toEqual({ status: 'Completed', id: 2 });
	});

	it('rejects invalid JSON payloads', async () => {
		await expect(
			PrivateWorkflowResponseHydrator.hydrate({
				status: 'Completed',
				payload: { type: 'inline', value: '{not valid json', encoding: 'json' },
			}),
		).rejects.toThrow('Invalid JSON payload');
	});

	it('decodes a text payload', async () => {
		const result = await PrivateWorkflowResponseHydrator.hydrate({
			status: 'Completed',
			payload: { type: 'inline', value: 'hello world', encoding: 'text' },
		});
		expect(result.items).toEqual([{ json: { status: 'Completed', text: 'hello world' }, pairedItem: undefined }]);
	});

	it('decodes a base64 payload into a binary property', async () => {
		const result = await PrivateWorkflowResponseHydrator.hydrate(
			{
				status: 'Completed',
				payload: { type: 'inline', value: 'aGVsbG8=', encoding: 'base64' },
			},
			{ binaryPropertyName: 'myFile' },
		);
		expect(result.items).toEqual([
			{
				json: { status: 'Completed' },
				binary: {
					myFile: { data: 'aGVsbG8=', mimeType: 'application/octet-stream', fileName: 'workflow-response.bin' },
				},
				pairedItem: undefined,
			},
		]);
	});

	it('rejects a reference payload with no http/apiKey supplied', async () => {
		await expect(
			PrivateWorkflowResponseHydrator.hydrate({
				status: 'Completed',
				payload: { type: 'reference', value: 'https://example.test/blob/1', encoding: 'json' },
			}),
		).rejects.toThrow('http and apiKey are required to resolve reference payloads');
	});

	it('downloads and decodes a reference (blob) payload', async () => {
		const httpRequest = async () => Buffer.from(JSON.stringify({ orderId: 'A-1001' }));
		const result = await PrivateWorkflowResponseHydrator.hydrate(
			{
				status: 'Completed',
				payload: { type: 'reference', value: 'https://example.test/blob/1', encoding: 'json' },
			},
			{ http: { httpRequest }, apiKey: 'test-api-key' },
		);
		expect(result.items).toEqual([{ json: { status: 'Completed', orderId: 'A-1001' }, pairedItem: undefined }]);
	});

	it('rejects an unsupported encoding', async () => {
		await expect(
			PrivateWorkflowResponseHydrator.hydrate({
				status: 'Completed',
				payload: { type: 'inline', value: 'x', encoding: 'weird' },
			}),
		).rejects.toThrow('Unsupported payload encoding: weird');
	});

	it('stamps pairedItem onto every returned item when itemIndex is given', async () => {
		const result = await PrivateWorkflowResponseHydrator.hydrate(
			{ status: 'Completed', payload: { type: 'inline', value: JSON.stringify([{ id: 1 }, { id: 2 }]), encoding: 'json' } },
			{ itemIndex: 3 },
		);
		expect(result.items.every((item) => item.pairedItem?.item === 3)).toBe(true);
	});
});
