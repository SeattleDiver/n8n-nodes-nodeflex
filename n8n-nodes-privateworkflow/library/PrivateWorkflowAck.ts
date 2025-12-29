export interface PrivateWorkflowAck {
	correlationId: string;
  requestId: string;
  path: string;
  timestampUtc?: string;
}
