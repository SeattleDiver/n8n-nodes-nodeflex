import type { SignalRPrivateWorkflowClient } from './SignalRPrivateWorkflowClient';

interface ConnectionPoolLogger {
	info: (msg: string) => void;
	warn?: (msg: string) => void;
	error?: (msg: string) => void;
}

// Storage: Map of path → { client }
interface PoolEntry {
	client: SignalRPrivateWorkflowClient;
}

const connectionPool = new Map<string, PoolEntry>();
let logger: ConnectionPoolLogger | undefined;

function logInfo(action: string, metadata: Record<string, unknown>): void {
	logger?.info?.(`[SignalRConnectionPool] ${action} ${JSON.stringify(metadata)}`);
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
	getConnectionPool
};
