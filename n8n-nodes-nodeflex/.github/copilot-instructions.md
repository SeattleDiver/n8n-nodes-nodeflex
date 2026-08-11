# NodeFlex n8n-nodes-nodeflex — Copilot Instructions

## Commands

```bash
# from n8n-nodes-nodeflex/
npm run build        # compile TypeScript → dist/
npm run build:watch  # tsc --watch (incremental, no linting)
npm run dev          # n8n-node dev (hot-reload during development)
npm run lint         # eslint via @n8n/node-cli (must pass before publish)
npm run lintfix      # lint --fix (auto-corrects fixable issues)
npm run format       # prettier on nodes/ and credentials/
```

There is no test suite. The build output goes to `dist/` (listed in `package.json` `"files"`). Only `dist/` is published to npm.

Publishing is done via GitHub Actions (`publish.yml`) triggered by a version tag (e.g., `0.2.0`). The workflow runs `npm run build`, `npm run lint`, then `npm publish --provenance --access public`.

---

## Architecture

This package provides **four n8n nodes** that work together to execute workflows across separate n8n instances via a central SignalR hub (hosted at `https://hub.nodeflex.io`):

| Node | Class | n8n Interface |
|------|-------|---------------|
| Execute Private Workflow | `ExecutePrivateWorkflow` | `INodeType` (regular node) |
| Private Workflow Trigger | `PrivateWorkflowTrigger` | `INodeType` (trigger node) |
| Respond to Private Workflow | `RespondToPrivateWorkflow` | `INodeType` (regular node) |
| Get Private Workflow Result | `GetPrivateWorkflowResult` | `INodeType` (regular node) |

```
n8n Instance A                    NodeFlex Hub                  n8n Instance B
ExecutePrivateWorkflow  ──POST──▶  /api/{account}/{name}  ──SignalR──▶  PrivateWorkflowTrigger
                        ◀──ACK──   (correlationId)                       │
GetPrivateWorkflowResult ◀─poll─  /api/result/{correlationId}  ◀─POST──  RespondToPrivateWorkflow
```

### `lib/` — Shared services

All business logic lives in `lib/`. These classes are **not** listed in `tsconfig.json`'s `include` but are compiled transitively (nodes import them).

| File | Purpose |
|------|---------|
| `HubConfig.ts` | Single source of truth for `HUB_BASE_URL` and `HUB_VERIFY_URL` |
| `HubProfileService.ts` | Fetches hub routing info (`WorkflowHubService`) from `/api/apikeys/hub` |
| `WorkflowHubService.ts` | Typed shape returned by `HubProfileService.getHubInfo()` |
| `SignalRClient.ts` | Zero-dependency custom SignalR WebSocket client |
| `SignalRPrivateWorkflowClient.ts` | Wraps `SignalRClient`; handles register/ACK/execute/respond hub messages |
| `PrivateWorkflowHttpClient.ts` | Thin HTTP POST wrapper (used by `ExecutePrivateWorkflow`) |
| `WorkflowPayloadBlobTransport.ts` | Upload/download payloads to blob storage (payloads 64 KB – 10 MB) |
| `PrivateWorkflowResponseHydrator.ts` | Decodes hub responses into `INodeExecutionData[]` |
| `PrivateWorkflowPayload.ts` | Discriminated union type for all payload transport |
| `N8nHttpHelper.ts` | `IN8nHttpHelper` interface — how lib classes accept HTTP without coupling to n8n context |

---

## Key Conventions

### `IN8nHttpHelper` — loose coupling to n8n runtime

Lib classes never accept `IExecuteFunctions` or `ITriggerFunctions` directly. They receive `IN8nHttpHelper`:

```typescript
// In a node file:
const http: IN8nHttpHelper = { httpRequest: this.helpers.httpRequest.bind(this.helpers) };
const hubService = new HubProfileService(hubBase, http);
```

This keeps `lib/` classes independently testable and decoupled from the n8n execution context.

### `HubConfig.ts` — environment flag

`HUB_BASE_URL` in `lib/HubConfig.ts` is currently set to `https://localhost:7093` for local development against a self-hosted hub. Before releasing, switch it to the production URL:

```typescript
// Development (current)
export const HUB_BASE_URL = 'https://localhost:7093';

// Production (uncomment before publishing)
// export const HUB_BASE_URL = 'https://hub.nodeflex.io';
```

The `HubProfileService` also has `skipSslCertificateValidation: false` — leave it `false` in production.

### `PrivateWorkflowPayload` — discriminated union

All payloads between nodes and the hub use this shape. The `type` field drives transport; `encoding` drives deserialization:

```typescript
type PrivateWorkflowPayloadType = 'inline' | 'reference';
type PrivateWorkflowPayloadEncoding = 'json' | 'base64' | 'text';

interface PrivateWorkflowPayload {
  type: PrivateWorkflowPayloadType;  // 'inline' = value is the payload; 'reference' = value is a URL
  value: string;
  length: number;
  isEncrypted: boolean;
  encoding: PrivateWorkflowPayloadEncoding;
}
```

Payloads ≤ 64 KB → `inline` transport via SignalR.  
Payloads 64 KB – 10 MB → `reference` transport via `WorkflowPayloadBlobTransport`.

### Hub profile is fetched per-execution

`ExecutePrivateWorkflow` calls `HubProfileService.getHubInfo(apiKey)` on every execution to retrieve the current hub routing URLs (`hubUrl`, `apiUrl`, `blobStorageUrl`, `accountPath`, tier limits, etc.). This means hub configuration is dynamic — never cache the hub URL across executions.

### Correlation ID flow

