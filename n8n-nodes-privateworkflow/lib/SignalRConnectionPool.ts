// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { clearTimeout } from 'node:timers';
import type { SignalRPrivateWorkflowClient } from './SignalRPrivateWorkflowClient';

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

// Helper: Normalize path to lowercase for consistent key lookups
function normalizePathKey(path: string): string {
	return path.toLowerCase();
}

// Public API

/**
 * Retrieves a connection for the given path, if it exists.
 */
export function getConnection(path: string): SignalRPrivateWorkflowClient | undefined {
	return connectionPool.get(normalizePathKey(path))?.client;
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
}

/**
 * Removes a connection for the given path.
 */
export function removeConnection(path: string): void {
	connectionPool.delete(normalizePathKey(path));
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
): void {
	const key = normalizePathKey(path);
	const entry = connectionPool.get(key);
	if (!entry) return;

	// Clear any existing timeout
	if (entry.pendingRequest?.timeout) {
		clearTimeout(entry.pendingRequest.timeout);
	}

	entry.pendingRequest = request;
}

/**
 * Retrieves the pending request for a given path, if any.
 */
export function getPendingRequest(path: string): PendingRequestContext | undefined {
	return connectionPool.get(normalizePathKey(path))?.pendingRequest;
}

/**
 * Clears the pending request for a given path.
 */
export function clearPendingRequest(path: string): void {
	const key = normalizePathKey(path);
	const entry = connectionPool.get(key);
	if (!entry) return;

	if (entry.pendingRequest?.timeout) {
		clearTimeout(entry.pendingRequest.timeout);
	}

	entry.pendingRequest = undefined;
}

// Export as default object for convenience
export const SignalRConnectionPool = {
	get: getConnection,
	set: setConnection,
	remove: removeConnection,
	clearAll: clearAllConnections,
	count: countConnections,
	getPaths: getActivePaths,
	setPendingRequest,
	getPendingRequest,
	clearPendingRequest,
};
