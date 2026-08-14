import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import type { IExecuteFunctions, ITriggerFunctions } from 'n8n-workflow';
import { createMockContext } from '../helpers/mockExecuteFunctions';
import { createRealHttpClient, createRealHttpRequestWithAuthentication } from './helpers/realHttpClient';
import { PrivateWorkflowTrigger } from '../../nodes/PrivateWorkflowTrigger/PrivateWorkflowTrigger.node';
import { ExecutePrivateWorkflow } from '../../nodes/ExecutePrivateWorkflow/ExecutePrivateWorkflow.node';
import { RespondToPrivateWorkflow } from '../../nodes/RespondToPrivateWorkflow/RespondToPrivateWorkflow.node';
import { GetPrivateWorkflowResult } from '../../nodes/GetPrivateWorkflowResult/GetPrivateWorkflowResult.node';

// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals -- test-only file, not part of the published package
const apiKey = process.env.NODEFLEX_TEST_API_KEY;

// A representative full round trip through all four nodes' *real* production
// code (only the n8n plumbing — getNodeParameter, getCredentials, emit — is
// mocked via createMockContext; every HTTP call and the SignalR connection
// are real, hitting the actual NodeFlex hub). This is the pattern the full
// per-data-type matrix (once approved) will replicate for each payload type
// and each RespondToPrivateWorkflow mode.
describe.skipIf(!apiKey)('Live round trip: Execute -> Trigger -> Respond -> GetResult (JSON)', () => {
	it('carries a JSON payload through all four nodes against the real hub', async () => {
		const workflowName = `test-roundtrip-${randomUUID()}`;
		const realHttp = createRealHttpClient().httpRequest;
		const realHttpAuth = createRealHttpRequestWithAuthentication(apiKey as string);

		// 1. Start the trigger for real — opens an actual SignalR connection and
		// registers `workflowName` with the hub. Deferred respond mode means it
		// waits for a RespondToPrivateWorkflow node instead of auto-acking.
		const triggerCtx = createMockContext({
			params: { workflowName, respond: 'respondToPrivateWorkflow', immediateResponseStatus: 'Completed' },
			credentials: { apiKey },
			httpRequest: realHttp,
			httpRequestWithAuthentication: realHttpAuth,
		});
		const trigger = new PrivateWorkflowTrigger();
		const { closeFunction } = await trigger.trigger.call(triggerCtx as unknown as ITriggerFunctions);

		try {
			// 2. Send a real execution request — the hub delivers it to the
			// trigger above over the already-open SignalR connection.
			const sentPayload = { orderId: 'A-1001', amount: 42.5 };
			const executeCtx = createMockContext({
				params: { workflowName, payloadType: 'json', jsonSource: 'input', waitForResponse: false },
				inputItems: [{ json: sentPayload }],
				credentials: { apiKey },
				httpRequest: realHttp,
			});
			const executeNode = new ExecutePrivateWorkflow();
			const [ackData] = await executeNode.execute.call(executeCtx as unknown as IExecuteFunctions);
			expect(ackData).toHaveLength(1);

			// 3. Wait for the trigger's onExecute to actually fire (async, driven
			// by the hub's SignalR delivery — not on the same tick as step 2).
			await vi.waitFor(() => expect(triggerCtx.emit).toHaveBeenCalled(), { timeout: 10000 });

			const emittedItem = triggerCtx.emit.mock.calls[0][0][0][0];
			expect(emittedItem.json.orderId).toBe('A-1001');
			expect(emittedItem.json.amount).toBe(42.5);
			const correlationId = emittedItem.json.__correlationId as string;
			expect(correlationId).toBeTruthy();

			// 4. Respond to it for real — POSTs to the hub's completed endpoint.
			const responsePayload = { received: true, echoedOrderId: sentPayload.orderId };
			const respondCtx = createMockContext({
				params: { correlationId, respondWith: 'json', responseData: JSON.stringify(responsePayload) },
				credentials: { apiKey },
				httpRequest: realHttp,
				httpRequestWithAuthentication: realHttpAuth,
			});
			const respondNode = new RespondToPrivateWorkflow();
			await respondNode.execute.call(respondCtx as unknown as IExecuteFunctions);

			// 5. Read it back for real via Get Private Workflow Result.
			const getResultCtx = createMockContext({
				params: { correlationId, continueOn: ['Completed'] },
				credentials: { apiKey },
				httpRequest: realHttp,
				httpRequestWithAuthentication: realHttpAuth,
			});
			const getResultNode = new GetPrivateWorkflowResult();
			const [completed, pending] = await getResultNode.execute.call(
				getResultCtx as unknown as IExecuteFunctions,
			);

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
