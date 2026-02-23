// -----------------------------------------------------------------------------
// PrivateWorkflowResponseRegistry.ts
// -----------------------------------------------------------------------------
// This module holds pending private workflow responses between the
// ExecutePrivateWorkflowTrigger and the RespondToPrivateWorkflow node.
//
// Each entry maps a correlationId (UUID) to a live response context that
// includes the SignalR client, requestId (from the hub), path, and any pending
// Promise resolvers/rejecters for deferred responses.
// -----------------------------------------------------------------------------

import type { SignalRPrivateWorkflowClient } from './SignalRPrivateWorkflowClient';

// -----------------------------------------------------------------------------
// Type: RegistryEntry
// -----------------------------------------------------------------------------
export interface RegistryEntry {

	correlationId: string;

	/** Reference to the SignalR client used to send the eventual response */
	client: SignalRPrivateWorkflowClient;

	/** RequestId originally sent by the hub (needed for response correlation) */
	requestId: string;

	/** Workflow path associated with this execution */
	path: string;

	/** Optional resolver for deferred workflows (active mode only) */
	resolve?: (data: any) => void;

	/** Optional rejecter for deferred workflows */
	reject?: (err: any) => void;

	/** Timeout handle (cleared when the workflow responds or times out) */
	timeout?: NodeJS.Timeout;

	/** True if this was registered during a manual execution run */
	isManual?: boolean;
}

// -----------------------------------------------------------------------------
// Registry Storage
// -----------------------------------------------------------------------------
const registry = new Map<string, RegistryEntry>();

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Registers a new entry for a given correlationId.
 */
export function registerResponseEntry(correlationId: string, entry: RegistryEntry): void {
	// Defensive cleanup if the same correlationId already exists
	if (registry.has(correlationId)) {
		const existing = registry.get(correlationId);
		if (existing?.timeout) clearTimeout(existing.timeout);
		registry.delete(correlationId);
	}

	registry.set(correlationId, entry);
}

/**
 * Retrieves an entry for a given correlationId.
 */
export function getResponseEntry(correlationId: string): RegistryEntry | undefined {
	return registry.get(correlationId);
}

/**
 * Deletes an entry and clears its timeout if present.
 */
export function removeResponseEntry(correlationId: string): void {
	const entry = registry.get(correlationId);
	if (entry?.timeout) clearTimeout(entry.timeout);
	registry.delete(correlationId);
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
