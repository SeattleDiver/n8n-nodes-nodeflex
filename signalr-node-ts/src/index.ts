// src/index.ts
import { SignalRClient } from './SignalRClient';
import { PrivateWorkflowRequest } from './PrivateWorkflowRequest';
import { PrivateWorkflowResponse } from './PrivateWorkflowResponse';

// Configuration
// Use 127.0.0.1 instead of localhost to prevent node from defaulting to IPv6 (::1)
const HUB_URL = "http://127.0.0.1:5268/workflow"; 
const API_KEY = "AN9FMzZ4ZeHgNutVXJ9OdLYIyRha2ovIrTXJAEvjgD9nypxS";
const WORKFLOW_PATH = "mediasix/test-workflow";

async function main() {

    // var tinyClient = new TinySignalRClient(HUB_URL, API_KEY, WORKFLOW_PATH);
    // tinyClient.start();

    // 1. Initialize Client
    // We pass the path here so the generic client injects it into the WebSocket URL.
    // This allows the server's OnConnectedAsync to register the group immediately.
    const client = new SignalRClient(HUB_URL, API_KEY, WORKFLOW_PATH);

    // --- HELPER: Registration Logic (Used for Initial Start AND Reconnects) ---
    const registerToHub = async () => {
        try {
            const registrationPayload = {
                apiKey: API_KEY,
                path: WORKFLOW_PATH,
            };
            await client.send("RegisterPrivateWorkflow", registrationPayload);
            console.log(`[REGISTRY] Registered for path: ${WORKFLOW_PATH}`);
        } catch (err) {
            console.error("[REGISTRY] Registration failed:", err);
        }
    };

    // 2. Setup Listeners
    client.on("ExecutePrivateWorkflow", async (request: PrivateWorkflowRequest) => {
        console.log(`[RECEIVED] Request ID: ${request.requestId}`);
        
        // --- Business Logic Start ---
        // Simulate processing time
        // await new Promise(r => setTimeout(r, 500)); 
        
        const processingResult = {
            status: "success",
            data: "Processed by Node.js Client",
            timestamp: new Date().toISOString()
        };
        // --- Business Logic End ---

        // 3. Construct Response
        // Use strict camelCase properties to match PrivateWorkflowResponse interface
        // and standard SignalR JSON serialization.
        const resultString = JSON.stringify(processingResult)
        const response: PrivateWorkflowResponse = {
            requestId: request.requestId || "", // Handle potential undefined
            path: request.path || "",
            payload: {
                type: 'inline',
                value: resultString,
                length: resultString.length,
                isEncrypted: true
            }
        };
        console.log("response:" + JSON.stringify(response));

        try {
            console.log("Sending completion response...");
            await client.send("CompletePrivateWorkflow", response);
            console.log("Response delivered.");
        } catch (err) {
            console.error("Failed to send response:", err);
        }

        // B. Handle Reconnection (The New Addition)
        // This callback runs automatically when the connection drops and is restored.
        // client.onReconnected(async (newConnectionId) => {
        //     console.warn(`[LIFECYCLE] Connection restored! New ID: ${newConnectionId}`);
        //     // We must re-register because the server likely cleaned up our mapping during the disconnect
        //     await registerToHub();
        // });
    });

    // 3. Connect with Startup Retry Logic
    // client.start() throws if the initial connection fails. We loop until it succeeds.
    console.log("Starting client...");
    
    while (true) {
        try {
            await client.start();
            console.log("Connected to Hub.");

            await registerToHub();

            console.log("Listening for messages. Press Ctrl+C to exit.");
            break; // Exit loop on success

        } catch (err) {
            console.error("Connection failed. Retrying in 5 seconds...");
            // Cast error to access message safely
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Error details: ${msg}`);
            
            // Wait 5 seconds before retrying
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }

    // Register the handler BEFORE starting
    client.onReconnected(async (newConnectionId) => {
        console.log(`Connection restored! New ID: ${newConnectionId}`);
        
        try {
            // Re-register your workflow or identity
            const registrationPayload = {
                apiKey: API_KEY,
                path: WORKFLOW_PATH,
            };
            await client.send("RegisterPrivateWorkflow", registrationPayload);
            console.log("Workflow re-registered successfully");
        } catch (err) {
            console.error("Failed to re-register workflow after reconnect", err);
        }
    });
    
}

main();