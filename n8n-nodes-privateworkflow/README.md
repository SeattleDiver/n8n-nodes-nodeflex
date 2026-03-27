# n8n-nodes-privateworkflow

This is an n8n community node package. It lets you execute remote private workflows securely in your n8n workflows using [NodeFlex](https://nodeflex.io).

NodeFlex Private Workflow enables real-time, bidirectional workflow execution across n8n instances through a SignalR-based hub. One workflow can trigger another remotely — passing JSON, text, or binary payloads — and optionally wait for a response.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)
[Nodes](#nodes)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Nodes

This package contains four nodes that work together:

### Execute Private Workflow

Initiates a remote private workflow execution. Sends a JSON, text, or binary payload to the NodeFlex hub, which routes it to the target workflow via SignalR.

- **Payload types:** JSON (from input or custom expression), or binary file
- **Wait for response:** Optionally block until the remote workflow completes (1–15 second timeout)
- **Dual output:** Returns an "Acknowledged" output immediately and a "Completed" output when the workflow finishes
- **Large payload support:** Automatically routes payloads above the hub size limit through blob storage

### Private Workflow Trigger

A trigger node that listens for incoming workflow execution requests via a persistent SignalR WebSocket connection to the NodeFlex hub.

- **Response modes:**
  - *Immediately* — Sends an acknowledgment right away
  - *Using Respond Node* — Defers the response until a "Respond to Private Workflow" node executes
- **Payload normalization:** Automatically downloads referenced payloads from blob storage when needed
- **Auto-reconnect:** Maintains connection with exponential backoff

### Respond to Private Workflow

Sends a deferred response back to the calling workflow through the SignalR connection. Used when the trigger is set to "Using Respond Node" mode.

- **Response types:** All items, first item, custom JSON, plain text, binary data, or no data
- **Correlation tracking:** Uses the `__correlationId` from the trigger to route the response to the correct caller
- **Large response support:** Automatically routes large responses through blob storage

### Get Private Workflow Result

Polls the NodeFlex hub to retrieve the result of a previously initiated workflow execution. Useful when "Wait for Response" was not used or the wait timed out.

- **Dual output:** Routes results to "Completed" or "Pending" output based on execution status
- **Payload decoding:** Handles JSON, text, and base64/binary response payloads

## Credentials

This package uses two credential types:

### Private Workflow Public Key API

Used by the **Execute Private Workflow** and **Get Private Workflow Result** nodes (the calling side).

- **API Key** (required): Your NodeFlex API key for authentication
- **Public Key** (optional): For encrypting payloads in transit

### Private Workflow Private Key API

Used by the **Private Workflow Trigger** node (the receiving side).

- **API Key** (required): Your NodeFlex API key for authentication
- **Private Key** (optional): For decrypting payloads received in transit

Obtain your API keys from [nodeflex.io](https://nodeflex.io).

## Compatibility

- **Minimum n8n version:** Tested with n8n v1.113.0+
- **Node.js:** Requires Node.js 20.15 or later
- **No external dependencies:** Uses a custom zero-dependency SignalR client implementation

## Usage

### Basic workflow: Fire and forget

1. Add **Execute Private Workflow** to your calling workflow
2. Set the **Workflow Name** to match the target workflow's registered path
3. Set **Wait for Response** to false
4. Add **Private Workflow Trigger** in a separate workflow with the same workflow name
5. Set the trigger's response mode to **Immediately**

### Workflow with response

1. Add **Execute Private Workflow** with **Wait for Response** enabled
2. In the target workflow, set the trigger response mode to **Using Respond Node**
3. Add your processing nodes after the trigger
4. End with **Respond to Private Workflow**, setting the correlation ID to `{{ $json.__correlationId }}`

### Polling for results

If the wait times out or you prefer asynchronous checking:

1. Use **Execute Private Workflow** to start the remote workflow
2. Capture the `correlationId` from the "Acknowledged" output
3. Use **Get Private Workflow Result** with that correlation ID to check status later

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [NodeFlex](https://nodeflex.io) — Private workflow hub service

## Version history

### 0.1.0

Initial release with four nodes:
- Execute Private Workflow
- Private Workflow Trigger
- Respond to Private Workflow
- Get Private Workflow Result

## License

[MIT](LICENSE.md)
