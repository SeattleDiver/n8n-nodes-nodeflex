import { describe, it, expect } from 'vitest';
import {
	uniqueWorkflowName,
	startConnectedTrigger,
	sendViaExecute,
	waitForTriggerMessage,
	fetchRealHubInfo,
} from './helpers/roundTrip';

// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals -- test-only file, not part of the published package
const apiKey = process.env.NODEFLEX_TEST_API_KEY;

// Data-type coverage for Execute -> Trigger against the real hub (the JSON
// small-object case is covered by executeTriggerRespondGetResult.test.ts).
// Arrays are intentionally not covered here: both ExecutePrivateWorkflow's
// custom-JSON validation and PrivateWorkflowTrigger's payload normalization
// explicitly reject bare arrays (see docs/testing.md EW-06 / PWT-07), and
// jsonSource:'input' can never produce one since n8n items are always objects.
describe.skipIf(!apiKey)('Live data-type matrix: Execute -> Trigger', () => {
	it('carries a small binary payload inline', async () => {
		const workflowName = uniqueWorkflowName('exec-binary-small');
		const { ctx: triggerCtx, closeFunction } = await startConnectedTrigger(apiKey as string, {
			workflowName,
			respond: 'immediately',
			immediateResponseStatus: 'Completed',
		});

		try {
			const base64Data = Buffer.from('hello world').toString('base64');
			const [ackData] = await sendViaExecute(
				apiKey as string,
				{ workflowName, payloadType: 'binary', binarySelection: 'byName', binaryPropertyName: 'file', waitForResponse: false },
				[{ json: {}, binary: { file: { data: base64Data, mimeType: 'text/plain', fileName: 'hello.txt' } } }],
			);
			expect(ackData).toHaveLength(1);

			const { item } = await waitForTriggerMessage(triggerCtx);
			expect(item.binary.file.data).toBe(base64Data);
		} finally {
			await closeFunction();
		}
	});

	// Skipped: confirmed via direct `nslookup` that the account's blobStorageUrl
	// (storagewestus.blob.core.windows.net) is NXDOMAIN — a real backend/account
	// misconfiguration on the hub side, not something fixable in test code.
	// hub.nodeflex.io and blob.core.windows.net (the parent domain) both resolve
	// fine, so this isn't a local network/DNS issue. Re-enable once the account's
	// blob storage endpoint is fixed.
	it.skip('carries a large JSON payload via blob storage', async () => {
		const workflowName = uniqueWorkflowName('exec-json-large');
		const hubInfo = await fetchRealHubInfo(apiKey as string);
		const bigString = 'x'.repeat(hubInfo.maxPayload + 10_000);

		const { ctx: triggerCtx, closeFunction } = await startConnectedTrigger(apiKey as string, {
			workflowName,
			respond: 'immediately',
			immediateResponseStatus: 'Completed',
		});

		try {
			const [ackData] = await sendViaExecute(
				apiKey as string,
				{ workflowName, payloadType: 'json', jsonSource: 'input', waitForResponse: false },
				[{ json: { blob: bigString } }],
			);
			expect(ackData).toHaveLength(1);

			const { item } = await waitForTriggerMessage(triggerCtx, 15000);
			expect(item.json.blob).toBe(bigString);
		} finally {
			await closeFunction();
		}
	}, 25000);

	// Skipped for the same reason as the JSON blob case above.
	it.skip('carries a large binary payload via blob storage', async () => {
		const workflowName = uniqueWorkflowName('exec-binary-large');
		const hubInfo = await fetchRealHubInfo(apiKey as string);
		const base64Data = Buffer.alloc(hubInfo.maxPayload + 10_000, 'a').toString('base64');

		const { ctx: triggerCtx, closeFunction } = await startConnectedTrigger(apiKey as string, {
			workflowName,
			respond: 'immediately',
			immediateResponseStatus: 'Completed',
		});

		try {
			const [ackData] = await sendViaExecute(
				apiKey as string,
				{ workflowName, payloadType: 'binary', binarySelection: 'byName', binaryPropertyName: 'file', waitForResponse: false },
				[{ json: {}, binary: { file: { data: base64Data, mimeType: 'application/octet-stream', fileName: 'big.bin' } } }],
			);
			expect(ackData).toHaveLength(1);

			const { item } = await waitForTriggerMessage(triggerCtx, 15000);
			expect(item.binary.file.data).toBe(base64Data);
		} finally {
			await closeFunction();
		}
	}, 25000);
});
