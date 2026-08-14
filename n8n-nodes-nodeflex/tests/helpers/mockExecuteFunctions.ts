import { vi } from 'vitest';

/**
 * n8n calls a node's execute()/trigger() method with `this` bound to a large
 * context object (IExecuteFunctions / ITriggerFunctions) — that object is only
 * ever built by a real, running n8n instance. To unit test a node's *logic*
 * without a live n8n instance (and without hitting the real NodeFlex hub), we
 * build a fake version of that same object here. Each property is a
 * `vi.fn()` (a spy) so a test can both control what it returns and assert on
 * how it was called — e.g. `expect(ctx.emit).toHaveBeenCalled()`.
 *
 * Usage in a test:
 *
 *   const ctx = createMockContext({ params: { workflowName: 'x' } });
 *   const node = new ExecutePrivateWorkflow();
 *   const result = await node.execute.call(ctx as any);
 */

export interface MockContextOptions {
	/** Parameter values returned by getNodeParameter(name, itemIndex), same value for every item. */
	params?: Record<string, unknown>;
	/** Per-item overrides: paramsByItem[itemIndex][name] wins over `params` for that item. */
	paramsByItem?: Record<string, unknown>[];
	/** Value resolved by getCredentials(). Defaults to a valid API key. Set to `{}` or `{ apiKey: undefined }` to simulate a missing key. */
	credentials?: Record<string, unknown>;
	/** Items returned by getInputData(). Defaults to a single empty item. */
	inputItems?: Array<{ json: Record<string, unknown>; binary?: Record<string, unknown> }>;
	/** Response for helpers.httpRequest — a static value, or a function of the call options (for routing by URL). */
	httpRequest?: unknown | ((options: Record<string, unknown>) => unknown);
	/** Response for helpers.httpRequestWithAuthentication — a static value, or a function of (credentialType, options). */
	httpRequestWithAuthentication?: unknown | ((credentialType: string, options: Record<string, unknown>) => unknown);
	/** getMode() return value. Defaults to 'trigger' (a normal, non-manual run). Use 'manual' for editor test-runs. */
	mode?: string;
	/** continueOnFail() return value. Defaults to false. */
	continueOnFail?: boolean;
}

function asAsyncFn(value: unknown) {
	if (typeof value === 'function') {
		return vi.fn(async (...args: unknown[]) => (value as (...a: unknown[]) => unknown)(...args));
	}
	return vi.fn(async () => value);
}

export function createMockContext(options: MockContextOptions = {}) {
	const {
		params = {},
		paramsByItem,
		credentials = { apiKey: 'test-api-key' },
		inputItems = [{ json: {} }],
		httpRequest,
		httpRequestWithAuthentication,
		mode = 'trigger',
		continueOnFail = false,
	} = options;

	const node = {
		id: 'test-node-id',
		name: 'Test Node',
		type: 'test.node',
		typeVersion: 1,
		position: [0, 0] as [number, number],
		parameters: {},
	};

	const logger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};

	const context = {
		getNode: vi.fn(() => node),
		getMode: vi.fn(() => mode),
		getNodeParameter: vi.fn((name: string, itemIndex: number) => {
			const perItem = paramsByItem?.[itemIndex];
			if (perItem && name in perItem) return perItem[name];
			return params[name];
		}),
		getCredentials: vi.fn(async () => credentials),
		getInputData: vi.fn(() => inputItems),
		continueOnFail: vi.fn(() => continueOnFail),
		emit: vi.fn(),
		logger,
		helpers: {
			httpRequest: asAsyncFn(httpRequest),
			httpRequestWithAuthentication: asAsyncFn(httpRequestWithAuthentication),
			returnJsonArray: vi.fn((items: unknown[]) => items.map((json) => ({ json }))),
		},
	};

	return context;
}

/** A complete, valid hub-info response shape (what GET /api/apikeys/hub returns). */
export const HUB_INFO_FIXTURE = {
	accountPath: 'test-account',
	apiUrl: 'https://mock-hub.test/api',
	hubUrl: 'wss://mock-hub.test/hub',
	blobStorageUrl: 'https://mock-hub.test/blob',
	tier: 'Free',
	maxPayload: 65536,
	maxConcurrentWorkflows: 1,
	ackTimeoutSeconds: 5,
	maxRetries: 0,
	retryInterval: 0,
	useStorage: true,
	maxStorageSize: 10485760,
	storageTtl: 3600,
};

/**
 * Most nodes call helpers.httpRequest for two different purposes: fetching
 * hub info (GET .../api/apikeys/hub) and then a second, node-specific call.
 * This routes by URL so a single mocked httpRequest can serve both.
 */
export function mockHttpRequestRouter(opts: {
	hubInfo?: unknown;
	onOtherCall?: (options: Record<string, unknown>) => unknown;
} = {}) {
	const hubInfo = opts.hubInfo ?? HUB_INFO_FIXTURE;
	return (options: Record<string, unknown>) => {
		if (typeof options?.url === 'string' && options.url.includes('/api/apikeys/hub')) {
			return hubInfo;
		}
		return opts.onOtherCall ? opts.onOtherCall(options) : {};
	};
}
