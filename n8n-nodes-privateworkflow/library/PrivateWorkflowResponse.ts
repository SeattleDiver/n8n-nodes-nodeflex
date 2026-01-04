import { PrivateWorkflowPayload } from './PrivateWorkflowPayload';

export interface PrivateWorkflowResponse {
	correlationId: string;
	status: string;
	requestId: string;
	path: string;
	payload: PrivateWorkflowPayload;
}
