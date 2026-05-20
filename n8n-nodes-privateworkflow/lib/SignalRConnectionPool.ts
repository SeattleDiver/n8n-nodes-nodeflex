// -----------------------------------------------------------------------------
// SignalRConnectionPool.ts
// -----------------------------------------------------------------------------
// Manages a pool of SignalR connections, tracking a single connection per path.
// Provides methods to get, set, and remove connections.
// 
// This allows multiple workflow triggers (each with a unique path) to maintain
// their own persistent connections, while supporting connection reuse.
// -----------------------------------------------------------------------------

import type { SignalRPrivateWorkflowClient } from './SignalRPrivateWorkflowClient';

// Storage: Map of path → SignalRPrivateWorkflowClient
const connectionPool = new Map<string, SignalRPrivateWorkflowClient>();

// Public API

/**
 * Retrieves a connection for the given path, if it exists.
 */
export function getConnection(path: string): SignalRPrivateWorkflowClient | undefined {
	return connectionPool.get(path);
}

/**
 * Stores or updates a connection for the given path.
 */
export function setConnection(path: string, client: SignalRPrivateWorkflowClient): void {
	connectionPool.set(path, client);
}

/**
 * Removes a connection for the given path.
 */
export function removeConnection(path: string): void {
	connectionPool.delete(path);
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
};
