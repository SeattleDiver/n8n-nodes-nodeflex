/* eslint-disable @typescript-eslint/no-explicit-any */
// SignalRClientConfig uses `any` for dynamic SignalR protocol callbacks
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

    // Retry / backoff configuration (defaults applied in SignalRPrivateWorkflowClient)
    retryMaxDurationMs?: number;       // Total retry budget (default: 8 hours = 28_800_000)
    retryInitialDelayMs?: number;      // First retry delay (default: 2_000)
    retryPhase1CapMs?: number;         // Max delay during phase 1 (default: 60_000)
    retryPhase1DurationMs?: number;    // Phase 1 window before switching to phase 2 (default: 1 hour = 3_600_000)
    retryPhase2IntervalMs?: number;    // Fixed interval in phase 2 (default: 15 min = 900_000)
}
