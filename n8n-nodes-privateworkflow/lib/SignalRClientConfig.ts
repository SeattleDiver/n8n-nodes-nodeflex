/* eslint-disable @typescript-eslint/no-explicit-any */
// SignalRClientConfig uses `any` for dynamic SignalR protocol callbacks
import { PrivateWorkflowPayload } from './PrivateWorkflowPayload';
import { PrivateWorkflowRequest } from './PrivateWorkflowRequest';
import { WorkflowHubService } from './WorkflowHubService';
import { IN8nHttpHelper } from './N8nHttpHelper';

// ------------------- Interfaces (unchanged) -------------------
export interface SignalRClientConfig {
    hubUrl: string;
    hubPath: string;
    apiKey?: string;
    accessToken?: string;
		hubService: WorkflowHubService;
		http: IN8nHttpHelper;
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
