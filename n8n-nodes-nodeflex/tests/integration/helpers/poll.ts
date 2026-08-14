import { sleep } from 'n8n-workflow';

/**
 * Retries `fn` with exponential backoff until `predicate(result)` is true or
 * `timeoutMs` elapses. A rejection from `fn` (e.g. a hub 429) is treated the
 * same as a failed predicate and retried, rather than aborting the poll.
 */
export async function pollUntil<T>(
	fn: () => Promise<T>,
	predicate: (result: T) => boolean,
	options: { timeoutMs?: number; initialDelayMs?: number; maxDelayMs?: number } = {},
): Promise<T> {
	const { timeoutMs = 15000, initialDelayMs = 500, maxDelayMs = 3000 } = options;
	const start = Date.now();
	let delay = initialDelayMs;
	let lastError: unknown;

	while (true) {
		await sleep(delay);

		try {
			const result = await fn();
			if (predicate(result)) return result;
			lastError = undefined;
		} catch (err) {
			lastError = err;
		}

		if (Date.now() - start >= timeoutMs) {
			const suffix = lastError instanceof Error ? ` (last error: ${lastError.message})` : '';
			throw new Error(`pollUntil: condition not met within ${timeoutMs}ms${suffix}`);
		}

		delay = Math.min(delay * 2, maxDelayMs);
	}
}
