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
            console.log("Hub Info Fetch URL:", url);

            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "Accept": "application/json"
                }
            });

            if (!response.ok) {
                throw new Error(`Hub endpoint returned HTTP ${response.status} ${response.statusText}`);
            }

            let json: any;

            try {
                json = await response.json();
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
							// Endpoints
							apiUrl: json.apiUrl,
							hubUrl: json.hubUrl,
							blobStorageUrl: json.blobStorageUrl ?? "",

							// Tier / Limits
							tier: json.tier ?? "Free",
							maxPayload: json.maxPayload ?? 0,
							maxConcurrentWorkflows: json.maxConcurrentWorkflows ?? 1,
							ackTimeoutSeconds: json.ackTimeoutSeconds ?? 5,
							maxRetries: json.maxRetries ?? 0,
							retryInterval: json.retryInterval ?? 0,

							// Storage
							useStorage: json.useStorage ?? false,
							maxStorageSize: json.maxStorageSize ?? 0,
							storageTtl: json.storageTtl ?? 0,

							// Metadata
							metadata: json.metadata
						};

            return hubInfo;
        }
        catch (err) {
            console.error("Error retrieving hub info:", err);
            return null;
        }
    }
}
