# n8n Custom Node Development, Coding Standards & Submission Guidelines

You are an expert n8n custom node developer. Whenever you generate code, refactor, or review files in this repository, you must strictly adhere to the following rules, UI standards, coding styles, and submission checklists required by the n8n community node verification process.

## 1. Naming & Package Metadata
- **Package Name:** The package name in `package.json` MUST start with `n8n-nodes-` or `@<scope>/n8n-nodes-`.
- **Keywords:** The `package.json` MUST include `"n8n-community-node-package"` and the name of the external service in its `"keywords"` array.
- **n8n Metadata:** The `package.json` MUST contain an `"n8n"` object mapping to the node and credential files (e.g., `"n8n": { "nodes": ["dist/nodes/MyNode.node.js"], "credentials": [...] }`).
- **License:** The project MUST use the MIT License for community node verification.

## 2. File Structure, Typing & Codex
- **TypeScript Only:** All node logic must be written in strict TypeScript.
- **Core Files:** 
  - Main node: `[NodeName].node.ts`.
  - Credentials: `[CredentialName].credentials.ts`.
  - Node metadata: `[NodeName].node.json` (the codex file, required for categories and doc URLs). 
- **Codex File Matching:** The `"node"` key in the `.json` codex file MUST perfectly match the camelCase `name` defined in the TypeScript file's `INodeTypeDescription`. `"nodeVersion"` MUST perfectly match `version`.
- **Separation of Concerns:** Keep the `execute` method thin. Extract API interactions into pure functions or a `client.ts` service.

## 3. Strict UI Coding Styles & Parameter Standards
n8n enforces strict UI consistency. Code must adhere to these exact standards:
- **Parameter Naming:** 
  - `displayName`: Must be in Title Case (e.g., "Workflow Name", "JSON Source").
  - `name`: Must be camelCase (e.g., `workflowName`, `jsonSource`).
- **Descriptions:** 
  - Must start with a capital letter.
  - Must **NOT** end with a period/full stop. (e.g., `description: 'The name of the workflow'` is correct; `...workflow.'` is invalid).
- **Boolean Parameters:**
  - Must always be phrased positively (e.g., "Include Details", NOT "Exclude Details").
- **Options and Multi-Options:**
  - Option `name` is Title Case. Option `value` is camelCase, snake_case, or exact API value.
  - The first item in the options array must be the default value.
- **Display Options:**
  - Use `displayOptions` heavily to hide fields that aren't relevant based on current selections. Do not overwhelm the user with inactive fields.
- **Resource/Operation Pattern:**
  - For REST API integrations, nodes should use the `Resource` and `Operation` pattern (e.g., Resource: 'User', Operation: 'Get').

## 4. Input & Output Data Standards
- **Standard n8n Data Structure:** All data returned from the `execute`, `trigger`, or `poll` functions MUST be mapped into n8n's standard interface: `INodeExecutionData[][]` (an array of arrays of objects with a `json` key).
  - Correct: `return [[{ json: { id: 1, name: "Test" } }]];`
- **No Array Payloads on the Root:** Nodes process single JSON objects. If returning multiple items, return them as multiple items within the n8n data structure, not as a single item with an array inside (unless specifically requested by a parameter).
- **Binary Data:** Binary data must be stored under the `binary` key within `INodeExecutionData`, not `json`. Buffer/Base64 handling must use n8n's native binary helpers where applicable.

## 5. Security & Credentials
- **No Hardcoded Secrets:** Never pass API keys, tokens, or URLs directly in node properties. You MUST use n8n's `ICredentialType` framework.
- **External Dependencies:** Keep `npm` dependencies to an absolute minimum. Use native Node.js and n8n helpers (like `this.helpers.httpRequest`) instead of installing `axios` or `node-fetch`.

## 6. Error Handling
- **Robust Error Handling:** Do not fail silently. Wrap logic in `try/catch` blocks.
- **Standard Error Class:** Use `throw new NodeOperationError(this.getNode(), error)` with descriptive messages.
- **Item Index:** Pass the `itemIndex` to the error when processing multiple items so the user knows exactly which row failed.
- **Continue on Fail:** Respect the user's workflow settings. If applicable, check `if (this.continueOnFail())` and push the error to the output rather than throwing a hard exception.

## 7. Linting & Code Quality
- **Linter Passing:** Code MUST pass the official n8n linter (`eslint-plugin-n8n-nodes-base`). Ensure `npm run lint` executes with zero errors.
- **Icons:** Must be SVG format, 60x60px viewbox, single color or clear identifiable logo, with a transparent background.

## 8. Publishing & NPM Requirements
- **Provenance Attestation (Required as of May 1, 2026):** All nodes published to the n8n Creator Portal MUST be published to npm with a provenance statement. GitHub Actions workflows must use OIDC tokens to publish with `npm publish --provenance`.
- **Public NPM:** The package must be public.
- **README:** Must contain node capabilities, credential setup instructions, and installation instructions.

## 9. Final Verification Checklist
When prompted to run a Final Pre-Flight Check, evaluate the code for:
1. Exact matches between `.node.ts` properties and `.node.json` codex keys.
2. Title Case for `displayName`, camelCase for `name`.
3. Descriptions do NOT end in periods.
4. Booleans are positively phrased.
5. Absolute absence of hardcoded secrets and minimal npm dependencies.
6. Proper `try/catch` wrapping utilizing `NodeOperationError`.
7. `npm run lint` compliance.
8. NPM publishing workflows updated to include `--provenance`.

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