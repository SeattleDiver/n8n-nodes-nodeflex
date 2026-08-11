import { PrivateWorkflowPayload } from './PrivateWorkflowPayload';

export interface PrivateWorkflowRequest {
	correlationId: string;
	requestId: string;
	path: string;
	payload: PrivateWorkflowPayload;
	waitForResponse: boolean;
	waitTimeout: number;
}
