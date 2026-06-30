# Plan: Enhance Tool Interface with Annotations and Output Schemas

## Context
The current implementation of the Toodledo MCP server provides basic tool functionality. However, to fully adhere to the Model Context Protocol (MCP) specification and provide a more robust and "intelligent" interface for LLM clients, we need to add rich metadata and structured output definitions. This includes human-readable titles, capability hints (annotations), and JSON Schema definitions for tool outputs.

## Process Note
Implement this on a feature branch and open a PR into `main` — don't commit directly to `main`. The repo now has a CI workflow (`.github/workflows/ci.yml`) running `npm run build` + `npm test` on every PR; that should go green before merging (and, once branch protection is enabled on `main`, will be required to). This also means the Verification checklist below is enforced automatically by CI, not just manually.

## Implementation Plan

### Phase 1: Analyze and Define Schemas
1.  **Review `src/types.ts`**: Extract the structures of `ToodledoTask`, `ToodledoNote`, `ToodledoList`, and `ToodledoFolder` to build JSON Schemas for the `outputSchema` property of each tool.
    *   Note: `ToodledoTask` has a `[key: string]: any` catch-all and does not model every field the real Toodledo API returns (e.g. `priority`, `duedate`, `star`, `tags`). Build the schema to allow additional properties (`additionalProperties: true`) rather than presenting it as a complete/closed schema.
    *   `ping` and the `delete_*` tools return plain prose strings, not structured data from these types — they get no `outputSchema` (see Phase 2/3).
    *   **Return shape is per-tool, not per-prefix.** Per `src/client.ts`: `get_tasks`, `get_notes`, `get_lists`, `get_folders` return arrays. `add_task`, `edit_task`, `add_list`, `edit_list`, `add_folder`, `edit_folder` return a single object. But `add_note` and `edit_note` also return **arrays** (`ToodledoNote[]`), despite the `add_*`/`edit_*` naming — don't assume single-object for those two. Each tool's `outputSchema` must mirror the wrapped response shape: `{ type: "object", properties: { result: <array-or-object-schema> }, required: ["result"] }` (wrapped in `result` to match the Phase 3 response format, not a bare resource schema).
2.  **Identify Annotation Requirements**:
    *   `get_*` tools: `readOnlyHint: true`, `idempotentHint: true`, `destructiveHint: false`, `openWorldHint: false`.
    *   `add_*` tools: `readOnlyHint: false`, `idempotentHint: false`, `destructiveHint: true`, `openWorldHint: false`.
    *   `edit_*` tools: `readOnlyHint: false`, `idempotentHint: false`, `destructiveHint: true`, `openWorldHint: false`.
    *   `delete_*` tools: `readOnlyHint: false`, `idempotentHint: true`, `destructiveHint: true`, `openWorldHint: false`.

### Phase 2: Update Tool Definitions in `src/index.ts`
1.  **Modify `ListToolsRequestSchema` registration**:
    *   Add a top-level `title` field to every tool for better UI/UX. Per the SDK's `Tool` schema, `annotations.title` takes precedence over the top-level `title` if both are set — don't also set `annotations.title`, or the two can silently diverge.
    *   Add an `outputSchema` object to data-returning tools (`get_*`, `add_*`, `edit_*`), using the schemas derived in Phase 1. `ping` and `delete_*` tools keep no `outputSchema`, since they return prose, not structured data.
    *   Add an `annotations` object to every tool, **explicitly setting** all the following properties: `readOnlyHint`, `idempotentHint`, `destructiveHint`, and `openWorldHint` (set to `false`).
2.  **Ensure all tools have an `openWorldHint: false` annotation as specifically requested.**

### Phase 3: Update Tool Execution Logic in `src/index.ts`
1.  **Modify `CallToolRequestSchema` handlers** for data-returning tools (`get_*`, `add_*`, `edit_*`) to return **both**:
    *   `content: [{ type: "text", text: JSON.stringify({ result: <data> }, null, 2) }]` — unstructured fallback for clients (e.g. ChatGPT) that only read text content.
    *   `structuredContent: { result: <data> }` — matching the `outputSchema` declared in Phase 2, for clients that consume structured output directly per the MCP spec.
    *   Both fields must carry the same data so the two representations never diverge.
2.  `ping` and `delete_*` handlers are unchanged — they keep returning plain text content only, since they have no `outputSchema`.
3.  The existing `catch` block (error path, `isError: true`) is unchanged — it keeps returning `content` only, no `structuredContent`. Errors don't need to satisfy `outputSchema`.

### Phase 3.5: Make `src/index.ts` Testable (prerequisite for Phase 4)
`src/index.ts` currently has no exports, and `main().catch(...)` runs unconditionally at module load — it reads env vars (calling `process.exit(1)` if missing) and connects a stdio transport as a side effect of import. As-is, the file cannot be imported by a test without triggering that. Before writing Phase 4 tests:
1.  Extract a `createServer(client: ToodledoClient): Server` function that performs tool registration and both request-handler registrations (everything currently inside `main()` except env-var loading, client construction, and the stdio `transport.connect`), and export it.
2.  Have `main()` call `createServer(client)` and connect it to stdio as before — behavior for the real binary is unchanged.
3.  In tests, build a `Server` via `createServer(mockClient)` and connect it to a test `Client` (import from `@modelcontextprotocol/sdk/client/index.js`) using `InMemoryTransport.createLinkedPair()` (import from `@modelcontextprotocol/sdk/inMemory.js` — both paths confirmed to resolve against the installed SDK's package exports), then call `client.callTool(...)` and assert on the result — this avoids spawning a real process or duplicating handler logic in the test.
4.  Note: the SDK's `Server` does not itself validate `structuredContent` against the declared `outputSchema` at runtime — nothing will throw if they drift apart. The Phase 4 tests are the only thing actually enforcing the two stay in sync, so don't treat them as optional/redundant scaffolding.

### Phase 4: Update Tests and Verify
1.  **Add new tests** (there are currently none) covering the tool handlers via the seam from Phase 3.5 — `src/client.test.ts` only tests `ToodledoClient` and never exercises the MCP tool handlers, so there is no existing JSON.parse-based test to migrate. For at least one array-returning tool (e.g. `get_tasks`) and one single-object tool (e.g. `add_task`), assert that:
    *   `structuredContent.result` matches the data returned by the (mocked) `ToodledoClient` call.
    *   `content[0].text`, when JSON-parsed, equals `{ result: <same data> }`.
2.  **Build and Test**:
    *   `npm run build` to ensure TypeScript compliance.
    *   `npm test` to verify that all functionality is preserved. (No coverage threshold is currently configured in `vitest.config.ts`, so treat coverage as informational, not a hard gate, unless one is added.)

## Critical Files
- `src/index.ts` (Tool registration and execution; needs an exported `createServer` per Phase 3.5)
- `src/types.ts` (Reference for schemas)
- `src/client.test.ts` (Existing `ToodledoClient` tests — unaffected by this change)
- `src/index.test.ts` (New file — handler-level tests per Phase 4)

## Verification
- [ ] `npm run build` completes without errors.
- [ ] `npm test` passes, including new tests asserting both `content[0].text` and `structuredContent` carry the `{ result: <data> }` payload.
- [ ] For data-returning tools, `structuredContent` is present and matches the declared `outputSchema`; `ping`/`delete_*` responses are unchanged (plain text, no `outputSchema`).
