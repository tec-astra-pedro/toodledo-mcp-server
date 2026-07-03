# OAuth2 Authorization Flow + Client/Host Setup Docs

## Context

`ToodledoClient` can only refresh an access token if it's handed a
`TOODLEDO_REFRESH_TOKEN` up front (`src/client.ts:43-49`) — there's no way
to *obtain* that first token today. Worse, Toodledo's `token.php` rotates
the refresh token on every use and invalidates the old one immediately
(confirmed from the API docs); `refreshAccessToken()` updates
`this.refreshToken` in memory (`src/client.ts:67-68`) but never persists
it, so the very first refresh after a process restart breaks auth silently
— the `.env` value is now stale. Since MCP hosts (Claude Desktop, Claude
Code) spawn a fresh server process per session, this would bite almost
immediately.

This plan adds a one-command, browser-based authorization flow
(`npm run auth`) that gets the initial token and wires the running server
to keep itself authorized indefinitely by persisting each rotated refresh
token to a dedicated token file. It also documents how to register a
Toodledo app and wire the server into Claude Desktop and Claude Code.

Decisions already made with Pedro:
- Token persistence: a dedicated gitignored token file, separate from
  `.env` (`.env` keeps only the static `TOODLEDO_CLIENT_ID`/`SECRET`).
- The running client will persist rotated refresh tokens automatically
  (fixes the restart bug as part of this work).
- Authorization uses a local loopback HTTP server + auto-opened browser
  (not manual code copy/paste).

## New files

