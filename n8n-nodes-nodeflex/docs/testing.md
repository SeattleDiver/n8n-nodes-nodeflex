# NodeFlex Node Testing Guide

This document defines the full test suite for the four nodes in this package:

1. [Private Workflow Trigger](#1-private-workflow-trigger)
2. [Execute Private Workflow](#2-execute-private-workflow)
3. [Respond to Private Workflow](#3-respond-to-private-workflow)
4. [Get Private Workflow Result](#4-get-private-workflow-result)

Each test case lists exact node parameter values, exact input data, and an exact expected result, so the case can be executed by a human tester or driven by an automation script/agent without needing to re-derive intent from the source code.

---

## 0. Test Environment Setup

### 0.1 Prerequisites

- A NodeFlex API key dedicated to testing (do **not** reuse a production key — see [0.4](#04-hub-dependency--test-isolation)). Obtain one at [portal.nodeflex.io](https://portal.nodeflex.io).
- A local n8n instance running this package:
  ```bash
  npm run dev
  ```
  This starts n8n at `http://localhost:5678` with the four nodes loaded.
- The n8n public REST API enabled (**Settings → n8n API → Create an API key**), for automated assertions against execution results.

### 0.2 Credential setup

Create one **Private Workflow Credentials API** credential named `nodeflex-test` with the test API key. All test workflows in this guide reference that credential.

### 0.3 Workflow pairing convention

Every test case that spans a request/response pair (Execute ↔ Trigger, or Trigger/Respond ↔ Get Result) uses a **Workflow Name** of the form:

```
test-<node-under-test>-<test-id>
```

e.g. `test-execute-EW-04`. This namespaces each test case to its own hub "channel" so concurrent test runs never cross-talk (see [How It Works → API Key and message routing](../README.md#api-key-and-message-routing)).

> **Confirmed against the live hub:** Workflow Names must be a single flat segment — the hub's execute-request routing 404s on a multi-segment name containing `/` (e.g. `test/execute/EW-04` fails; `test-execute-EW-04` works). Use hyphens, not slashes, for namespacing.

### 0.4 Hub dependency & test isolation

`HUB_BASE_URL` (`lib/HubConfig.ts:5`) is hardcoded to the production hub (`https://hub.nodeflex.io`) — it is not currently configurable via environment variable. This means:

- Every test case in sections 1–4 that exercises hub communication is an **integration test against the real NodeFlex hub**, using the dedicated test API key from [0.1](#01-prerequisites).
- Tests are isolated from each other (and from real traffic) by the per-test-case Workflow Name convention above, not by network isolation.
- Purely local logic — payload validation, JSON/text/base64 decoding, error mapping — can be tested without the hub at all. These cases are marked **Unit** in the "Type" column; everything else is marked **Integration**.

**Status: the Unit-tagged cases are implemented and automated.** Run them with:

```bash
npm run test        # one-shot run
npm run test:watch  # watch mode while iterating
```

The suite uses [Vitest](https://vitest.dev) and lives alongside the source:

| File | Covers |
|---|---|
| `lib/PrivateWorkflowResponseHydrator.test.ts` | The full encoding matrix (section 5) — pure function, no mocking |
| `nodes/ExecutePrivateWorkflow/ExecutePrivateWorkflow.node.test.ts` | EW-04, EW-05, EW-06, EW-08, EW-10, EW-16, EW-19, EW-24, EW-25, EW-26 |
| `nodes/RespondToPrivateWorkflow/RespondToPrivateWorkflow.node.test.ts` | RW-02, RW-04, RW-05, RW-06, RW-10, RW-11, RW-12, RW-16, RW-18 |
| `nodes/GetPrivateWorkflowResult/GetPrivateWorkflowResult.node.test.ts` | GR-05, GR-06, GR-13, GR-14 |
| `nodes/PrivateWorkflowTrigger/PrivateWorkflowTrigger.node.test.ts` | PWT-07, PWT-08, PWT-12 |

Each node test calls `.execute`/`.trigger` directly against a hand-built fake `IExecuteFunctions`/`ITriggerFunctions` context (`tests/helpers/mockExecuteFunctions.ts`) — no real n8n instance and no real hub involved. The trigger test additionally uses Vitest's `vi.mock` to replace `SignalRPrivateWorkflowClient` with a fake that captures its config object, so the per-message validation logic (array-payload rejection, correlationId requirement, manual-run override) can be exercised without a live SignalR connection.

Test files are excluded from the published package and from the production TypeScript build (`tsconfig.json` `exclude`), so they add zero size/risk to what ships to npm.

**Live-hub integration testing is also implemented**, and it turns out to cover more than originally assumed — the `lib/*.ts` classes only depend on the small `IN8nHttpHelper` interface, not on n8n itself, and a node's `.execute`/`.trigger` method doesn't care whether `this` came from real n8n. So the *same* `createMockContext` trick from Tier 1 works here too — just with a real HTTP client and a real API key swapped in instead of fakes. That means the full Execute → Trigger → Respond → GetResult round trip is testable without a live n8n editor after all, contrary to what this section originally said.

- `tests/integration/hubConnectivity.test.ts` — verifies a real API key against the hub, fetches real hub info via `HubProfileService`, and confirms an invalid key is rejected.
- `tests/integration/executeTriggerRespondGetResult.test.ts` — the canonical full round trip: a JSON payload through all four nodes' real production code, via `tests/integration/helpers/roundTrip.ts` (shared setup/teardown for every test below).
- `tests/integration/executeTriggerDataTypes.test.ts` — Execute → Trigger data-type coverage: small binary inline (passing); large JSON and large binary via blob storage (currently `it.skip` — see the blob-storage finding below).
- `tests/integration/respondModes.test.ts` — all 6 `RespondToPrivateWorkflow` modes (allItems, firstItem, json-object, json-array, text, binary, none) round-tripped through a real `GetPrivateWorkflowResult` read-back.
- `tests/integration/getResultStatusRouting.test.ts` — confirms status routing before/after a response, including the GR-03 nuance (routing a non-Completed status to the "Completed" output via `continueOn` yields only `{ status, correlationId }`, never the hydrated payload).

**Two real bugs were found and fixed while building this out — not test-code mistakes, actual product issues:**

1. **`RespondToPrivateWorkflow`'s "No Data" mode produced an unreadable response.** `respondWith: 'none'` sent an empty string as a `json`-encoded payload; reading it back via `GetPrivateWorkflowResult` (or Execute's Completed output) threw `Invalid JSON payload`, since `JSON.parse('')` fails. Fixed in `RespondToPrivateWorkflow.node.ts` — a null payload with `json` encoding now serializes to `'{}'` instead of `''`. (This is exactly the kind of thing the `GetPrivateWorkflowResult.node.ts` try/catch fix from earlier in this test effort was meant to surface cleanly as a `NodeOperationError` rather than a raw crash — which it did.)
2. **This account's blob storage endpoint doesn't exist.** `HubProfileService.getHubInfo()` returns `blobStorageUrl: https://storagewestus.blob.core.windows.net/...`, which is `NXDOMAIN` — confirmed via direct `nslookup` that `hub.nodeflex.io` and `blob.core.windows.net` (the parent domain) both resolve fine, so this isn't a local network issue. Payloads that exceed the account's `maxPayload` and need blob storage (large JSON/binary) cannot currently be tested end-to-end. The two affected cases are `it.skip`-marked with this explanation rather than deleted, so they're easy to re-enable once the account's storage endpoint is fixed.

Also confirmed while building this: the hub throttles rapid repeated polling of the same `correlationId` (HTTP 429) — `getResultStatusRouting.test.ts` spaces its successive `GetPrivateWorkflowResult` calls using n8n-workflow's own `sleep` helper to stay under that.

**Handing over a test API key without it ever being pasted into a chat, logged, or committed:**

1. Create `.env.test.local` in the project root (already gitignored) containing:
   ```
   NODEFLEX_TEST_API_KEY=your-key-here
   ```
2. Run:
   ```bash
   npm run test:integration
   ```
   `scripts/run-integration-tests.mjs` is the only code that reads that file — it parses it, merges the value into a child process's environment, and hands off to `vitest.integration.config.mts` (a separate config from the default suite, so `npm run test` never touches these files or requires a key). Nothing here logs the key value; assertions only check response shape/status, never full response bodies.
3. If no `.env.test.local` exists, `npm run test:integration` fails immediately with instructions instead of silently skipping.

Each live test run registers a real, uniquely-named test workflow path with the hub for its duration and tears it down afterward (`closeFunction()` in the trigger case) — so running this suite produces real, visible activity on the account, scoped to `test-*` workflow names.

### 0.5 Test fixtures

Reusable inputs referenced by ID throughout the test tables below:

| Fixture ID | Description | Value |
|---|---|---|
| `FIX-JSON-SMALL` | Small JSON object, well under the hub's `maxPayload` inline limit | `{ "orderId": "A-1001", "amount": 42.5 }` |
| `FIX-JSON-ARRAY` | JSON array of objects | `[{ "id": 1 }, { "id": 2 }, { "id": 3 }]` |
| `FIX-JSON-LARGE` | JSON object whose serialized size exceeds the account's `maxPayload` (check the value returned by `getHubInfo`; a `~200KB` string field reliably exceeds free/standard tiers) | `{ "blob": "<200KB of repeated text>" }` |
| `FIX-TEXT` | Plain text string | `Hello from the test suite` |
| `FIX-BINARY-SMALL` | Small binary file, base64-encoded, under the inline limit | Any small PNG/TXT, e.g. a 1×1 pixel PNG |
| `FIX-BINARY-LARGE` | Binary file whose base64 size exceeds `maxPayload` | Any file `>~200KB` |
| `FIX-JSON-INVALID` | Malformed JSON string | `{ "orderId": "A-1001", ` (truncated/invalid) |

---

## 1. Private Workflow Trigger

`nodes/PrivateWorkflowTrigger/PrivateWorkflowTrigger.node.ts`

| ID | Type | Test | Setup / Parameters | Input | Steps | Expected Result | Automated Assertion |
|---|---|---|---|---|---|---|---|
| PWT-01 | Integration | Successful activation & hub registration | Workflow Name = `test-trigger-PWT-01`, Respond = Immediately, valid credential | — | Activate the workflow | Node activates with no error; trigger log shows "Ready for ExecutePrivateWorkflow messages" | `GET /api/v1/workflows/{id}` → `active: true`; no execution error logged |
| PWT-02 | Integration | Activation fails — missing/invalid API key | Credential with `apiKey` cleared | — | Attempt activation | Activation throws `NodeOperationError`: "API key is missing. Add it in the node credentials." | Activation request returns error containing that message |
| PWT-03 | Integration | Activation fails — hub unreachable | Credential with a syntactically valid but non-existent API key | — | Attempt activation | Throws `NodeApiError`: "Hub URL is unavailable. Hub service is down." (or equivalent hub-rejection error) | Activation error message matches, error is a `NodeApiError` |
| PWT-04 | Integration | Manual run — receives one message, "Immediately" respond mode | Workflow Name = `test-trigger-PWT-04`, Respond = Immediately, Respond With Status = Completed | Trigger via a matching **Execute Private Workflow** node sending `FIX-JSON-SMALL` | Start manual execution on the trigger; execute the paired Execute node | Trigger emits one item with `json` = `FIX-JSON-SMALL` plus `__correlationId`; manual run completes (does not hang past 60s) | Execution output item 0 `json.orderId === "A-1001"`; `json.__correlationId` is a non-empty string |
| PWT-05 | Unit/Integration | Reference (blob) payload is downloaded and normalized before emit | Workflow Name = `test-trigger-PWT-05` | Paired Execute node sends `FIX-JSON-LARGE` (forces blob upload since it exceeds `maxPayload`) | Manual run trigger, execute paired Execute node | Trigger's emitted item contains the **full** decoded JSON (not a blob reference) | Output item's `json.blob` field length matches the original fixture length |
| PWT-06 | Unit/Integration | Inline binary payload emits as `binary.file` | Paired Execute node sends `FIX-BINARY-SMALL` as Binary File payload type | Manual run | Emitted item has `binary.file.data` equal to the original base64, `mimeType: application/octet-stream`, `fileName: 'data'` | `binary.file.data` matches source fixture base64 exactly (no re-encoding) |
| PWT-07 | Unit | Array payload is rejected | Paired Execute node sends `FIX-JSON-ARRAY` as custom JSON (Execute node must be configured to send a raw array string) | Manual run | Throws (caught internally, logged): "Private Workflow Trigger does not accept array payloads. Arrays must be wrapped in the Execute Private Workflow node." | `onExecute` catch path returns `{ ok: false, error }`; no item is emitted |
| PWT-08 | Unit | Missing correlationId is rejected | Simulate a hub message with `correlationId` empty (requires hub-side test harness or mocked `onExecute` call) | — | Throws `NodeOperationError`: "CorrelationId is required!" | Error message matches |
| PWT-09 | Integration | Respond mode "Immediately", status = Completed | Respond = Immediately, Respond With Status = Completed | Execute node sends `FIX-JSON-SMALL`, Wait for Response = true | Execute the pair | Execute node's "Completed" output does **not** populate (hub cache cleared immediately on "Completed"); "Acknowledged" output populates | Execute node output 0 (Acknowledged) present; output 1 (Completed) empty array |
| PWT-10 | Integration | Respond mode "Immediately", status = Running | Respond = Immediately, Respond With Status = Running | Execute node sends `FIX-JSON-SMALL`, Wait for Response = true, Wait Timeout = 15 | Execute the pair | Hub cache holds "Running" until timeout; Execute node's Completed output does not resolve within the wait window | Execute node output 1 (Completed) is empty; no error |
| PWT-11 | Integration | Respond mode "Using Respond to Private Workflow Node" | Respond = `respondToPrivateWorkflow` | Trigger → downstream nodes → **Respond to Private Workflow** node in the same workflow | Execute the paired Execute node (Wait for Response = true) | Trigger does not auto-respond; the **Respond to Private Workflow** node's POST is what completes the hub request; Execute node's Completed output receives that payload | Execute node output 1 (Completed) `json` matches what the Respond node sent |
| PWT-12 | Unit | Manual run forces "Immediately" regardless of configured respond mode | Respond = `respondToPrivateWorkflow`, run manually (`isManual = true`) | Execute node sends `FIX-JSON-SMALL` | Manual test-run the trigger | Log shows "Overriding respondMode to 'immediately' for test run."; an immediate ack POST is sent | Manual execution completes without waiting for a downstream Respond node |
| PWT-13 | Integration | Immediate-response HTTP failure does not fail the node | Point the credential at a key whose account's `completed` endpoint is temporarily failing (or simulate via network block) | Execute node sends `FIX-JSON-SMALL` | Manual run | Warning logged: "Failed to send immediate response"; node does not throw, workflow continues | Execution status = success despite the logged warning |
| PWT-14 | Integration | Deactivation cleanly stops the SignalR client | Workflow active from PWT-01 | — | Deactivate the workflow | `closeFunction` runs; log shows "SignalR client stopped."; no dangling connection | Deactivation request returns success; hub shows no lingering registration for the test path |

---

## 2. Execute Private Workflow

`nodes/ExecutePrivateWorkflow/ExecutePrivateWorkflow.node.ts`

Paired with a **Private Workflow Trigger** on Workflow Name `test-execute-<id>` unless noted.

| ID | Type | Test | Parameters | Input Item(s) | Expected Result | Automated Assertion |
|---|---|---|---|---|---|---|
| EW-01 | Integration | JSON payload from Input | Payload = JSON, JSON Source = Input JSON | 1 item, `json` = `FIX-JSON-SMALL` | Ack output has `correlationId`, `path`, `status`; hub receives `FIX-JSON-SMALL` inline (`payload.type: 'inline'`, `encoding: 'json'`) | Output 0 `json.status` is a non-empty string; `json.correlationId` matches UUID format |
| EW-02 | Integration | JSON payload from Custom (string) | Payload = JSON, JSON Source = Custom, JSON = `{{ JSON.stringify($json) }}` evaluating to `FIX-JSON-SMALL` | 1 item | Same as EW-01 | Same assertions as EW-01 |
| EW-03 | Integration | JSON payload from Custom (object via expression) | JSON Source = Custom, JSON = `={{ $json }}` (resolves to an object, not a string) | 1 item, `json` = `FIX-JSON-SMALL` | Payload sent equals the deep-cloned object | Ack output present, no error |
| EW-04 | Unit | Custom JSON — invalid JSON string | JSON Source = Custom, JSON = `FIX-JSON-INVALID` | 1 item | Throws `NodeOperationError`: "Invalid JSON in JSON field." | Execution fails with that message |
| EW-05 | Unit | Custom JSON — empty/undefined | JSON Source = Custom, JSON = `` (empty) | 1 item | Throws `NodeOperationError`: "JSON is required when JSON Source is custom." | Execution fails with that message |
| EW-06 | Unit | Custom JSON — resolves to non-object (e.g. a number) | JSON Source = Custom, JSON = `={{ 42 }}` | 1 item | Throws `NodeOperationError`: "JSON field must be a JSON object or a JSON string that parses to an object." | Execution fails with that message |
| EW-07 | Integration | Binary payload — by name, default property | Payload = Binary File, Binary Selection = By Property Name, Binary Property = `file` | 1 item with `binary.file` = `FIX-BINARY-SMALL` | Payload sent as base64, `encoding: 'base64'`; ack output present | Ack output present, no error |
| EW-08 | Unit | Binary payload — named property not found | Binary Selection = By Property Name, Binary Property = `nope` | 1 item with `binary.file` only | Throws `NodeOperationError`: `Binary property "nope" was not found on the incoming item.` | Execution fails with that message |
| EW-09 | Integration | Binary payload — "first binary property" mode | Binary Selection = First Binary Property | 1 item with `binary.anyName` = `FIX-BINARY-SMALL` | Uses `anyName` automatically | Ack output present, no error |
| EW-10 | Unit | Binary payload — no binary data on item | Payload = Binary File | 1 item, no `binary` key | Throws `NodeOperationError`: "Payload is set to Binary File, but no binary data exists on the incoming item." | Execution fails with that message |
| EW-11 | Integration | Large JSON payload routes through blob storage | Payload = JSON, JSON Source = Input | 1 item, `json` = `FIX-JSON-LARGE` | `payload.type === 'reference'`; trigger (PWT-05) confirms round-trip integrity | Ack output present; trigger-side received item has full-size `blob` field |
| EW-12 | Integration | Large binary payload routes through blob storage | Payload = Binary File | 1 item, `binary.file` = `FIX-BINARY-LARGE` | `payload.type === 'reference'` | Ack output present; trigger-side receives full binary via `binary.file` |
| EW-13 | Integration | Wait for Response = false | Wait for Response = false | `FIX-JSON-SMALL` | "Acknowledged" output populates immediately; "Completed" output is empty | Output 0 has 1 item; output 1 has 0 items |
| EW-14 | Integration | Wait for Response = true, workflow completes in time | Wait for Response = true, Wait Timeout = 15; paired trigger responds via **Respond to Private Workflow** within the window | `FIX-JSON-SMALL` | Both outputs populate; "Completed" output has the hydrated response payload | Output 1 item 0 `json` matches the Respond node's payload |
| EW-15 | Integration | Wait for Response = true, times out | Wait for Response = true, Wait Timeout = 1; paired trigger never responds | `FIX-JSON-SMALL` | "Acknowledged" output populates; "Completed" output stays empty (hub status never reaches `Completed` within the wait) | Output 1 has 0 items; no thrown error |
| EW-16 | Unit | Workflow Name required | Workflow Name = `` (empty) | any | Throws `NodeOperationError`: "Workflow name is required." | Execution fails with that message |
| EW-17 | Unit/Integration | Hub service unavailable | Credential with invalid API key (integration) / mocked `httpRequest` throws (unit, see EW-26) | any | Throws `NodeApiError`: "Hub service is unavailable." | Execution fails with that message, error is a `NodeApiError` |
| EW-18 | Integration | Hub 5xx response | Simulate/force a hub 500 (requires hub-side fault injection, or test against a known-bad path) | any | Throws `NodeApiError`: `Hub error (500)`, `httpCode: '500'` | Execution fails, message matches pattern `Hub error (\d{3})` |
| EW-19 | Unit | `continueOnFail` captures per-item errors | Enable "Continue On Fail" on the node; 2 items, one with Workflow Name valid, one forcing EW-16's empty-name error via a per-item expression | 2 items | Node does not fail the workflow; ack output has one normal item and one `{ error: true, message, itemIndex }` item, each `pairedItem` matching its source index | Output 0 length 2; item for the failing index has `json.error === true` |
| EW-20 | Integration | Batch processing preserves item order & `pairedItem` | Default settings | 3 items, each `json` = `{ n: 1|2|3 }` | Ack output has 3 items in order, each `pairedItem.item` equal to its source index (0,1,2) | For i in 0..2: `output[0][i].pairedItem.item === i` |
| EW-21 | Integration | Completed-output hydration — JSON array response | Wait for Response = true; paired Respond node returns `FIX-JSON-ARRAY` as JSON | `FIX-JSON-SMALL` | "Completed" output has 3 items, one per array element | Output 1 length === 3 |
| EW-22 | Integration | Completed-output hydration — text response | Wait for Response = true; paired Respond node returns `FIX-TEXT` as Text | `FIX-JSON-SMALL` | "Completed" output item has `json.text === FIX-TEXT` | Assertion as stated |
| EW-23 | Integration | Completed-output hydration — binary response | Wait for Response = true; paired Respond node returns `FIX-BINARY-SMALL` as Binary File | `FIX-JSON-SMALL` | "Completed" output item has `binary.file` matching the fixture | Assertion as stated |
| EW-24 | Unit | Main hub request uses credential-based auth, not a manual header | Default settings | `FIX-JSON-SMALL` | The main POST goes through `httpRequestWithAuthentication('privateWorkflowApi', ...)`; no manually-attached `x-api-key` header | Mocked `httpRequestWithAuthentication` observes `credentialType === 'privateWorkflowApi'` |
| EW-25 | Unit | Payload = Text sends the configured text value | Payload = Text, Text = `FIX-TEXT` | any | Hub payload `encoding: 'text'`, `value === FIX-TEXT` (mirrors RW-13's already-shipped text mode) | Captured request body's `payload.encoding === 'text'` and `payload.value === "hello world"` |
| EW-26 | Unit | Hub connectivity failure (regression test for EW-17) | Mocked `httpRequest` throws | any | Throws `NodeApiError` | `.rejects.toBeInstanceOf(NodeApiError)` |

---

## 3. Respond to Private Workflow

`nodes/RespondToPrivateWorkflow/RespondToPrivateWorkflow.node.ts`

Each case runs downstream of a **Private Workflow Trigger** configured with Respond = "Using 'Respond to Private Workflow' Node", using `{{ $json.__correlationId }}` as the Correlation ID parameter, on Workflow Name `test-respond-<id>`. Results are observed on the paired Execute node's "Completed" output (Wait for Response = true) or via **Get Private Workflow Result** (GR-xx cases).

| ID | Type | Test | Parameters | Input Item(s) | Expected Result | Automated Assertion |
|---|---|---|---|---|---|---|
| RW-01 | Integration | Respond With = All Incoming Items | Respond With = allItems | 3 items, each plain JSON, no binary | Hub payload = array of the 3 JSON bodies; workflow output has 3 items, each `pairedItem.item` = source index; `__correlationId` stripped from all | Output length 3; none contain `__correlationId`; paired Execute node's Completed output array length 3 |
| RW-02 | Unit | All Items rejects binary | Respond With = allItems | 2 items, one with a `binary` property | Throws `NodeOperationError`: `"All Items" response does not support binary data. Use "Binary File" instead.` | Execution fails with that message |
| RW-03 | Integration | Respond With = First Incoming Item | Respond With = firstItem | 3 items | Only item 0's JSON is sent/output (`__correlationId` stripped); `pairedItem.item === 0` | Output length 1; `json` matches item 0's original fields minus `__correlationId` |
| RW-04 | Unit | First Item — zero input items | Respond With = firstItem | 0 items (trigger emits nothing upstream — force via an IF/no-op branch) | Output is `[{ json: {} }]`; no error thrown | Output length 1, `json` is `{}` |
| RW-05 | Unit | First Item rejects binary | Respond With = firstItem | 1 item with `binary` set | Throws `NodeOperationError`: `"First Item" response does not support binary data...` | Execution fails with that message |
| RW-06 | Unit | First Item requires a JSON object | Respond With = firstItem | 1 item whose `json` is an array (edge case; construct via a Code node upstream) | Throws `NodeOperationError`: `"First Item" requires the item to be a JSON object.` | Execution fails with that message |
| RW-07 | Integration | Respond With = JSON, valid string | Respond With = json, Response Body = `{"result":"ok"}` (typed literal) | any | Hub + workflow output both get `{ result: "ok" }` | Completed output `json.result === "ok"` |
| RW-08 | Integration | Respond With = JSON, expression resolving to object | Response Body = `={{ $json }}` where `$json` = `FIX-JSON-SMALL` | 1 item | Deep-cloned object sent/output | Completed output `json.orderId === "A-1001"` |
| RW-09 | Integration | Respond With = JSON, expression resolving to array | Response Body = `={{ [{a:1},{b:2}] }}` | any | Workflow output has 2 items (one per array element) | Output length 2 |
| RW-10 | Unit | JSON Response Body empty | Response Body = `` | any | Throws `NodeOperationError`: "Response Body is empty; expected valid JSON" | Execution fails with that message |
| RW-11 | Unit | JSON Response Body invalid | Response Body = `FIX-JSON-INVALID` | any | Throws `NodeOperationError`: "Response Body must contain valid JSON" | Execution fails with that message |
| RW-12 | Unit | JSON Response Body resolves to unsupported type | Response Body = `={{ 123 }}` | any | Throws `NodeOperationError`: `Response Body resolved to unsupported type (number)` | Execution fails with that message |
| RW-13 | Integration | Respond With = Text | Respond With = text, Response Text = `FIX-TEXT` | any | Hub payload `encoding: 'text'`, value = `FIX-TEXT`; output item `json.text === FIX-TEXT` | Completed output `json.text === "Hello from the test suite"` |
| RW-14 | Integration | Respond With = Binary, auto mode | Respond With = binary, Response Data Source = auto | 1 item with `binary.anyName` = `FIX-BINARY-SMALL` | Uses first binary property automatically; output item has `binary.anyName` | Completed output `binary` key present and matches fixture |
| RW-15 | Integration | Respond With = Binary, manual mode | Response Data Source = manual, Binary Property = `file` | 1 item with `binary.file` = `FIX-BINARY-SMALL` | Uses named property | Completed output `binary.file` present |
| RW-16 | Unit | Binary — no binary data found | Respond With = binary | 1 item with no `binary` key | Throws `NodeOperationError`: `"Binary File" response requires a binary property on the input item, but none was found.` | Execution fails with that message |
| RW-17 | Integration | Respond With = No Data | Respond With = none | any | `payload = null`; output item `{ correlationId, status: 'Success' }` | Completed output `json.status === 'Success'`, empty/absent hub payload |
| RW-18 | Unit | Correlation ID required | Correlation ID = `` (empty) | any | Throws `NodeOperationError`: "Correlation ID is required." | Execution fails with that message |
| RW-19 | Integration | Large response payload routes through blob storage | Respond With = json, Response Body = `FIX-JSON-LARGE` (as a JSON expression object, not a string) | any | `hubInfo.useStorage` true and size > `maxPayload` ⟹ uploaded via blob transport before the `completed` POST | Completed output on caller side matches the full large payload (round-trip integrity) |
| RW-20 | Integration | Node failure reports "Failed" status to hub without masking the real error | Force a downstream error (e.g. Response Body = `FIX-JSON-INVALID`, respondWith = json) | any | Best-effort POST to hub with `status: 'Failed'` and the error message is attempted, now via `httpRequestWithAuthentication` rather than a manually-attached `x-api-key` header; node then still throws the original `NodeOperationError` ("Response Body must contain valid JSON") | Execution fails with the original message (not a hub-POST error); on the caller side, `GET Private Workflow Result` (or Execute's Completed output) reflects a non-`Completed` state |
| RW-21 | Integration | Hub service unavailable | Credential with invalid API key | any | Throws `NodeApiError`: "Hub service is unavailable." — previously this call site had no try/catch at all and would have thrown a raw, unwrapped error | Execution fails with that message, error is a `NodeApiError` |

---

## 4. Get Private Workflow Result

`nodes/GetPrivateWorkflowResult/GetPrivateWorkflowResult.node.ts`

Each case first runs an **Execute Private Workflow** (Wait for Response = false) to obtain a `correlationId`, and a paired trigger/respond pair to bring the hub to the desired status, then runs **Get Private Workflow Result** with that `correlationId`.

| ID | Type | Test | Parameters | Precondition (hub status) | Expected Result | Automated Assertion |
|---|---|---|---|---|---|---|
| GR-01 | Integration | Status = Completed, routed to Completed | Continue Workflow When Status Returns = `[Completed]` | Trigger responded with `FIX-JSON-SMALL` via Respond node | "Completed" output has the fully hydrated payload; "Pending" output empty | Output 0 length 1, `json.orderId === "A-1001"`; output 1 length 0 |
| GR-02 | Integration | Status = Running, not selected in Continue On | Continue Workflow When Status Returns = `[Completed]` (Running not included) | Trigger has ack'd "Running" but not yet responded | "Pending" output has `{ status: 'Running', correlationId }`; "Completed" output empty | Output 1 length 1, `json.status === 'Running'` |
| GR-03 | Integration | Status = Running, explicitly selected in Continue On | Continue Workflow When Status Returns = `[Completed, Running]` | Same as GR-02 | Routes to **Completed** output, but only with `{ status, correlationId }` — **not** the full hydrated payload, since hydration only runs when `status === 'Completed'` | Output 0 length 1, `json` has exactly `status` and `correlationId` keys (no other payload fields) — this is the key nuance to verify, since it differs from what GR-01 returns |
| GR-04 | Integration | Status = Queued / Pending routing | Continue Workflow When Status Returns = `[Completed]`; test each of Queued and Pending as separate sub-cases | Hub still queued/pending | Both route to "Pending" output with `{ status, correlationId }` | Output 1 `json.status` equals the tested status |
| GR-05 | Unit | Correlation ID blank or unknown | Correlation ID = `` or a random UUID never issued by the hub | — | Hub responds without a recognizable `status`; throws `NodeApiError`: "Hub response missing status field" | Execution fails with that message |
| GR-06 | Unit | API key missing | Credential with `apiKey` cleared | — | Throws `NodeOperationError`: "API key is missing. Configure the Private Workflow credentials." | Execution fails with that message |
| GR-07 | Integration | Hub service unavailable | Credential with invalid API key | — | Throws `NodeApiError`: "Hub service is unavailable." | Execution fails with that message |
| GR-08 | Integration | Hub info incomplete | (Requires a hub account misconfigured to omit `apiUrl`/`hubUrl`/`blobStorageUrl` — hub-side setup) | — | Throws `NodeApiError`: "Hub service information is incomplete or unavailable." | Execution fails with that message |
| GR-09 | Integration | Completed — JSON array payload | Respond node sent `FIX-JSON-ARRAY` | Completed | "Completed" output has 3 items | Output 0 length === 3 |
| GR-10 | Integration | Completed — text payload | Respond node sent `FIX-TEXT` as Text | Completed | Output item `json.text === FIX-TEXT` | Assertion as stated |
| GR-11 | Integration | Completed — binary payload | Respond node sent `FIX-BINARY-SMALL` as Binary File | Completed | Output item `binary.file` matches fixture | Assertion as stated |
| GR-12 | Integration | Completed — payload via blob reference | Respond node sent `FIX-JSON-LARGE` (forces blob upload) | Completed | Output item's JSON matches the full large fixture (downloaded and decoded transparently) | `json.blob` length matches original |
| GR-13 | Unit/Integration | Malformed completed payload is wrapped as `NodeOperationError`, not a raw exception | Force the hub's stored response payload to contain invalid JSON with `encoding: 'json'` (requires hub-side fault injection, or a mocked `hydrate()` call for a pure unit test) | Completed, payload corrupt | Throws `NodeOperationError` (message from `PrivateWorkflowResponseHydrator`, e.g. "Invalid JSON payload") — **regression test for the `GetPrivateWorkflowResult.node.ts` try/catch fix**; previously this surfaced as an unattributed raw error | Execution fails with a `NodeOperationError`, not a generic/unhandled exception |
| GR-14 | Unit | `pairedItem` is always `{ item: 0 }` | Any status | — | Since this node has no input items (single-shot), every emitted item across both outputs carries `pairedItem: { item: 0 }` | Inspect raw execution data (not just `json`) for `pairedItem.item === 0` on every emitted item |

---

## 5. Data Transform Coverage Matrix

Every payload encoding this package supports, cross-referenced against which node exercises it and which test IDs cover it end-to-end.

| Encoding | Produced by | Consumed by | Covering test IDs |
|---|---|---|---|
| `json` (single object), inline | Execute (Input/Custom), Respond (allItems/firstItem/json) | Trigger, Execute (Completed), Get Result | EW-01, EW-02, EW-03, RW-01, RW-03, RW-07, RW-08, PWT-04, GR-01 |
| `json` (array) | Execute (Custom expression → array), Respond (json → array expression) | Trigger (rejects arrays), Execute (Completed), Get Result | PWT-07 (rejection), EW-21, RW-09, GR-09 |
| `text` | Execute (Text), Respond (text) | Trigger, Execute (Completed), Get Result | EW-25, RW-13, EW-22, GR-10 |
| `base64` (binary) | Execute (Binary File), Respond (binary) | Trigger, Execute (Completed), Get Result | EW-07, EW-09, PWT-06, RW-14, RW-15, EW-23, GR-11 |
| `reference` (blob, any encoding) | Execute or Respond, when size > account `maxPayload` | Trigger, Execute (Completed), Get Result | EW-11, EW-12, PWT-05, RW-19, GR-12 |
| Invalid/malformed | n/a (fault injection) | `PrivateWorkflowResponseHydrator` error path | EW-04, RW-11, GR-05, GR-13 |

---

## 6. Known Gaps Discovered While Writing This Guide

- **(Fixed)** `ExecutePrivateWorkflow.node.ts` declared a `Text` property (`textValue`, shown when `payloadType === 'text'`) but the `Payload` (`payloadType`) parameter only offered `json` and `binary` options — `text` was unreachable from the UI. `payloadType` now includes a `Text` option and the payload-building logic has a `text` branch (encoding `'text'`, mirroring `RespondToPrivateWorkflow`'s existing text mode); see EW-25.
- **(Fixed)** `ExecutePrivateWorkflow.node.ts`'s main hub POST and `RespondToPrivateWorkflow.node.ts`'s failure-report POST manually attached the API key as an `x-api-key` header instead of using `httpRequestWithAuthentication` — the exact anti-pattern n8n's `@n8n/community-nodes/no-http-request-with-manual-auth` lint rule exists to catch. Both now go through the credential's `authenticate` block; see EW-24 and RW-20.
- **(Fixed)** Several genuine external-service failures (hub unreachable, hub URL/blob URL/API URL missing, hub 5xx, malformed hub response) were thrown as `NodeOperationError` across all four nodes instead of `NodeApiError`, per n8n's error-handling guidance (`NodeApiError` for HTTP/external-API failures, `NodeOperationError` for validation/config/logic errors). Reclassified in `ExecutePrivateWorkflow`, `RespondToPrivateWorkflow`, `GetPrivateWorkflowResult`, and `PrivateWorkflowTrigger` — see EW-17/18/26, RW-21, GR-05/07/08, PWT-03. `RespondToPrivateWorkflow`'s `getHubInfo()` call additionally had no try/catch at all (a raw, unwrapped error would have escaped `execute()`) — now wrapped like the other three nodes.
- Full end-to-end automation is blocked on `HUB_BASE_URL` being hardcoded to production (`lib/HubConfig.ts:5`). If CI automation is a goal, consider either (a) a dedicated always-on NodeFlex test account, isolated by the Workflow Name convention in [0.3](#03-workflow-pairing-convention), or (b) making the hub base URL configurable (e.g. via credential field or environment variable) so CI can point at a mock hub implementing `GET /api/apikeys/verify`, `GET /api/apikeys/hub`, `POST /completed/:correlationId`, `GET /results/:correlationId`, and blob upload/download — plus a SignalR-compatible WebSocket endpoint for Trigger tests.
- **(Fixed)** `RespondToPrivateWorkflow`'s `respondWith: 'none'` mode sent an unparseable empty-string JSON payload — see [0.4](#04-hub-dependency--test-isolation) for the root cause and fix.
- **(Open)** The test account's `blobStorageUrl` (`storagewestus.blob.core.windows.net`) doesn't resolve in DNS — blob-storage-dependent tests are `it.skip`-marked in `tests/integration/executeTriggerDataTypes.test.ts` until the account's storage endpoint is fixed on the hub side. This also means large-payload paths (RW-19, EW-11, EW-12, PWT-05) have no live coverage yet.
- The hub rate-limits rapid repeated `GET /results/:correlationId` polling for the same correlationId (HTTP 429) — worth keeping in mind for any real workflow that polls aggressively, not just for test pacing.
