import { describe, it, expect } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';
import { createMockContext, mockHttpRequestRouter } from '../../tests/helpers/mockExecuteFunctions';
import { RespondToPrivateWorkflow } from './RespondToPrivateWorkflow.node';

// Corresponds to the "Unit" rows for Respond to Private Workflow in
// docs/testing.md section 3 (RW-02, RW-04, RW-05, RW-06, RW-10, RW-11,
// RW-12, RW-16, RW-18). helpers.httpRequest answers the hub-info lookup (and
// the node's own best-effort "Failed" report on error paths); no real hub
// is contacted.

describe('RespondToPrivateWorkflow', () => {
	function run(options: Parameters<typeof createMockContext>[0]) {
		const ctx = createMockContext({
			httpRequest: mockHttpRequestRouter(),
			httpRequestWithAuthentication: {},
			inputItems: [{ json: { a: 1 } }],
			...options,
			params: { respondWith: 'none', correlationId: 'corr-1', ...options.params },
		});
		const node = new RespondToPrivateWorkflow();
		return node.execute.call(ctx as unknown as IExecuteFunctions);
	}

	it('RW-18: requires a correlation ID', async () => {
		await expect(run({ params: { correlationId: '' } })).rejects.toThrow('Correlation ID is required.');
	});

	it('RW-02: "All Items" rejects binary data', async () => {
		await expect(
			run({
				params: { respondWith: 'allItems' },
				inputItems: [{ json: { a: 1 } }, { json: { a: 2 }, binary: { file: { data: 'aGk=', mimeType: 'text/plain' } } }],
			}),
		).rejects.toThrow('"All Items" response does not support binary data. Use "Binary File" instead.');
	});

	it('RW-04: "First Item" with zero input items returns an empty object, no error', async () => {
		const [outputItems] = await run({ params: { respondWith: 'firstItem' }, inputItems: [] });
		expect(outputItems).toEqual([{ json: {}, pairedItem: { item: 0 } }]);
	});

	it('RW-05: "First Item" rejects binary data', async () => {
		await expect(
			run({
				params: { respondWith: 'firstItem' },
				inputItems: [{ json: { a: 1 }, binary: { file: { data: 'aGk=', mimeType: 'text/plain' } } }],
			}),
		).rejects.toThrow('"First Item" response does not support binary data. Use "Binary File" instead.');
	});

	it('RW-06: "First Item" requires the item to be a JSON object', async () => {
		await expect(
			run({ params: { respondWith: 'firstItem' }, inputItems: [{ json: [1, 2, 3] as unknown as Record<string, unknown> }] }),
		).rejects.toThrow('"First Item" requires the item to be a JSON object.');
	});

	it('RW-10: JSON response body cannot be empty', async () => {
		await expect(
			run({ params: { respondWith: 'json', responseData: '' } }),
		).rejects.toThrow('Response Body is empty; expected valid JSON');
	});

	it('RW-11: JSON response body must be valid JSON', async () => {
		await expect(
			run({ params: { respondWith: 'json', responseData: '{not valid' } }),
		).rejects.toThrow('Response Body must contain valid JSON');
	});

	it('RW-12: JSON response body must resolve to an object or array', async () => {
		await expect(
			run({ params: { respondWith: 'json', responseData: 42 } }),
		).rejects.toThrow('Response Body resolved to unsupported type (number)');
	});

	it('RW-16: binary mode with no binary data found is graceful, not a throw', async () => {
		const [outputItems] = await run({ params: { respondWith: 'binary', binaryMode: 'auto' }, inputItems: [{ json: {} }] });
		expect(outputItems).toEqual([{ json: { correlationId: 'corr-1', status: 'Success' }, pairedItem: { item: 0 } }]);
	});
});
