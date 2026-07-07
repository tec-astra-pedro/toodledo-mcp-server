# toodledo-mcp-server

An MCP (Model Context Protocol) server that gives your favorite LLM tools to
work with your [Toodledo](https://www.toodledo.com/) tasks, notes, lists, and
folders.

## Tools

| Area | Tools |
|---|---|
| Tasks | `get_tasks`, `add_task`, `edit_task`, `delete_task` |
| Notes | `get_notes`, `add_note`, `edit_note`, `delete_note` |
| Lists | `get_lists`, `add_list`, `edit_list`, `delete_list` |
| Folders | `get_folders`, `add_folder`, `edit_folder`, `delete_folder` |
| Misc | `ping` |

Note: Toodledo list IDs are hex strings (e.g. `"6a4726f3..."`), unlike the
numeric IDs used by tasks, notes, and folders.

## Setup

### 1. Register a Toodledo app

Create an app at <https://api.toodledo.com/3/account/index.php> and register
`http://127.0.0.1:8585/callback` as its redirect URI. This gives you a
Client ID and Client Secret.

### 2. Configure and build

```sh
cp .env.example .env      # fill in TOODLEDO_CLIENT_ID / TOODLEDO_CLIENT_SECRET
npm install
npm run build
```

### 3. Authorize (one time)

```sh
npm run auth
```

This opens your browser to Toodledo's consent screen and catches the redirect
on a short-lived local server. The resulting refresh token is saved to
`.toodledo-token.json` at the project root (gitignored). Toodledo rotates
refresh tokens on every use; the server persists each rotation back to this
file automatically, so a single `npm run auth` lasts indefinitely.

### 4. Add the server to your MCP host

**Claude Desktop** — edit `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`;
Windows: `%APPDATA%\Claude\claude_desktop_config.json`) and add under
`mcpServers`:

```json
{
  "mcpServers": {
    "toodledo": {
      "command": "node",
      "args": ["/absolute/path/to/toodledo-mcp-server/build/index.js"],
      "env": {
        "TOODLEDO_CLIENT_ID": "your_client_id",
        "TOODLEDO_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

Pass the credentials explicitly in `env` as shown — MCP hosts launch the
server from an arbitrary working directory, so it cannot find your `.env`
on its own. Restart Claude Desktop after editing.

**Claude Code**:

```sh
claude mcp add toodledo -s user \
  -e TOODLEDO_CLIENT_ID=your_client_id \
  -e TOODLEDO_CLIENT_SECRET=your_client_secret \
  -- node /absolute/path/to/toodledo-mcp-server/build/index.js
```

(`-s user` makes it available across all your projects without writing a
committable `.mcp.json`.)

## Development

```sh
npm run dev            # run from source (ts-node)
npm test               # unit tests (vitest; network mocked, token file isolated)
npm run test:coverage  # unit tests with coverage
npm run e2e            # live end-to-end check of every tool (see below)
```

`npm run e2e` spawns the built server over stdio and drives all 17 tools
against the real Toodledo API. Mutating tools only touch artifacts the run
creates itself (prefixed `E2E-TEST-`) and everything is deleted before exit.
It needs a populated `.env` and a valid `.toodledo-token.json`, so it is a
manual check — it does not run in CI.

### Caching

The server caches GET responses in memory to keep API call volume low —
Toodledo allows only 100 calls per access token, and an LLM session can
easily issue dozens of `get_tasks` calls while reasoning. The cache uses a
**60-second trust window** (entries served without network I/O within that
window) plus **timestamp validation**: stale entries are revalidated against
the account's `lastedit_*`/`lastdelete_task` stamps from `/account/get.php`,
so the cache stays exact even when edits happen in the Toodledo web app or
mobile client. Writes invalidate immediately (and folder/list deletions also
invalidate tasks and notes, since that unassigns them server-side), so tool
users always read their own writes.

**Worst-case external staleness:** ~90 seconds — 60 s trust window plus the
30 s cache TTL on the account snapshot itself. (Edits made through this
server invalidate instantly.)

To disable caching entirely, set `TOODLEDO_CACHE_TTL=0` in the environment;
every read then hits the network. (This is useful for debugging.)

If `TOODLEDO_CACHE_TTL` is set to a malformed value (e.g., not a number),
the server warns on stderr and falls back to the 60-second default instead
of silently disabling caching.

Design and decision records live in [`docs/adr/`](docs/adr/).
