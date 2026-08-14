import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { IExecuteFunctions, INodeExecutionData, ITriggerFunctions } from 'n8n-workflow';
import { createMockContext, type MockContextOptions } from '../../helpers/mockExecuteFunctions';
import { createRealHttpClient, createRealHttpRequestWithAuthentication } from './realHttpClient';
import { HubProfileService } from '../../../lib/HubProfileService';
import { HUB_BASE_URL } from '../../../lib/HubConfig';
import { PrivateWorkflowTrigger } from '../../../nodes/PrivateWorkflowTrigger/PrivateWorkflowTrigger.node';
import { ExecutePrivateWorkflow } from '../../../nodes/ExecutePrivateWorkflow/ExecutePrivateWorkflow.node';
import { RespondToPrivateWorkflow } from '../../../nodes/RespondToPrivateWorkflow/RespondToPrivateWorkflow.node';
import { GetPrivateWorkflowResult } from '../../../nodes/GetPrivateWorkflowResult/GetPrivateWorkflowResult.node';

// Shared plumbing for every live-hub round-trip test: builds real HTTP-backed
// mock contexts (same createMockContext as the mocked Tier-1 suite, but with
// real `httpRequest`/`httpRequestWithAuthentication` and the real credential)
// and drives the actual node `.execute`/`.trigger` methods against the real
// hub. Centralizing this avoids the "forgot to pass the real API key" bug
// that silently sent every request under a fake key the first time this
// pattern was written by hand.

export function uniqueWorkflowName(prefix: string): string {
	return `test-${prefix}-${randomUUID()}`;
}

function baseOptions(apiKey: string, overrides: MockContextOptions): MockContextOptions {
	return {
		credentials: { apiKey },
		httpRequest: createRealHttpClient().httpRequest,
		httpRequestWithAuthentication: createRealHttpRequestWithAuthentication(apiKey),
		...overrides,
	};
}

export async function fetchRealHubInfo(apiKey: string) {
	return new HubProfileService(HUB_BASE_URL, createRealHttpClient()).getHubInfo(apiKey);
}

export async function startConnectedTrigger(apiKey: string, params: Record<string, unknown>) {
	const ctx = createMockContext(baseOptions(apiKey, { params }));
	const node = new PrivateWorkflowTrigger();
	const { closeFunction } = await node.trigger.call(ctx as unknown as ITriggerFunctions);
	return { ctx, closeFunction };
}

export async function sendViaExecute(
	apiKey: string,
	params: Record<string, unknown>,
	inputItems: MockContextOptions['inputItems'],
): Promise<INodeExecutionData[][]> {
	const ctx = createMockContext(baseOptions(apiKey, { params, inputItems }));
	const node = new ExecutePrivateWorkflow();
	return node.execute.call(ctx as unknown as IExecuteFunctions);
}

/** Waits for a connected trigger's onExecute to fire and returns the emitted item + its correlationId. */
export async function waitForTriggerMessage(
	triggerCtx: ReturnType<typeof createMockContext>,
	timeout = 10000,
) {
	await vi.waitFor(() => {
		if (!triggerCtx.emit.mock.calls.length) throw new Error('not emitted yet');
	}, { timeout });

	const item = triggerCtx.emit.mock.calls[0][0][0][0];
	const correlationId = item.json.__correlationId as string;
	return { item, correlationId };
}

export async function respondToWorkflow(
	apiKey: string,
	params: Record<string, unknown>,
	inputItems?: MockContextOptions['inputItems'],
): Promise<INodeExecutionData[][]> {
	const ctx = createMockContext(baseOptions(apiKey, { params, inputItems }));
	const node = new RespondToPrivateWorkflow();
	return node.execute.call(ctx as unknown as IExecuteFunctions);
}

export async function getWorkflowResult(
	apiKey: string,
	correlationId: string,
	continueOn: string[],
): Promise<INodeExecutionData[][]> {
	const ctx = createMockContext(baseOptions(apiKey, { params: { correlationId, continueOn } }));
	const node = new GetPrivateWorkflowResult();
	return node.execute.call(ctx as unknown as IExecuteFunctions);
}

/**
 * Connects a real trigger, sends a seed message through it to obtain a real
 * correlationId, runs `fn(correlationId)`, then always tears the connection
 * down — the shape every RespondToPrivateWorkflow-mode test needs, since a
 * correlationId only exists once the hub has routed a real execute request
 * to a real, connected trigger.
 */
export async function withCorrelationId<T>(
	apiKey: string,
	workflowPrefix: string,
	fn: (correlationId: string) => Promise<T>,
): Promise<T> {
	const workflowName = uniqueWorkflowName(workflowPrefix);
	const { ctx: triggerCtx, closeFunction } = await startConnectedTrigger(apiKey, {
		workflowName,
		respond: 'respondToPrivateWorkflow',
	});

	try {
		await sendViaExecute(
			apiKey,
			{ workflowName, payloadType: 'json', jsonSource: 'input', waitForResponse: false },
			[{ json: { seed: true } }],
		);
		const { correlationId } = await waitForTriggerMessage(triggerCtx);
		return await fn(correlationId);
	} finally {
		await closeFunction();
	}
}
