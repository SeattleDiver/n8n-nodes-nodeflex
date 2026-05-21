// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { clearTimeout } from 'node:timers';
import type { SignalRPrivateWorkflowClient } from './SignalRPrivateWorkflowClient';

interface ConnectionPoolLogger {
	info: (msg: string) => void;
	warn?: (msg: string) => void;
	error?: (msg: string) => void;
}

// -----------------------------------------------------------------------------
// Type: Pending Request Context
// -----------------------------------------------------------------------------
/**
 * Metadata about a pending private workflow response waiting to be sent.
 * Stored in the connection pool for a given path.
 */
export interface PendingRequestContext {
	/** The original correlationId from the hub */
	correlationId: string;

	/** RequestId originally sent by the hub (needed for response correlation) */
	requestId: string;

	/** Timeout handle (cleared when the workflow responds or times out) */
	timeout?: NodeJS.Timeout;

	/** True if this was registered during a manual execution run */
	isManual?: boolean;
}

// Storage: Map of path → { client, pendingRequest }
interface PoolEntry {
	client: SignalRPrivateWorkflowClient;
	pendingRequest?: PendingRequestContext;
}

const connectionPool = new Map<string, PoolEntry>();
let logger: ConnectionPoolLogger | undefined;

function logInfo(action: string, metadata: Record<string, unknown>): void {
	logger?.info?.(`[SignalRConnectionPool] ${action} ${JSON.stringify(metadata)}`);
}

function logWarn(action: string, metadata: Record<string, unknown>): void {
	logger?.warn?.(`[SignalRConnectionPool] ${action} ${JSON.stringify(metadata)}`);
}

// Helper: Normalize path to lowercase for consistent key lookups
function normalizePathKey(path: string): string {
	return path.toLowerCase();
}

// Public API

export function getConnectionPool(): Map<string, PoolEntry> {
	logInfo('getConnectionPool', { size: connectionPool.size });
	return connectionPool;
}

/**
 * Gets all connection pool entries as [path, entry] tuples.
 */
export function getConnectionPoolEntries(): [string, PoolEntry][] {
	const entries = Array.from(connectionPool.entries());
	logInfo('getConnectionPoolEntries: ', { count: entries.length });
	return entries;
}

/**
 * Retrieves a connection for the given path, if it exists.
 */
export function getConnection(path: string): SignalRPrivateWorkflowClient | undefined {
	const key = normalizePathKey(path);
	const entry = connectionPool.get(key);
	logInfo('getConnection: ', { path: key, found: !!entry, size: connectionPool.size });
	return entry?.client;
}

/**
 * Stores or updates a connection for the given path.
 */
export function setConnection(path: string, client: SignalRPrivateWorkflowClient): void {
	const key = normalizePathKey(path);
	const existing = connectionPool.get(key);
	connectionPool.set(key, {
		client,
		pendingRequest: existing?.pendingRequest,
	});
	logInfo('setConnection', {
		path: key,
		replacedExisting: !!existing,
		size: connectionPool.size,
	});
}

/**
 * Removes a connection for the given path.
 */
export function removeConnection(path: string): void {
	const key = normalizePathKey(path);
	const removed = connectionPool.delete(key);
	logInfo('Delete entry', { path: key, removed, size: connectionPool.size });
}

export function setConnectionPoolLogger(poolLogger?: ConnectionPoolLogger): void {
	logger = poolLogger;
}

/**
 * Clears all connections from the pool.
 */
export function clearAllConnections(): void {
	for (const entry of connectionPool.values()) {
		if (entry.pendingRequest?.timeout) {
			clearTimeout(entry.pendingRequest.timeout);
		}
	}
	connectionPool.clear();
}

/**
 * Returns the total number of active connections in the pool.
 */
export function countConnections(): number {
	return connectionPool.size;
}

/**
 * Gets all paths that have active connections.
 */
export function getActivePaths(): string[] {
	return Array.from(connectionPool.keys());
}

/**
 * Registers a pending request for a given path.
 * Each path can have at most one pending request.
 */
export function setPendingRequest(
	path: string,
	request: PendingRequestContext,
): boolean {
	const key = normalizePathKey(path);
	const entry = connectionPool.get(key);
	if (!entry) {
		logWarn('setPendingRequest: Register pending request skipped (missing entry)', { path: key, size: connectionPool.size });
		return false;
	}

	// Clear any existing timeout
	if (entry.pendingRequest?.timeout) {
		clearTimeout(entry.pendingRequest.timeout);
	}

	entry.pendingRequest = request;
	logInfo('setPendingRequest: Register pending request', { path: key, requestId: request.requestId });
	return true;
}

/**
 * Retrieves the pending request for a given path, if any.
 */
export function getPendingRequest(path: string): PendingRequestContext | undefined {
	const key = normalizePathKey(path);
	const pendingRequest = connectionPool.get(key)?.pendingRequest;
	logInfo('Retrieve pending request', { path: key, found: !!pendingRequest });
	return pendingRequest;
}

/**
 * Clears the pending request for a given path.
 */
export function clearPendingRequest(path: string): void {
	const key = normalizePathKey(path);
	const entry = connectionPool.get(key);
	if (!entry) {
		logWarn('clearPendingRequest: Clear pending request skipped (missing entry)', { path: key, size: connectionPool.size });
		return;
	}

	if (entry.pendingRequest?.timeout) {
		clearTimeout(entry.pendingRequest.timeout);
	}

	entry.pendingRequest = undefined;
	logInfo('clearPendingRequest: Clear pending request', { path: key });
}

// Export as default object for convenience
export const SignalRConnectionPool = {
	get: getConnection,
	set: setConnection,
	remove: removeConnection,
	clearAll: clearAllConnections,
	count: countConnections,
	getPaths: getActivePaths,
	getEntries: getConnectionPoolEntries,
	setLogger: setConnectionPoolLogger,
	setPendingRequest,
	getPendingRequest,
	clearPendingRequest,
	getConnectionPool
};
