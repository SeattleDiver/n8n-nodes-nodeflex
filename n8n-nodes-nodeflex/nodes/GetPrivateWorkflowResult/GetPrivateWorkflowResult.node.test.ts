import { describe, it, expect } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';
import { createMockContext, mockHttpRequestRouter } from '../../tests/helpers/mockExecuteFunctions';
import { GetPrivateWorkflowResult } from './GetPrivateWorkflowResult.node';

// Corresponds to the "Unit" rows for Get Private Workflow Result in
// docs/testing.md section 4 (GR-05, GR-06, GR-13, GR-14). helpers.httpRequest
// answers the hub-info lookup; helpers.httpRequestWithAuthentication answers
// the "get result" call itself — both mocked, no real hub is contacted.

describe('GetPrivateWorkflowResult', () => {
	function run(options: Parameters<typeof createMockContext>[0]) {
		const ctx = createMockContext({
			httpRequest: mockHttpRequestRouter(),
			...options,
			params: { correlationId: 'corr-1', continueOn: ['Completed'], ...options.params },
		});
		const node = new GetPrivateWorkflowResult();
		return node.execute.call(ctx as unknown as IExecuteFunctions);
	}

	it('GR-06: requires an API key', async () => {
		await expect(run({ credentials: {} })).rejects.toThrow(
			'API key is missing. Configure the Private Workflow credentials.',
		);
	});

	it('GR-05: throws when the hub response has no status field', async () => {
		await expect(
			run({ httpRequestWithAuthentication: { body: { somethingElse: true } } }),
		).rejects.toThrow('Hub response missing status field');
	});

	it('GR-13: a malformed completed payload is wrapped as NodeOperationError, not a raw error', async () => {
		await expect(
			run({
				httpRequestWithAuthentication: {
					body: {
						status: 'Completed',
						payload: { type: 'inline', value: '{not valid json', encoding: 'json' },
					},
				},
			}),
		).rejects.toThrow('Invalid JSON payload');
	});

	it('GR-14: pairedItem is always { item: 0 } — Completed branch', async () => {
		const [completed, pending] = await run({
			httpRequestWithAuthentication: { body: { status: 'Completed' } },
		});
		expect(pending).toEqual([]);
		expect(completed[0].pairedItem).toEqual({ item: 0 });
	});

	it('GR-14: pairedItem is always { item: 0 } — Pending branch', async () => {
		const [completed, pending] = await run({
			params: { continueOn: ['Completed'] }, // Running is not selected, so it routes to Pending
			httpRequestWithAuthentication: { body: { status: 'Running' } },
		});
		expect(completed).toEqual([]);
		expect(pending[0].pairedItem).toEqual({ item: 0 });
	});
});
