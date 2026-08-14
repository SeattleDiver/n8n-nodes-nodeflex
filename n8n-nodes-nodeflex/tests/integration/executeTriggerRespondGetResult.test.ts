import { describe, it, expect } from 'vitest';
import {
	uniqueWorkflowName,
	startConnectedTrigger,
	sendViaExecute,
	waitForTriggerMessage,
	respondToWorkflow,
	getWorkflowResult,
} from './helpers/roundTrip';

// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals -- test-only file, not part of the published package
const apiKey = process.env.NODEFLEX_TEST_API_KEY;

// A representative full round trip through all four nodes' *real* production
// code (only the n8n plumbing — getNodeParameter, getCredentials, emit — is
// mocked via createMockContext; every HTTP call and the SignalR connection
// are real, hitting the actual NodeFlex hub). This is the template the full
// per-data-type matrix (executeTriggerDataTypes.test.ts, respondModes.test.ts)
// replicates for each payload type and each RespondToPrivateWorkflow mode.
describe.skipIf(!apiKey)('Live round trip: Execute -> Trigger -> Respond -> GetResult (JSON)', () => {
	it('carries a JSON payload through all four nodes against the real hub', async () => {
		const workflowName = uniqueWorkflowName('roundtrip');

		// 1. Start the trigger for real — opens an actual SignalR connection and
		// registers `workflowName` with the hub. Deferred respond mode means it
		// waits for a RespondToPrivateWorkflow node instead of auto-acking.
		const { ctx: triggerCtx, closeFunction } = await startConnectedTrigger(apiKey as string, {
			workflowName,
			respond: 'respondToPrivateWorkflow',
			immediateResponseStatus: 'Completed',
		});

		try {
			// 2. Send a real execution request — the hub delivers it to the
			// trigger above over the already-open SignalR connection.
			const sentPayload = { orderId: 'A-1001', amount: 42.5 };
			const [ackData] = await sendViaExecute(
				apiKey as string,
				{ workflowName, payloadType: 'json', jsonSource: 'input', waitForResponse: false },
				[{ json: sentPayload }],
			);
			expect(ackData).toHaveLength(1);

			// 3. Wait for the trigger's onExecute to actually fire (async, driven
			// by the hub's SignalR delivery — not on the same tick as step 2).
			const { item: emittedItem, correlationId } = await waitForTriggerMessage(triggerCtx);
			expect(emittedItem.json.orderId).toBe('A-1001');
			expect(emittedItem.json.amount).toBe(42.5);
			expect(correlationId).toBeTruthy();

			// 4. Respond to it for real — POSTs to the hub's completed endpoint.
			const responsePayload = { received: true, echoedOrderId: sentPayload.orderId };
			await respondToWorkflow(apiKey as string, {
				correlationId,
				respondWith: 'json',
				responseData: JSON.stringify(responsePayload),
			});

			// 5. Read it back for real via Get Private Workflow Result.
			const [completed, pending] = await getWorkflowResult(apiKey as string, correlationId, ['Completed']);

			expect(pending).toHaveLength(0);
			expect(completed).toHaveLength(1);
			expect(completed[0].json.received).toBe(true);
			expect(completed[0].json.echoedOrderId).toBe('A-1001');
		} finally {
			// Always stop the SignalR connection so we don't leave the test
			// workflow path registered on the account after the test ends.
			await closeFunction();
		}
	});
});
