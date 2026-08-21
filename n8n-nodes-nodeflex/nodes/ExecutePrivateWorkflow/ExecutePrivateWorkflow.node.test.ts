import { describe, it, expect } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { createMockContext, mockHttpRequestRouter } from '../../tests/helpers/mockExecuteFunctions';
import { ExecutePrivateWorkflow } from './ExecutePrivateWorkflow.node';

// These correspond to the "Unit" rows for Execute Private Workflow in
// docs/testing.md section 2 (EW-04, EW-05, EW-06, EW-08, EW-10, EW-16, EW-19).
// helpers.httpRequest is mocked to answer the hub-info lookup so execution
// reaches the validation logic under test — no real hub is contacted.

describe('ExecutePrivateWorkflow', () => {
	function run(options: Parameters<typeof createMockContext>[0]) {
		const ctx = createMockContext({
			httpRequest: mockHttpRequestRouter(),
			...options,
			params: { workflowName: 'test-workflow', payloadType: 'json', jsonSource: 'input', waitForResponse: false, ...options.params },
		});
		const node = new ExecutePrivateWorkflow();
		return node.execute.call(ctx as unknown as IExecuteFunctions);
	}

	it('EW-16: requires a workflow name', async () => {
		await expect(run({ params: { workflowName: '' } })).rejects.toThrow('Workflow name is required.');
	});

	it('EW-04: custom JSON must be valid JSON', async () => {
		await expect(
			run({ params: { jsonSource: 'custom', jsonText: '{not valid json' } }),
		).rejects.toThrow('Invalid JSON in JSON field.');
	});

	it('EW-05: custom JSON is required when JSON Source is custom', async () => {
		await expect(
			run({ params: { jsonSource: 'custom', jsonText: undefined } }),
		).rejects.toThrow('JSON is required when JSON Source is custom.');
	});

	it('EW-06: custom JSON must resolve to an object', async () => {
		await expect(
			run({ params: { jsonSource: 'custom', jsonText: 42 } }),
		).rejects.toThrow('JSON field must be a JSON object or a JSON string that parses to an object.');
	});

	it('EW-08: binary property must exist on the item', async () => {
		await expect(
			run({
				params: { payloadType: 'binary', binarySelection: 'byName', binaryPropertyName: 'nope' },
				inputItems: [{ json: {}, binary: { file: { data: 'aGk=', mimeType: 'text/plain' } } }],
			}),
		).rejects.toThrow('Binary property "nope" was not found on the incoming item.');
	});

	it('EW-10: binary payload requires binary data on the item', async () => {
		await expect(
			run({ params: { payloadType: 'binary' }, inputItems: [{ json: {} }] }),
		).rejects.toThrow('Payload is set to Binary File, but no binary data exists on the incoming item.');
	});

	it('EW-19: continueOnFail captures per-item errors without failing the workflow', async () => {
		const result = await run({
			continueOnFail: true,
			inputItems: [{ json: { a: 1 } }, { json: { a: 2 } }],
			paramsByItem: [{ workflowName: '' }, { workflowName: 'test-workflow' }],
			httpRequest: mockHttpRequestRouter(),
			httpRequestWithAuthentication: () => ({
				body: JSON.stringify({ correlationId: 'corr-1', path: 'p', status: 'Running', timeStampUtc: '2026-01-01T00:00:00Z' }),
			}),
		});

		const [ackData] = result;
		expect(ackData).toHaveLength(2);

		// Item 0 failed validation — captured as an error item, not a thrown exception.
		expect(ackData[0].json.error).toBe(true);
		expect(ackData[0].json.message).toContain('Workflow name is required.');
		expect(ackData[0].pairedItem).toEqual({ item: 0 });

		// Item 1 succeeded normally.
		expect(ackData[1].json.error).toBeUndefined();
		expect(ackData[1].pairedItem).toEqual({ item: 1 });
	});

	it('EW-24: sends the main hub request via credential-based auth, not a manual header', async () => {
		let sawCredentialType: string | undefined;
		const result = await run({
			httpRequestWithAuthentication: (credentialType) => {
				sawCredentialType = credentialType;
				return {
					body: JSON.stringify({ correlationId: 'corr-1', path: 'p', status: 'Running', timeStampUtc: '2026-01-01T00:00:00Z' }),
				};
			},
		});

		expect(sawCredentialType).toBe('privateWorkflowApi');
		const [ackData] = result;
		expect(ackData[0].json.correlationId).toBe('corr-1');
	});

	it('EW-25: text payload type sends the configured text value', async () => {
		let capturedBody: string | undefined;
		await run({
			params: { payloadType: 'text', textValue: 'hello world' },
			httpRequestWithAuthentication: (_credentialType, options) => {
				capturedBody = options.body as string;
				return {
					body: JSON.stringify({ correlationId: 'corr-1', path: 'p', status: 'Running', timeStampUtc: '2026-01-01T00:00:00Z' }),
				};
			},
		});

		const sentPayload = JSON.parse(capturedBody ?? '{}').payload;
		expect(sentPayload.encoding).toBe('text');
		expect(sentPayload.value).toBe('hello world');
	});

	it('EW-26: hub connectivity failure (EW-17) is thrown as NodeApiError', async () => {
		await expect(
			run({
				httpRequest: () => {
					throw new Error('network unreachable');
				},
			}),
		).rejects.toBeInstanceOf(NodeApiError);
	});
});