**`src/oauth.ts`** — shared OAuth2 token-endpoint calls (both grant types
hit `POST /3/account/token.php` with HTTP Basic auth of
`clientId:clientSecret`, per `src/client.ts:51-66`):
- `exchangeAuthorizationCode(credentials, code, redirectUri): Promise<TokenResponse>` (new — `grant_type=authorization_code`)
- `refreshAccessToken(credentials, refreshToken): Promise<TokenResponse>` (extracted from `ToodledoClient.refreshAccessToken`'s existing request-building logic, minus the instance-state mutation)

**`src/tokenStore.ts`** — persistence for the rotating refresh token:
- `interface TokenStore { read(): string | null; write(refreshToken: string): void }`
- `createFileTokenStore(path?: string): TokenStore` — default path resolves
  to `<repo-root>/.toodledo-token.json`, derived from
  `import.meta.url` (not `process.cwd()`) so it's stable no matter what
  working directory the MCP host launches the process from. Overridable
  via `TOODLEDO_TOKEN_PATH` for tests/CI.
- Plain JSON shape: `{ "refreshToken": "..." }`.

**`src/authorize.ts`** — the `npm run auth` CLI entry point:
1. Load `TOODLEDO_CLIENT_ID`/`TOODLEDO_CLIENT_SECRET` via existing dotenv
   pattern; exit with a clear message (pointing at the Toodledo app
   registration page) if missing.
2. Build the authorize URL (`https://api.toodledo.com/3/account/authorize.php`)
   with `response_type=code`, `client_id`, a random `state`
   (`crypto.randomBytes`), `scope` (default `"basic tasks notes outlines lists write"`,
   overridable via `TOODLEDO_SCOPE` — verify the folders/outlines mapping
   against a live account during testing), and `redirect_uri` (default
   `http://127.0.0.1:8585/callback`, overridable via `TOODLEDO_REDIRECT_URI`).
3. Start a short-lived `http.createServer` on the parsed port to catch the
   redirect; print the URL and best-effort auto-open it (`open` on darwin,
   `start` on win32, `xdg-open` on linux via `child_process`), falling back
   to "open this URL manually" output if that fails.
4. On callback: validate `state`, extract `code` (or print Toodledo's
   `error` param and exit 1).
5. Call `exchangeAuthorizationCode` from `src/oauth.ts`, write the returned
   refresh token via `tokenStore.write(...)`.
6. Print a success message plus the Claude Desktop/Code config snippets
   (see README below) so the terminal output alone is enough to finish
   setup.

## Modified files

**`src/client.ts`**
- `ToodledoClient` constructor accepts an optional `TokenStore` (default
  `createFileTokenStore()`), consistent with the existing
  dependency-injection style used for testability (see `createServer(client)`
  from ADR 0002).
- `ensureAuthenticated()`: if there's no in-memory `refreshToken`, fall back
  to `tokenStore.read()` before giving up (today it just throws — update
  the error message to mention `npm run auth`).
- `refreshAccessToken()`: delegate the HTTP call to `oauth.ts`'s
  `refreshAccessToken`, then persist the newly-issued refresh token via
  `tokenStore.write(...)` in addition to updating `this.refreshToken`.
- Explicit `credentials.refreshToken` (e.g. from `TOODLEDO_REFRESH_TOKEN`,
  kept for backwards compatibility/tests) still takes precedence over the
  store on construction.

**`src/index.ts`**
- `main()`: stop treating `TOODLEDO_REFRESH_TOKEN` as required-ish; the
  client can now source it from the token store. Keep the env var as an
  optional override.

**`package.json`**
- Add `"auth": "node --loader ts-node/esm src/authorize.ts"` (mirrors the
  existing `"dev"` script's execution style).

**`.gitignore`**
- Add `.toodledo-token.json`.

## New docs

**`.env.example`** — `TOODLEDO_CLIENT_ID`, `TOODLEDO_CLIENT_SECRET`, and
commented-out optional overrides (`TOODLEDO_REDIRECT_URI`,
`TOODLEDO_SCOPE`, `TOODLEDO_TOKEN_PATH`).

**`README.md`** — expand with:
1. Register an app at https://api.toodledo.com/3/account/index.php,
   registering `http://127.0.0.1:8585/callback` as the redirect URI.
2. Copy `.env.example` to `.env`, fill in client id/secret.
3. `npm install && npm run build`
4. `npm run auth` — walks through the browser consent flow.
5. **Add to Claude Desktop**: edit `claude_desktop_config.json`
   (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`;
   Windows: `%APPDATA%\Claude\claude_desktop_config.json`), add under
   `mcpServers`:
   ```json
   {
     "mcpServers": {
       "toodledo": {
         "command": "node",
         "args": ["/absolute/path/to/toodledo-mcp-server/build/index.js"],
         "env": {
           "TOODLEDO_CLIENT_ID": "...",
           "TOODLEDO_CLIENT_SECRET": "..."
         }
       }
     }
   }
   ```
   (env vars are passed directly rather than relied on via `.env`, since
   the Desktop app's working directory when spawning the process isn't
   guaranteed to be the project root).
6. **Add to Claude Code**:
   `claude mcp add toodledo -s user -e TOODLEDO_CLIENT_ID=... -e TOODLEDO_CLIENT_SECRET=... -- node /absolute/path/to/toodledo-mcp-server/build/index.js`
   (`-s user` scope so it's available across projects and isn't written to
   a committable `.mcp.json`).

**`docs/adr/0003-oauth-authorization-and-token-persistence-plan.md`** — copy
of this finalized plan, per the project's ADR convention.

## Testing

- `src/oauth.ts`: unit tests via `msw` (same pattern as `client.test.ts`)
  for both grant types, including the error path.
- `src/tokenStore.ts`: unit tests for read/write against a temp path
  (`TOODLEDO_TOKEN_PATH` override), including "file doesn't exist yet"
  returning `null`.
- `src/client.ts`: extend `client.test.ts` — construction falls back to
  the token store when no `refreshToken` credential is given; a successful
  refresh calls `tokenStore.write` with the new token; explicit
  `credentials.refreshToken` still wins over the store.
- `src/authorize.ts`: keep the interactive/network glue (open browser,
  listen for one HTTP request) thin and manually verified rather than unit
  tested — extract the pure pieces (authorize-URL construction, state
  validation) into testable functions where reasonable, matching how
  `main()` in `src/index.ts` was handled in ADR 0002.
- `npm run build && npm test` must stay green (mirrors CI's
  `build-and-test` check).

## Verification (manual, end-to-end)

1. Register a real Toodledo app, populate `.env`.
2. Run `npm run auth`; confirm browser opens, consent completes, terminal
   shows success, and `.toodledo-token.json` is created.
3. Run `npm run dev` (or `npm start` after `npm run build`) and drive a
   tool call (e.g. via the existing `InMemoryTransport`-based test pattern,
   or a real MCP client) to confirm tasks load using the persisted token.
4. Kill and restart the server process; confirm it still authenticates
   successfully without re-running `npm run auth` (proves the rotation fix
   works across restarts).
5. Add the server to Claude Desktop per the README snippet, restart
   Desktop, confirm Toodledo tools appear and a sample call (e.g. list
   tasks) succeeds.
6. Add the server to Claude Code via the documented `claude mcp add`
   command, confirm `claude mcp list` shows it and a sample tool call
   succeeds.

## Git workflow

Feature branch off `main`, single PR, commits split by concern:
1. `oauth.ts` + `tokenStore.ts` + `client.ts` changes + tests (the
   rotation-persistence fix)
2. `authorize.ts` + `package.json` script + `.gitignore` entry (the CLI)
3. `.env.example` + README + ADR 0003 (docs) — **per your global
   instructions, I'll show you the diff and get explicit confirmation
   before committing anything that touches agent-instruction files; README
   and ADRs aren't `CLAUDE.md` so they're not gated by that rule, but I'll
   still show the docs commit before pushing.**

CI (`build-and-test`) must pass before the PR is mergeable; PR is opened
for your review, not auto-merged.

---

## Implementation notes (added at completion, 2026-07-02)

The plan above was executed as written, with these discoveries and
additions made along the way:

- **dotenv v17 corrupts the stdio transport.** `dotenv.config()` logs
  "injected env" to stdout by default as of v17; for a stdio MCP server
  stdout must carry only JSON-RPC. Both call sites now pass
  `{ quiet: true }`.
- **The test suite was destroying the live refresh token.** Tests that
  constructed a `ToodledoClient` without injecting a `TokenStore` fell back
  to the real file store, and every mocked refresh overwrote
  `.toodledo-token.json` — unrecoverable, since Toodledo rotates refresh
  tokens. `vitest.setup.ts` now points `TOODLEDO_TOKEN_PATH` at a temp file
  for every test run.
- **Stale in-memory token recovery.** On a failed refresh the client now
  re-reads the store and retries once if it holds a different token, and
  otherwise drops the dead token so a later call can recover without a
  process restart.
- **Live E2E testing (`npm run e2e`, `scripts/e2e.ts`) found 8 of the 12
  mutating tools broken** despite a green unit suite: Toodledo's write
  endpoints take JSON-encoded array form fields (`tasks=[...]`,
  `notes=[...]`, `lists=[...]`), folders use `name` (not `title`), list IDs
  are hex strings (not numbers), lists require `ref` on add and `version`
  on edit, and `lists/get.php` returns a literal `null` body for an empty
  account. Per-item failures arrive inline in HTTP 200 responses
  (`{errorCode, errorDesc}`) and are now surfaced as tool errors.
- **Scope note:** the default scope `basic tasks notes outlines lists write`
  was verified against a live account; folder operations are covered
  without a dedicated `folders` scope.
