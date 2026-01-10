export type PrivateWorkflowPayload =
  | { type: 'inline'; value: string; length: number; isEncrypted?: boolean, encoding?: string }       // Small data (string/JSON/base64)
  | { type: 'reference'; url: string; length: number; isEncrypted?: boolean, encoding?: string };     // Large data (download URL)
