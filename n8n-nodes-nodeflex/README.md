# NodeFlex
### n8n-nodes-nodeflex

This is an n8n community node package. It lets you execute remote private workflows securely in your n8n workflows using [NodeFlex](https://nodeflex.io).

NodeFlex Private Workflow enables real-time, bidirectional workflow execution across n8n instances through a SignalR-based hub. One workflow can trigger another workflow that is running remotely — passing JSON, text, or binary payloads — and optionally wait for a response.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)
[How It Works](#how-it-works)
[Nodes](#nodes)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)
[Version history](#version-history)

## Installation

### Prerequisites

- **n8n** v1.113.0 or later

### Install via the n8n Community Nodes UI (Recommended)

1. Open your n8n instance
2. Go to **Settings → Community Nodes**
3. Select **Install a community node**
4. Enter `@nodeflex/n8n-nodes-nodeflex` in the package name field
5. Agree to the risks of using community nodes
6. Click **Install**

After installation the four nodes will appear in the node panel under the search term "Private Workflow".

### Install via npm (Self-hosted)

If you self-host n8n, you can install the package directly into your n8n custom extensions directory:

```bash
cd ~/.n8n/custom
npm install @nodeflex/n8n-nodes-nodeflex
```

Then restart your n8n instance for the nodes to be loaded.

### Install via Docker

If you run n8n in Docker, add the package name to the `N8N_COMMUNITY_PACKAGES` environment variable:

```bash
docker run -it --rm \
  -e N8N_COMMUNITY_PACKAGES="@nodeflex/n8n-nodes-nodeflex" \
  -p 5678:5678 \
  n8nio/n8n
```

Or in your `docker-compose.yml`:

```yaml
environment:
  - N8N_COMMUNITY_PACKAGES=@nodeflex/n8n-nodes-nodeflex
```

### Verify Installation

Once installed, confirm the nodes are available:

1. Open any workflow in the n8n editor
2. Click the **+** button to add a node
3. Search for **"Private Workflow"**
4. You should see all four nodes: Execute Private Workflow, Private Workflow Trigger, Respond to Private Workflow, and Get Private Workflow Result

For more details, see the [n8n community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## How It Works

NodeFlex Private Workflows connects workflows on separate n8n instances, separate networks through a central hub which allows executing remote workflows from anywhere.  It is an alternative to separately configuring WebHooks and Http request nodes. The communication flow works as follows:

### API Key and message routing

Every NodeFlex account is assigned one or more **API Keys**, which you obtain from [portal.nodeflex.io](https://portal.nodeflex.io). Each API Key identifies your account and scopes all communication — only workflows with matching API Keys can exchange messages with each other through the hub.  Combined with a unique **Workflow Name**, (you can think of this combination as a "channel") you can create unique communication pairs used for workflow routing.

For each API Key, the **Workflow Name** is used to route messages between the calling workflow and the target workflow. The Workflow Name configured on the **Execute Private Workflow** node must exactly match the Workflow Name configured on the **Private Workflow Trigger** node. When the hub receives an execution request, it uses the Workflow Name to find the connected trigger that is listening under that same name and delivers the message to it.

This means you can have multiple independent workflow pairs running under the same account — each pair is isolated by its unique API Key + Workflow Name. There is no limit to the number of combinations of API Key + Workflow Names you can create. Simply configure a different Workflow Name on each **Execute Private Workflow** and **Private Workflow Trigger** pair to route requests to different target workflows.

### Sending a request

1. The **Execute Private Workflow** node is used on the calling workflow to send a payload to the NodeFlex hub to start a workflow.  This node is configured with an API Key + Workflow Name.
2. The hub routes the request to the target instance where the **Private Workflow Trigger** is connected, if connected.
3. The **Private Workflow Trigger** receives the request and starts the target workflow.

### Returning a response

1. After the target workflow completes processing, the **Respond to Private Workflow** node sends the response back the calling workflow via the hub.
2. On the calling side, the **Execute Private Workflow** node (if waiting) or the **Get Private Workflow Result** node (if polling) receives the response and the result payload.

### Summary of payload responsibilities

Payloads are routed automatically based on size. No configuration is needed — the nodes handle this transparently.

| Payload Size | Behavior | Upload Node | Download Node |
|-------------|----------|-------------|---------------|
| **≤ 64 KB** | Sent directly via SignalR to the remote workflow | — | — |
| **64 KB – 10 MB** | Uploaded to blob storage on the hub, then downloaded by the receiving node | See below | See below |
| **> 10 MB** | Not supported by the hub — must use external storage (see note below) | — | — |

For payloads between 64 KB and 10 MB that use blob storage:

| Direction | Upload | Download |
|-----------|--------|----------|
| Request (caller → target) | **Execute Private Workflow** | **Private Workflow Trigger** |
| Response (target → caller) | **Respond to Private Workflow** | **Execute Private Workflow** or **Get Private Workflow Result** |

> **Note:** Payloads larger than 10 MB are not supported by the hub. For these cases, you must store the data in your own external storage (e.g., Google Drive, Amazon S3, Azure Blob Storage) and pass a reference (such as a URL or file ID) as the payload. The receiving workflow can then retrieve the data using the appropriate n8n node for that storage service.

## Nodes

This package contains four nodes that work together:

### Execute Private Workflow

Initiates a remote private workflow execution. Sends a JSON, text, or binary payload to the NodeFlex hub, which routes it to the target workflow via SignalR.

- **Payload types:** JSON (from input or custom expression), or binary file
- **Wait for response:** Optionally block until the remote workflow completes (1–15 second timeout).  Use this only when the target workflow is known to complete quickly within the timeout window. For longer-running workflows, leave this disabled and use the **Get Private Workflow Result** node to poll for completion instead.
- **Dual output:** Returns an "Acknowledged" output immediately when the hub confirms the request. The "Completed" output is only used when **Wait for Response** is enabled, and returns the result once the remote workflow finishes.
- **Large payload support:** Payloads up to 64 KB are sent directly via SignalR. Payloads larger than 64 KB (up to 10 MB) are automatically uploaded to blob storage on the hub for the target workflow to retrieve.

### Private Workflow Trigger

This node runs on the remote workflow host and maintains a persistent connection to the NodeFlex hub (via SignalR). When an **Execute Private Workflow** node on another n8n instance sends an execution request to the hub, the hub routes that request to this trigger, which starts the target workflow.

- **Response modes:**
  - *Immediately* — Sends an acknowledgment right away
  - *Using Respond Node* — Defers the response until a "Respond to Private Workflow" node executes
- **Payload normalization:** If the incoming payload was uploaded to blob storage by the **Execute Private Workflow** node (payloads larger than 64 KB), this node automatically downloads the full payload before starting the workflow.
- **Auto-reconnect:** Maintains connection with exponential backoff.  This is useful for recovery when network outages occur.

### Respond to Private Workflow

Sends a completed workflow response along with a desired payload to the hub. This marks the workflow "Completed" on the hub so the payload can be retrieved by the **Get Private Workflow Result** node.  In normal workflow terms, this should be used when the trigger node response is set to Using '**Respond to Private Workflow**' Node.

- **Response types:** All items, first item, custom JSON, plain text, binary data, or no data
- **Correlation passthrough:** Uses the `__correlationId` from the trigger output to POST the response to the hub's completed endpoint
- **Large response support:** Response payloads up to 64 KB are sent directly via SignalR. Responses larger than 64 KB (up to 10 MB) are automatically uploaded to blob storage on the hub for the calling workflow to retrieve.

### Get Private Workflow Result

Polls the NodeFlex hub to retrieve the result of a previously initiated workflow execution. Useful when "Wait for Response" was not used or the wait timed out.

- **Dual output:** Routes results to "Completed" or "Pending" output based on execution status
- **Payload decoding:** Handles JSON, text, and base64/binary response payloads. If the response was uploaded to blob storage by the **Respond to Private Workflow** node (payloads larger than 64 KB), this node automatically downloads the full payload.

## Credentials

This package uses a single credential type:

### Private Workflow API

Used by all nodes in this package.

- **API Key** (required): Your NodeFlex API key for authentication

Obtain your API key from [portal.nodeflex.io](https://portal.nodeflex.io).

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

### 0.1.1

- Code quality improvements: removed unused code, tightened TypeScript types, extracted named constants
- Added description for text payload parameter in Execute Private Workflow node

### 0.1.0

Initial release with four nodes:
- Execute Private Workflow
- Private Workflow Trigger
- Respond to Private Workflow
- Get Private Workflow Result

## License

[MIT](LICENSE.md)
