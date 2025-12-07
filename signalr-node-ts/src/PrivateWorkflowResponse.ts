import { PrivateWorkflowPayload } from './PrivateWorkflowPayload';

export interface PrivateWorkflowResponse {
	requestId: string;
	path: string;
	payload: PrivateWorkflowPayload;
}
