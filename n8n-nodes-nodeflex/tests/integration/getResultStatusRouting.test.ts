import { describe, it, expect } from 'vitest';
import { sleep } from 'n8n-workflow';
import { withCorrelationId, respondToWorkflow, getWorkflowResult } from './helpers/roundTrip';

// The hub throttles rapid repeated polling of the same correlationId (a
// reasonable anti-abuse limit) — space out successive GetPrivateWorkflowResult
// calls against the same correlationId the way a real polling workflow would.
const pause = sleep;

// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals -- test-only file, not part of the published package
const apiKey = process.env.NODEFLEX_TEST_API_KEY;

// Confirms GetPrivateWorkflowResult's status-routing behavior against the
// real hub, both before and after a response — including the GR-03 nuance
// documented in docs/testing.md: routing a non-Completed status to the
// "Completed" output via `continueOn` only yields { status, correlationId },
// never the full hydrated payload (hydration only ever runs when the hub's
// own status is literally 'Completed').
describe.skipIf(!apiKey)('Live status routing: GetPrivateWorkflowResult', () => {
	it('routes to Pending before a response exists, and to Completed after', async () => {
		await withCorrelationId(apiKey as string, 'status-routing', async (correlationId) => {
			// Before any Respond call, the hub's status is whatever it defaults to
			// for an un-responded request — not 'Completed'.
			const [completedBefore, pendingBefore] = await getWorkflowResult(apiKey as string, correlationId, [
				'Completed',
			]);
			expect(completedBefore).toHaveLength(0);
			expect(pendingBefore).toHaveLength(1);
			expect(pendingBefore[0].json.status).not.toBe('Completed');
			expect(pendingBefore[0].json.correlationId).toBe(correlationId);

			// continueOn can be widened to route that same pre-completion status to
			// the "Completed" output — but it must NOT get the hydrated payload,
			// only the bare status/correlationId (GR-03).
			const preStatus = pendingBefore[0].json.status as string;
			await pause(3000);
			const [completedViaContinueOn] = await getWorkflowResult(apiKey as string, correlationId, [
				'Completed',
				preStatus,
			]);
			expect(completedViaContinueOn).toHaveLength(1);
			expect(Object.keys(completedViaContinueOn[0].json).sort()).toEqual(['correlationId', 'status']);

			// Now actually respond, and confirm it fully completes with the real payload.
			await respondToWorkflow(apiKey as string, {
				correlationId,
				respondWith: 'json',
				responseData: { done: true },
			});

			await pause(3000);
			const [completedAfter, pendingAfter] = await getWorkflowResult(apiKey as string, correlationId, [
				'Completed',
			]);
			expect(pendingAfter).toHaveLength(0);
			expect(completedAfter).toHaveLength(1);
			expect(completedAfter[0].json.done).toBe(true);
			expect(completedAfter[0].json.status).toBe('Completed');
		});
	}, 30000);
});
