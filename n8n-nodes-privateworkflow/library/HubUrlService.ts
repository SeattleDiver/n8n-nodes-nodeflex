export class HubUrlService {

    private readonly apiBaseUrl: string;

    constructor(apiBaseUrl: string) {
        // Example: "https://localhost:7093"
        this.apiBaseUrl = apiBaseUrl.replace(/\/$/, ""); // remove trailing slash
    }

    /**
     * Retrieves the hubUrl from:
     *   GET {apiBaseUrl}/api/apikeys/hub?apiKey=xxx
     */
    public async getHubUrl(apiKey: string): Promise<string> {

        const url = `${this.apiBaseUrl}/api/apikeys/hub?apiKey=${encodeURIComponent(apiKey)}`;
				console.log('hub redirect url: ', url);
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to retrieve hubUrl. HTTP ${response.status} ${response.statusText}`);
        }

        let json: any;
        try {
            json = await response.json();
        }
        catch {
            throw new Error("Hub endpoint returned non-JSON response.");
        }

        const hubUrl = json?.hubUrl;
        if (typeof hubUrl !== "string" || hubUrl.length === 0) {
            throw new Error("Hub endpoint did not return a valid hubUrl.");
        }

        return hubUrl;
    }
}
