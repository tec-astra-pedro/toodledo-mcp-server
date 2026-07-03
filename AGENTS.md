# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Development Commands

### Build and Run
- **Build project**: `npm run build` (runs `tsc` to generate files in `build/`)
- **Development mode**: `npm run dev` (runs `ts-node src/index.ts`)
- **Start production build**: `npm start` (runs `node build/index.js`)

### Testing
- **Run tests**: `npm test` (runs `vitest`); `npm run test:coverage` for a coverage run. No coverage threshold is enforced in `vitest.config.ts`.
- `src/client.test.ts` covers `ToodledoClient` (HTTP/auth behavior, mocked via `msw`); `src/oauth.test.ts` and `src/tokenStore.test.ts` cover the OAuth token-endpoint helpers and the file-backed token store. `src/index.test.ts` and `src/index.main.test.ts` cover `src/index.ts`'s MCP tool handlers (`ListToolsRequestSchema`/`CallToolRequestSchema`) and `main()`, respectively. `src/authorize.ts`'s interactive flow (browser, loopback HTTP server) is deliberately not unit-tested — only its pure pieces are (`src/authorize.test.ts`) — so overall coverage reads ~65% while the core files (`client.ts`, `index.ts`) sit at ~95%+.
- `vitest.setup.ts` points `TOODLEDO_TOKEN_PATH` at a throwaway temp file for every test run. This is load-bearing, not boilerplate: without it, any test that constructs a `ToodledoClient` without injecting a `TokenStore` falls back to the real file store and overwrites `.toodledo-token.json` — destroying the live refresh token, unrecoverably, since Toodledo rotates tokens (this happened once). Never remove it, and still inject a mock `TokenStore` in new client tests.
- **Live E2E**: `npm run e2e` (`scripts/e2e.ts`) drives all 17 tools through the real built server over stdio against the live Toodledo API, with self-cleaning `E2E-TEST-`-prefixed artifacts. Requires a populated `.env` and a valid `.toodledo-token.json`; not run in CI. A green unit suite is not proof the tools work — unit tests once passed while 8 of the 12 write tools sent wire formats Toodledo ignores or rejects — so run the E2E after changing request formats, tool schemas, or `src/client.ts`.
- `src/index.ts` exports `createServer(client)`, which builds the `Server` (tool registration + handlers) without connecting a transport. Tool handlers are tested by driving `createServer(mockClient)` with `InMemoryTransport.createLinkedPair()` (`@modelcontextprotocol/sdk/inMemory.js`) and a `Client` (`@modelcontextprotocol/sdk/client/index.js`) — see `src/index.test.ts` — instead of spawning a real process.
- `main()` is guarded behind `if (import.meta.url === \`file://${process.argv[1]}\`)` so importing `src/index.ts` (e.g. for `createServer`) doesn't also run it. Without this guard, `main()` executes at module load on every import — reads env vars, calls `process.exit(1)` if `TOODLEDO_CLIENT_ID`/`TOODLEDO_CLIENT_SECRET` are missing, and connects a real stdio transport. This only breaks visibly in an environment with no `.env` file and no `TOODLEDO_*` env vars set (like CI) — Vitest treats `process.exit()` as an unhandled error and fails the whole run. A local `.env` with placeholder (non-empty) values will mask the bug, so passing tests locally doesn't confirm the guard is unnecessary — CI needs to actually run clean before trusting this.

## Code Architecture

This project is a Model Context Protocol (MCP) server for the Toodledo task management API, implemented in TypeScript.

### Structure
- `src/index.ts`: The entry point of the MCP server. Defines the server capabilities (tools) and handles the `stdio` transport for local interaction.
- `src/client.ts`: A dedicated `ToodledoClient` class responsible for all communications with the Toodledo API v3. It handles:
    - OAuth2 authentication (Client ID/Secret).
    - Automatic access token management and refreshing.
    - Resilient request execution with automatic retry on 401 errors.
- `build/`: The distribution directory containing the compiled JavaScript. Gitignored — fully regenerable via `npm run build`, never commit it.

### Key Technologies
- **Language**: TypeScript (ESM/NodeNext)
- **SDK**: `@modelcontextprotocol/sdk`
- **HTTP Client**: `axios`
- **Environment**: `dotenv` for local configuration

## Implementation Strategy
The project follows a "Local-First" development strategy. The current implementation uses the `stdio` transport for direct integration with Codex Desktop. The architecture is designed to be refactored to a "Hosted Service" (SSE transport) with minimal changes to the core `ToodledoClient` logic.

## Git Workflow
- Keep commits small and single-concern (e.g. docs, config/tooling, and feature code as separate commits) rather than bundling unrelated changes — split by what the change *is*, not just by when it happened to land.
- For any non-trivial change (anything beyond a one-line doc fix): create a feature branch, commit there, push the branch, and open a PR into `main`. The CI workflow (`.github/workflows/ci.yml`, runs `npm run build` + `npm test`) runs on every PR and should be green before merging.
- `main` is protected: direct pushes (including by admins) are rejected, and merging requires the `build-and-test` CI check to pass. There's no way around opening a PR — plan for the branch+PR step up front, not as an afterthought.
- Never commit changes to `AGENTS.md` or other agent-instruction files without the user reading the diff and explicitly confirming first, even if a broader "commit everything" request was already approved.

## Planning & Decision Records
- Design and implementation plans are recorded in `docs/adr/`, numbered chronologically (`0001-...`, `0002-...`, descriptive kebab-case names). Check there first for the rationale behind existing architecture and past decisions before re-deriving it from scratch.
- These are point-in-time records (ADR convention, see [adr.github.io](https://adr.github.io/)) — never edit a past one to reflect a new decision; add a new sequentially-numbered file instead.
- When a non-trivial planning session (e.g. Codex's plan mode) results in real implementation work, save a copy of the finalized plan into `docs/adr/` with the next sequential number. This makes it visible to any tool or collaborator working on this repo, not just a Codex instance with access to a local `~/.Codex/plans/` directory.

## MCP SDK Notes
- Installed version: check `node_modules/@modelcontextprotocol/sdk/package.json` (types live in `dist/esm/types.d.ts`, runtime behavior in `dist/esm/server/index.js`) — don't assume spec behavior without checking the installed version, the SDK's surface changes across releases.
- If a tool declares `outputSchema`, the `CallToolRequestSchema` handler must also return `structuredContent` matching it — the SDK does **not** auto-populate `structuredContent` from `content`, and does **not** validate the two against each other or against `outputSchema` at runtime. A drift between them will not throw; it has to be caught by tests.
- For `Tool`, both a top-level `title` and `annotations.title` are valid fields, but `annotations.title` takes precedence if both are set — set only one.
- `ToodledoTask` (`src/types.ts`) has a `[key: string]: any` catch-all and does not model the full Toodledo API response (e.g. `priority`, `duedate`, `star`, `tags` are absent) — don't treat it as an exhaustive/closed schema when deriving JSON Schemas from it.
