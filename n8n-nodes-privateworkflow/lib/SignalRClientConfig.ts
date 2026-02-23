import { PrivateWorkflowPayload } from './PrivateWorkflowPayload';
import { PrivateWorkflowRequest } from './PrivateWorkflowRequest';
import { WorkflowHubService } from './WorkflowHubService';

// ------------------- Interfaces (unchanged) -------------------
export interface SignalRClientConfig {
    hubUrl: string;
    hubPath: string;
    apiKey?: string;
    accessToken?: string;
		hubService: WorkflowHubService;
    logLevel?: 'none' | 'info' | 'debug';
    isSingleNodeRun?: boolean;

    logger?: {
        info: (msg: string, ...args: any[]) => void;
        warn: (msg: string, ...args: any[]) => void;
        error: (msg: string, ...args: any[]) => void;
    };

    onExecute: (req: {
        request?: PrivateWorkflowRequest;
        inlineJson?: any;
        inlineText?: string;
				payload?: PrivateWorkflowPayload;
    }) => Promise<any> | any;

    onConnectionError?: (error: unknown, context?: Record<string, unknown>) => void;
}
