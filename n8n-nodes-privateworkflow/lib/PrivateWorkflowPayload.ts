// import { WorkflowPayloadEncoding } from "./WorkflowPayloadEncoding";

// export type PrivateWorkflowPayload =
//   | { type: 'inline'; value: string; length: number; isEncrypted?: boolean, encoding: WorkflowPayloadEncoding }       // Small data (string/JSON/base64)
//   | { type: 'reference'; url: string; length: number; isEncrypted?: boolean, encoding: WorkflowPayloadEncoding };     // Large data (download URL)

export type PrivateWorkflowPayloadType = 'inline' | 'reference';
export type PrivateWorkflowPayloadEncoding = 'json' | 'base64' | 'text';

export interface PrivateWorkflowPayload {
	/**
	 * Controls how the payload is transported.
	 * - inline    → value contains the payload
	 * - reference → value contains a URL to fetch
	 */
	type: PrivateWorkflowPayloadType;

	/**
	 * Payload value:
	 * - inline    → JSON string or base64 string
	 * - reference → URL
	 */
	value: string;

	/**
	 * Original payload size (bytes for binary, chars for json).
	 * Used for limits, logging, and tier enforcement.
	 */
	length: number;

	/**
	 * Indicates whether the payload content is encrypted.
	 * Transport-only concern.
	 */
	isEncrypted: boolean;

	/**
	 * Encoding of the inline payload.
	 * Ignored for reference until resolved.
	 */
	encoding: PrivateWorkflowPayloadEncoding;
}
