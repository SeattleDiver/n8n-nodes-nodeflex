import { describe, it, expect } from 'vitest';
import { HubProfileService } from '../../lib/HubProfileService';
import { HUB_BASE_URL, HUB_VERIFY_URL } from '../../lib/HubConfig';
import { createRealHttpClient } from './helpers/realHttpClient';

// Real, live integration tests against the actual NodeFlex hub — no n8n
// instance involved, just the plain lib/*.ts classes talking to a real
// network endpoint via NODEFLEX_TEST_API_KEY. Run with `npm run test:integration`.
//
// These never print process.env.NODEFLEX_TEST_API_KEY or any response value
// that might echo it back — only booleans/shape assertions — so nothing
// sensitive reaches test output/CI logs even when this suite runs.

// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals -- test-only file, not part of the published package; this is how the gitignored local key reaches the test
const apiKey = process.env.NODEFLEX_TEST_API_KEY;

describe.skipIf(!apiKey)('Live NodeFlex hub connectivity', () => {
	it('verifies the API key against the real hub', async () => {
		const http = createRealHttpClient();
		const result = await http.httpRequest({
			method: 'GET',
			url: HUB_VERIFY_URL,
			qs: { apiKey },
			returnFullResponse: true,
		});
		expect(result.statusCode).toBe(200);
	});

	it('fetches real hub info for the account', async () => {
		const hubService = new HubProfileService(HUB_BASE_URL, createRealHttpClient());
		const hubInfo = await hubService.getHubInfo(apiKey as string);

		expect(typeof hubInfo.hubUrl).toBe('string');
		expect(hubInfo.hubUrl.length).toBeGreaterThan(0);
		expect(typeof hubInfo.apiUrl).toBe('string');
		expect(typeof hubInfo.maxPayload).toBe('number');
	});

	it('rejects an invalid API key', async () => {
		const hubService = new HubProfileService(HUB_BASE_URL, createRealHttpClient());
		await expect(hubService.getHubInfo('not-a-real-api-key')).rejects.toThrow();
	});
});

// If NODEFLEX_TEST_API_KEY isn't set, the describe.skipIf block above reports
// as skipped in vitest's own output — no separate log needed here.
