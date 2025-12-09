export type PrivateWorkflowPayload = 
  | { type: 'inline'; value: string; length: number; isEncrypted?: boolean }       // Small data (string/JSON/base64)
  | { type: 'reference'; url: string; length: number; isEncrypted?: boolean };     // Large data (download URL)
