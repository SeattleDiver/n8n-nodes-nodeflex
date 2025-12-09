import { PrivateWorkflowPayload } from './PrivateWorkflowPayload';

export interface PrivateWorkflowRequest {
	correlationId?: string;
	CorrelationId?: string;

	requestId?: string;
	RequestId?: string;

	path?: string;
	Path?: string;

	payload?: PrivateWorkflowPayload; // may be base64 or JSON string
	Payload?: PrivateWorkflowPayload;
}
