import { WorkflowPayloadEncoding } from "./WorkflowPayloadEncoding";

export type PrivateWorkflowPayload =
  | { type: 'inline'; value: string; length: number; isEncrypted?: boolean, encoding: WorkflowPayloadEncoding }       // Small data (string/JSON/base64)
  | { type: 'reference'; url: string; length: number; isEncrypted?: boolean, encoding: WorkflowPayloadEncoding };     // Large data (download URL)
