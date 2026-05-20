// -----------------------------------------------------------------------------
// PrivateWorkflowResponseRegistry.ts
// -----------------------------------------------------------------------------
// This module holds pending private workflow responses between the
// ExecutePrivateWorkflowTrigger and the RespondToPrivateWorkflow node.
//
// Each entry is keyed by workflow path and contains a live response context that
// includes the SignalR client, requestId (from the hub), correlationId, and any
// pending Promise resolvers/rejecters for deferred responses.
// 
// Note: The correlationId is now emitted with a path prefix (path:correlationId)
// for correlation tracking, but the registry uses path as the primary key since
// each path has only one active workflow trigger.
// -----------------------------------------------------------------------------

// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { clearTimeout } from 'node:timers';
import type { SignalRPrivateWorkflowClient } from './SignalRPrivateWorkflowClient';

// -----------------------------------------------------------------------------
// Type: RegistryEntry
// -----------------------------------------------------------------------------
export interface RegistryEntry {

	/** The original correlationId from the hub */
	correlationId: string;

	/** Reference to the SignalR client used to send the eventual response */
	client: SignalRPrivateWorkflowClient;

	/** RequestId originally sent by the hub (needed for response correlation) */
	requestId: string;

	/** Workflow path associated with this execution */
	path: string;

	/** Optional resolver for deferred workflows (active mode only) */
	resolve?: (data: unknown) => void;

	/** Optional rejecter for deferred workflows */
	reject?: (err: unknown) => void;

	/** Timeout handle (cleared when the workflow responds or times out) */
	timeout?: NodeJS.Timeout;

	/** True if this was registered during a manual execution run */
	isManual?: boolean;
}

// -----------------------------------------------------------------------------
// Registry Storage: keyed by path (since each path has a single active trigger)
// -----------------------------------------------------------------------------
const registry = new Map<string, RegistryEntry>();

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Registers a new entry for a given path.
 * Each path should have only one active entry; this replaces any existing entry for that path.
 */
export function registerResponseEntry(path: string, entry: RegistryEntry): void {
	// Defensive cleanup if the same path already exists
	if (registry.has(path)) {
		const existing = registry.get(path);
		if (existing?.timeout) clearTimeout(existing.timeout);
		registry.delete(path);
	}

	registry.set(path, entry);
}

/**
 * Retrieves an entry for a given path.
 */
export function getResponseEntry(path: string): RegistryEntry | undefined {
	return registry.get(path);
}

/**
 * Deletes an entry by path and clears its timeout if present.
 */
export function removeResponseEntry(path: string): void {
	const entry = registry.get(path);
	if (entry?.timeout) clearTimeout(entry.timeout);
	registry.delete(path);
}

/**
 * Clears all entries from the registry (e.g. on workflow shutdown).
 */
export function clearAllResponses(): void {
	for (const entry of registry.values()) {
		if (entry.timeout) clearTimeout(entry.timeout);
	}
	registry.clear();
}

/**
 * Returns the total number of pending responses (for debugging).
 */
export function countPendingResponses(): number {
	return registry.size;
}

// -----------------------------------------------------------------------------
// Export as default object for convenience
// -----------------------------------------------------------------------------
export const PrivateWorkflowResponseRegistry = {
	register: registerResponseEntry,
	get: getResponseEntry,
	delete: removeResponseEntry,
	clearAll: clearAllResponses,
	count: countPendingResponses,
};
