import { PrivateWorkflowPayload } from './PrivateWorkflowPayload';

export interface PrivateWorkflowRequest {
	correlationId?: string;
	requestId?: string;
	path?: string;
	payload?: PrivateWorkflowPayload;
}
