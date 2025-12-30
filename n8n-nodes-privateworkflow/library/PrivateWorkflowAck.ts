export interface PrivateWorkflowAck {
	correlationId: string;
  requestId: string;
  path: string;
	status: string;
  timestampUtc?: string;
}
