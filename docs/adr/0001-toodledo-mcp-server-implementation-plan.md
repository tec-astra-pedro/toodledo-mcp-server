# Implementation Plan: Toodledo MCP Server

## Context
We are building a Model Context Protocol (MCP) server for the Toodledo API v3. Following an "Architectural Decision Record" (ADR) pattern, we have decided on a **Local-First** deployment model using **TypeScript/Node.js** and a migration path toward a hosted SaaS. We are prioritizing **high test coverage** (approaching 100%) using **Vitest** and **Mock Service Worker (MSW)** to ensure robustness.

## Objectives
1.  **Full API Implementation**: Implement comprehensive CRUD operations for Tasks, Notes, and Lists.
2.  **High-Coverage Testing**: Achieve near 100% code coverage for the `ToodledoClient` using MSW for network mocking.
3.  **MCP Tool Integration**: Expose the Toodledo API capabilities via MCP tools (List, Get, Add, Edit, Delete) for Tasks, Notes, and Lists.

## Implementation Steps

### Phase 1: Testing Infrastructure & Types
- **Install Test Tooling**: Set up Vitest, MSW, and coverage reporting.
- **Define Domain Models**: Create `src/types.ts` containing TypeScript interfaces for all Toodledo API resources (Tasks, Notes, Lists, Folders, etc.) based on the research.
- **Verify Environment**: Ensure the testing environment is correctly configured to handle ESM and `NodeNext`.

### Phase 2: Core API Client Expansion
- **Task Management**: Implement `getTasks`, `addTask`, `editTask`, `deleteTask`.
- **Note Management**: Implement `getNotes`, `addNote`, `editNote`, `deleteNote`.
- **List/Folder Management**: Implement `getLists`, `addList`, `editList`, `deleteList`.
- **Resilience Testing**: Write tests specifically for the token refresh logic and 401 error retry mechanism.

### Phase 3: MCP Server Tool Implementation
- **Tool Registration**: Update `src/index.ts` to register all MCP tools corresponding to the `ToodledoClient` methods.
- **Error Handling**: Implement robust error translation between API errors and MCP tool error responses.
- **Input Validation**: Ensure all tool inputs are validated against the defined TypeScript interfaces.

### Phase 4: Comprehensive Testing & Verification
- **Unit Tests**: Execute Vitest suite to verify `ToodledoClient` logic and coverage.
- **Integration/E2E Tests**: (Optional/Later) Test the `stdio` communication flow between a mock MCP client and the server.

## Critical Files
- `src/client.ts`: The core API communication layer.
- `src/index.ts`: The MCP server interface and tool definitions.
- `src/types.ts`: Centralized domain models.
- `vitest.config.ts`: Testing configuration.

## Verification Plan
- **Test Coverage**: Run `vitest run --coverage` and ensure coverage for `src/client.ts` is $>95\%$.
- **Functionality**: Validate all MCP tools respond correctly to valid and invalid inputs.
- **Resilience**: Verify that the client correctly handles expired tokens via the refresh flow.