`__correlationId` is injected into the trigger output JSON and must be passed through to `RespondToPrivateWorkflow` via expression `{{ $json.__correlationId }}`. The `GetPrivateWorkflowResult` node polls using the `correlationId` from the `ExecutePrivateWorkflow` "Acknowledged" output.

### Trigger reconnect strategy

`PrivateWorkflowTrigger` uses a two-tier reconnect loop:
1. **`SignalRClient` / `HubConnection`** handles brief network blips with a 5-minute retry budget and exponential backoff.
2. **Trigger-level loop** catches `onConnectionLost` events, re-fetches `HubProfileService.getHubInfo()`, and restarts the full `SignalRPrivateWorkflowClient` with an 8-hour budget.

After every reconnect, `RegisterPrivateWorkflow` must be re-invoked on the hub — `SignalRPrivateWorkflowClient.wireHandlers()` does this automatically in its `onreconnected` handler.

### Node output conventions

- `ExecutePrivateWorkflow` → two outputs: `[0] Acknowledged`, `[1] Completed` (populated only when `waitForResponse: true` and status is `'Completed'`)
- `GetPrivateWorkflowResult` → two outputs: `[0] Completed`, `[1] Pending`
- `PrivateWorkflowResponseHydrator.hydrate()` handles all response-to-`INodeExecutionData` conversion; always use it rather than decoding inline.

### Codex files

Each node directory contains a `[NodeName].node.json` codex file. The `"node"` key must exactly match the camelCase `name` in the `.node.ts` descriptor, and `"nodeVersion"` must match `version`. Bump both in sync when adding a new node version.

### `tsconfig.json` notes

- `"useUnknownInCatchVariables": false` — catch variables are implicitly `any` (not `unknown`). Narrow manually when touching error handling.
- `"noUnusedLocals": true` — unused imports/variables are compile errors, not just warnings.
- `target: "es2019"` — avoid ES2020+ features (`??=`, `||=`, etc.) without checking browser/Node compatibility.

---

## n8n Node Standards (quick reference)

- `displayName`: Title Case. `name`: camelCase. Descriptions: capital start, **no trailing period**.
- Boolean params must be phrased positively ("Wait for Response", not "Skip Response").
- First option in any `options` array is the default.
- Use `displayOptions.show` to hide irrelevant fields.
- Wrap all `execute`/`trigger` logic in `try/catch`; throw `NodeOperationError(this.getNode(), msg, { itemIndex: i })`.
- Check `this.continueOnFail()` and push error items rather than hard-throwing when appropriate.
- No external HTTP dependencies — use `this.helpers.httpRequest` (wrapped via `IN8nHttpHelper`).

--- 

# SKILL: Principal TypeScript Engineer & Code Reviewer
**Trigger:** Activate these rules when the user explicitly asks to "review", "refactor", "optimize", or asks for "expert feedback" on TypeScript code.

When acting as the Principal TypeScript Engineer, your goal is to elevate working code into enterprise-grade, expert-level TypeScript. You must apply these advanced principles **without violating the n8n custom node standards defined above**.

## 1. Advanced Type Safety & Soundness
- **Eradicate `any`:** Flag any use of `any` and replace it with `unknown`, utilizing custom Type Guards or `zod`/schema validation to narrow the type safely.
- **Discriminated Unions:** Refactor complex boolean flags (e.g., `isSuccess`, `isFailed`) into strict Discriminated Unions to make illegal states unrepresentable.
- **Exhaustive Checking:** Where `switch` statements or `if/else` chains handle literal types or enums, enforce exhaustive checks using the `never` type.
- **Utility Types:** Reduce type duplication using `Pick<>`, `Omit<>`, `Record<>`, `ReturnType<>`, and the `satisfies` operator.

## 2. Execution Efficiency & Performance
- **Concurrency Optimization:** Identify sequential `await` calls that do not depend on each other and suggest `Promise.all()` or `Promise.allSettled()`. 
- **Memory Management:** Flag unnecessary object cloning and large intermediate array allocations (e.g., chaining `.map().filter()`). Suggest memory-efficient alternatives like standard `for...of` loops or `reduce`.
- **Data Structures:** Suggest `Map` instead of `Object` for frequent key-value additions/deletions. Suggest `Set` for deduplication and fast `O(1)` lookups instead of `Array.includes()`.

## 3. Architecture & Maintainability
- **Separation of Concerns:** Identify massive functions (especially n8n `execute` methods) and suggest extracting complex business logic or data transformations into pure, testable helper functions.
- **Cyclomatic Complexity:** Refactor deeply nested `if/else` statements using early returns (Guard Clauses) to keep the "happy path" un-indented at the bottom.
- **Immutability:** Encourage treating data as immutable. Flag the mutation of function arguments.

## 4. Modern ECMAScript/TypeScript Features
- Suggest Nullish Coalescing (`??`) instead of logical OR (`||`) to prevent `0` or `""` bugs.
- Enforce Optional Chaining (`?.`) to prevent undefined property errors.
- Suggest `structuredClone()` for deep copying instead of `JSON.parse(JSON.stringify())`.

## 5. Resilient Error Handling
- Reject generic `catch (error)` blocks that throw generic `Error` objects.
- Ensure the `error` in a catch block is typed as `unknown` and properly narrowed (`if (error instanceof Error)`).
- *Integration Note:* Always ensure errors are ultimately wrapped in n8n's `NodeOperationError` as required by the n8n guidelines.

## Output Format
When executing this skill, format your response as follows:
1. **High-Level Critique:** A 1-2 sentence summary of the code's current state.
2. **Critical Refactors:** Severe vulnerabilities, memory leaks, or type bypasses that *must* be fixed.
3. **Expert Suggestions:** Provide a **Before** and **After** code block for your major suggestions.
4. **The "Why":** Briefly explain the underlying computer science, big-O complexity, or TS compiler reason for your suggestion.