# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Run
- **Build project**: `npm run build` (runs `tsc` to generate files in `build/`)
- **Development mode**: `npm run dev` (runs `ts-node src/index.ts`)
- **Start production build**: `npm start` (runs `node build/index.js`)

### Testing
- **Run tests**: `npm test` (runs `vitest`); `npm run test:coverage` for a coverage run. No coverage threshold is enforced in `vitest.config.ts`.
- `src/client.test.ts` covers `ToodledoClient` only (HTTP/auth behavior, mocked via `msw`). It does **not** exercise `src/index.ts`'s MCP tool handlers (`ListToolsRequestSchema`/`CallToolRequestSchema`) — there is currently no test coverage of tool registration or execution.
- `src/index.ts` has no exports, and `main()` runs unconditionally at module load (reads env vars, calls `process.exit(1)` if missing, connects a stdio transport). It cannot be safely imported in a test as-is. To test tool handlers: extract a `createServer(client)` function that builds the `Server` (tool registration + handlers) without connecting a transport, then drive it in tests with `InMemoryTransport.createLinkedPair()` (`@modelcontextprotocol/sdk/inMemory.js`) and a `Client` (`@modelcontextprotocol/sdk/client/index.js`), instead of spawning a real process.

## Code Architecture

This project is a Model Context Protocol (MCP) server for the Toodledo task management API, implemented in TypeScript.

### Structure
- `src/index.ts`: The entry point of the MCP server. Defines the server capabilities (tools) and handles the `stdio` transport for local interaction.
- `src/client.ts`: A dedicated `ToodledoClient` class responsible for all communications with the Toodledo API v3. It handles:
    - OAuth2 authentication (Client ID/Secret).
    - Automatic access token management and refreshing.
    - Resilient request execution with automatic retry on 401 errors.
- `build/`: The distribution directory containing the compiled JavaScript.

### Key Technologies
- **Language**: TypeScript (ESM/NodeNext)
- **SDK**: `@modelcontextprotocol/sdk`
- **HTTP Client**: `axios`
- **Environment**: `dotenv` for local configuration

## Implementation Strategy
The project follows a "Local-First" development strategy. The current implementation uses the `stdio` transport for direct integration with Claude Desktop. The architecture is designed to be refactored to a "Hosted Service" (SSE transport) with minimal changes to the core `ToodledoClient` logic.

## MCP SDK Notes
- Installed version: check `node_modules/@modelcontextprotocol/sdk/package.json` (types live in `dist/esm/types.d.ts`, runtime behavior in `dist/esm/server/index.js`) — don't assume spec behavior without checking the installed version, the SDK's surface changes across releases.
- If a tool declares `outputSchema`, the `CallToolRequestSchema` handler must also return `structuredContent` matching it — the SDK does **not** auto-populate `structuredContent` from `content`, and does **not** validate the two against each other or against `outputSchema` at runtime. A drift between them will not throw; it has to be caught by tests.
- For `Tool`, both a top-level `title` and `annotations.title` are valid fields, but `annotations.title` takes precedence if both are set — set only one.
- `ToodledoTask` (`src/types.ts`) has a `[key: string]: any` catch-all and does not model the full Toodledo API response (e.g. `priority`, `duedate`, `star`, `tags` are absent) — don't treat it as an exhaustive/closed schema when deriving JSON Schemas from it.
