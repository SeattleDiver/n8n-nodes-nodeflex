import { PrivateWorkflowPayload } from './PrivateWorkflowPayload';

export interface PrivateWorkflowResponse {
	correlationId: string;
	requestId: string;
	path: string;
	payload: PrivateWorkflowPayload;
}
