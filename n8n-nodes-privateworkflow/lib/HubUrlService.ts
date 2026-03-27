import { WorkflowHubService } from "./WorkflowHubService";

export class HubUrlService {

    private readonly apiBaseUrl: string;

    constructor(apiBaseUrl: string) {
        // Normalize trailing slash
        this.apiBaseUrl = apiBaseUrl.replace(/\/$/, "");
    }

    /**
     * Calls:
     *   GET {apiBaseUrl}/api/apikeys/hub?apiKey=xxx
     * Returns IWorkflowHubService.
     */
    public async getHubInfo(apiKey: string): Promise<WorkflowHubService | null> {

        try {
            const url = `${this.apiBaseUrl}/api/apikeys/hub?apiKey=${encodeURIComponent(apiKey)}`;

            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "Accept": "application/json"
                }
            });

            if (!response.ok) {
                throw new Error(`Hub endpoint returned HTTP ${response.status} ${response.statusText}`);
            }

            let json: Record<string, unknown>;

            try {
                json = await response.json() as Record<string, unknown>;
            }
            catch {
                throw new Error("Hub endpoint returned non-JSON response.");
            }

            // Validate shape
            if (!json || typeof json.hubUrl !== "string") {
                throw new Error("Hub endpoint JSON missing required hubUrl property.");
            }

            // blobStorageUrl is optional in case future versions add/remove it
						const hubInfo: WorkflowHubService = {
							accountPath: json.accountPath as string,
							apiUrl: json.apiUrl as string,
							hubUrl: json.hubUrl as string,
							blobStorageUrl: (json.blobStorageUrl as string) ?? "",
							tier: (json.tier as string) ?? "Free",
							maxPayload: (json.maxPayload as number) ?? 0,
							maxConcurrentWorkflows: (json.maxConcurrentWorkflows as number) ?? 1,
							ackTimeoutSeconds: (json.ackTimeoutSeconds as number) ?? 5,
							maxRetries: (json.maxRetries as number) ?? 0,
							retryInterval: (json.retryInterval as number) ?? 0,
							useStorage: (json.useStorage as boolean) ?? false,
							maxStorageSize: (json.maxStorageSize as number) ?? 0,
							storageTtl: (json.storageTtl as number) ?? 0,
							metadata: json.metadata as string | undefined
						};

            return hubInfo;
        }
        catch {
            return null;
        }
    }
}
