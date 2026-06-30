# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Run
- **Build project**: `npm run build` (runs `tsc` to generate files in `build/`)
- **Development mode**: `npm run dev` (runs `ts-node src/index.ts`)
- **Start production build**: `npm start` (runs `node build/index.js`)

### Testing
- **Run tests**: `npm test` (currently a placeholder)

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
