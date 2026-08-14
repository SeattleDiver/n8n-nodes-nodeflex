import { describe, it, expect } from 'vitest';
import { withCorrelationId, respondToWorkflow, getWorkflowResult } from './helpers/roundTrip';

// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals -- test-only file, not part of the published package
const apiKey = process.env.NODEFLEX_TEST_API_KEY;

// The full RespondToPrivateWorkflow mode matrix against the real hub. Each
// case: establishes a real correlationId via a connected trigger, responds
// with the mode under test, then reads it back via GetPrivateWorkflowResult
// to confirm the round trip — same real node code, real HTTP, as the
// canonical example in executeTriggerRespondGetResult.test.ts.
describe.skipIf(!apiKey)('Live data-type matrix: RespondToPrivateWorkflow modes', () => {
	it('respondWith = allItems', async () => {
		await withCorrelationId(apiKey as string, 'respond-allitems', async (correlationId) => {
			await respondToWorkflow(
				apiKey as string,
				{ correlationId, respondWith: 'allItems' },
				[{ json: { a: 1 } }, { json: { b: 2 } }],
			);

			const [completed] = await getWorkflowResult(apiKey as string, correlationId, ['Completed']);
			expect(completed).toHaveLength(2);
			expect(completed[0].json.a).toBe(1);
			expect(completed[1].json.b).toBe(2);
		});
	});

	it('respondWith = firstItem', async () => {
		await withCorrelationId(apiKey as string, 'respond-firstitem', async (correlationId) => {
			await respondToWorkflow(
				apiKey as string,
				{ correlationId, respondWith: 'firstItem' },
				[{ json: { a: 1 } }, { json: { b: 2 } }],
			);

			const [completed] = await getWorkflowResult(apiKey as string, correlationId, ['Completed']);
			expect(completed).toHaveLength(1);
			expect(completed[0].json.a).toBe(1);
			expect(completed[0].json.b).toBeUndefined();
		});
	});

	it('respondWith = json (single object)', async () => {
		await withCorrelationId(apiKey as string, 'respond-json-obj', async (correlationId) => {
			await respondToWorkflow(apiKey as string, {
				correlationId,
				respondWith: 'json',
				responseData: { foo: 'bar' },
			});

			const [completed] = await getWorkflowResult(apiKey as string, correlationId, ['Completed']);
			expect(completed).toHaveLength(1);
			expect(completed[0].json.foo).toBe('bar');
		});
	});

	it('respondWith = json (array)', async () => {
		await withCorrelationId(apiKey as string, 'respond-json-arr', async (correlationId) => {
			await respondToWorkflow(apiKey as string, {
				correlationId,
				respondWith: 'json',
				responseData: [{ x: 1 }, { x: 2 }],
			});

			const [completed] = await getWorkflowResult(apiKey as string, correlationId, ['Completed']);
			expect(completed).toHaveLength(2);
			expect(completed[0].json.x).toBe(1);
			expect(completed[1].json.x).toBe(2);
		});
	});

	it('respondWith = text', async () => {
		await withCorrelationId(apiKey as string, 'respond-text', async (correlationId) => {
			await respondToWorkflow(apiKey as string, {
				correlationId,
				respondWith: 'text',
				responseText: 'hello from the test suite',
			});

			const [completed] = await getWorkflowResult(apiKey as string, correlationId, ['Completed']);
			expect(completed).toHaveLength(1);
			expect(completed[0].json.text).toBe('hello from the test suite');
		});
	});

	it('respondWith = binary', async () => {
		await withCorrelationId(apiKey as string, 'respond-binary', async (correlationId) => {
			const base64Data = Buffer.from('respond binary payload').toString('base64');
			await respondToWorkflow(
				apiKey as string,
				{ correlationId, respondWith: 'binary', binaryMode: 'auto' },
				[{ json: {}, binary: { file: { data: base64Data, mimeType: 'text/plain', fileName: 'x.txt' } } }],
			);

			const [completed] = await getWorkflowResult(apiKey as string, correlationId, ['Completed']);
			expect(completed).toHaveLength(1);
			expect(completed[0].binary?.file.data).toBe(base64Data);
		});
	});

	it('respondWith = none', async () => {
		await withCorrelationId(apiKey as string, 'respond-none', async (correlationId) => {
			await respondToWorkflow(apiKey as string, { correlationId, respondWith: 'none' });

			const [completed] = await getWorkflowResult(apiKey as string, correlationId, ['Completed']);
			expect(completed).toHaveLength(1);
			expect(completed[0].json.status).toBe('Completed');
		});
	});
});
