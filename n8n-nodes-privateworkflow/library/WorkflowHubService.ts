export interface WorkflowHubService {
	// ---------------------------------------------------------
	// Endpoints
	// ---------------------------------------------------------

	apiUrl: string;
	hubUrl: string;
	blobStorageUrl: string;

	// ---------------------------------------------------------
	// Tier / Limits
	// ---------------------------------------------------------

	tier: string;

	/** Maximum inline payload size (bytes) */
	maxPayload: number;

	/** Maximum concurrent workflows allowed */
	maxConcurrentWorkflows: number;

	/** Seconds to wait for ACK from hub */
	ackTimeoutSeconds: number;

	/** Maximum retry attempts */
	maxRetries: number;

	/** Seconds between retries */
	retryInterval: number;

	// ---------------------------------------------------------
	// Storage Offload
	// ---------------------------------------------------------

	useStorage: boolean;

	/** Maximum payload size allowed via storage (bytes) */
	maxStorageSize: number;

	/** Storage TTL in seconds */
	storageTtl: number;

	// ---------------------------------------------------------
	// Optional Metadata
	// ---------------------------------------------------------

	metadata?: string;
}
