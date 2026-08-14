import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ITriggerFunctions } from 'n8n-workflow';
import { createMockContext, mockHttpRequestRouter } from '../../tests/helpers/mockExecuteFunctions';

interface CapturedConfig {
	onExecute: (args: {
		request: Record<string, unknown>;
		inlineJson: unknown;
		inlineText: unknown;
		payload: unknown;
	}) => Promise<{ ok: boolean; error?: string }>;
}

// The trigger keeps a live SignalR connection open — real network activity we
// don't want in a unit test. `vi.mock` swaps the whole SignalRPrivateWorkflowClient
// module for a fake before PrivateWorkflowTrigger.node.ts (which imports the
// real one) ever loads, so every `new SignalRPrivateWorkflowClient(cfg)` call
// in the source hits our fake instead. The fake's job is just to capture the
// `cfg` object (which holds the onExecute/onConnectionError/onConnectionLost
// callbacks) so the test can invoke onExecute directly — that's where the
// per-message validation logic under test (PWT-07, PWT-08, PWT-12) actually lives.

const capturedConfigs: CapturedConfig[] = [];

vi.mock('../../lib/SignalRPrivateWorkflowClient', () => {
	// A plain `function`, not an arrow function — `new SignalRPrivateWorkflowClient(cfg)`
	// in the source requires something constructable, and arrow functions can't be `new`-ed.
	return {
		SignalRPrivateWorkflowClient: vi.fn().mockImplementation(function (cfg: CapturedConfig) {
			capturedConfigs.push(cfg);
			return {
				start: vi.fn(async () => {}),
				stop: vi.fn(async () => {}),
				waitForNextMessage: vi.fn(async () => {}),
			};
		}),
	};
});

// Imported after the mock so it picks up the faked SignalRPrivateWorkflowClient.
const { PrivateWorkflowTrigger } = await import('./PrivateWorkflowTrigger.node');

describe('PrivateWorkflowTrigger', () => {
	beforeEach(() => {
		capturedConfigs.length = 0;
	});

	async function activate(mode = 'trigger', respond = 'immediately') {
		const ctx = createMockContext({
			params: { workflowName: 'test-workflow', respond, immediateResponseStatus: 'Completed' },
			httpRequest: mockHttpRequestRouter(),
			mode,
		});
		const node = new PrivateWorkflowTrigger();
		await node.trigger.call(ctx as unknown as ITriggerFunctions);
		return { ctx, cfg: capturedConfigs[0] };
	}

	it('PWT-07: rejects array payloads', async () => {
		const { ctx, cfg } = await activate();
		const result = await cfg.onExecute({
			request: {
				requestId: 'req-1',
				correlationId: 'corr-1',
				payload: { type: 'inline', value: JSON.stringify([{ id: 1 }]), encoding: 'json', isEncrypted: false, length: 10 },
			},
			inlineJson: null,
			inlineText: null,
			payload: undefined,
		});
		expect(result).toEqual({ ok: false, error: expect.stringContaining('does not accept array payloads') });
		expect(ctx.emit).not.toHaveBeenCalled();
	});

	it('PWT-08: requires a correlationId', async () => {
		const { ctx, cfg } = await activate();
		const result = await cfg.onExecute({
			request: {
				requestId: 'req-1',
				correlationId: '',
				payload: { type: 'inline', value: '{}', encoding: 'json', isEncrypted: false, length: 2 },
			},
			inlineJson: null,
			inlineText: null,
			payload: undefined,
		});
		expect(result).toEqual({ ok: false, error: expect.stringContaining('CorrelationId is required') });
		expect(ctx.emit).not.toHaveBeenCalled();
	});

	it('PWT-12: a manual run forces "Immediately" regardless of the configured respond mode', async () => {
		const { ctx, cfg } = await activate('manual', 'respondToPrivateWorkflow');
		await cfg.onExecute({
			request: {
				requestId: 'req-1',
				correlationId: 'corr-1',
				payload: { type: 'inline', value: JSON.stringify({ hello: 'world' }), encoding: 'json', isEncrypted: false, length: 20 },
			},
			inlineJson: null,
			inlineText: null,
			payload: undefined,
		});

		expect(ctx.emit).toHaveBeenCalledWith([[{ json: { __correlationId: 'corr-1', hello: 'world' } }]]);
		expect(ctx.logger.info).toHaveBeenCalledWith(
			expect.stringContaining("Overriding respondMode to 'immediately' for test run"),
		);
		// The override sends an immediate ack POST, which is the observable proof
		// the deferred ("Using Respond Node") path was NOT taken.
		expect(ctx.helpers.httpRequestWithAuthentication).toHaveBeenCalled();
	});
});
