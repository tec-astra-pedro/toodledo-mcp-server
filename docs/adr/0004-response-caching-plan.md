# ADR-0004: Smart Caching Layer for the Toodledo MCP Server

## Context

Toodledo's API allows only **100 calls per access token** (tokens last 2
hours ⇒ ~1,000 calls/hour ceiling), and its docs explicitly ask clients to
minimize call volume. An LLM session can easily issue dozens of `get_tasks`
calls while reasoning, most returning identical data. Toodledo's own
documented solution (`/3/account/doc_sync.php`) is timestamp validation:
`GET /3/account/get.php` returns `lastedit_task`, `lastdelete_task`,
`lastedit_note`, `lastdelete_note`, `lastedit_list`, `lastedit_folder` —
compare against values captured at cache time; unchanged means the cached
collection is still exact.

Decisions made with Pedro:
- **Strategy:** TTL trust window + `lastedit_*`/`lastdelete_*` validation
  (Toodledo's endorsed algorithm), not TTL-only.
- **Staleness bound for external edits:** ~60s trust window. Writes made
  *through this server* invalidate immediately, so tool users always read
  their own writes.

Branch/PR: `feature/response-cache`, stacked on
`feature/oauth-authorization` while PR #10 is open (retarget/rebase to
`main` once #10 merges); same branch+PR workflow.

## Design

All API traffic already flows through one choke point —
`ToodledoClient.request()` (src/client.ts) — so the cache hooks there
plus a type-level invalidation map. No handler or tool-schema changes; the
cache is invisible to `src/index.ts`.

### New file: `src/cache.ts` (already written — review and commit)

```typescript
export interface CacheOptions { ttlMs?: number; now?: () => number }

export class ResponseCache {
  // key: `${url}|${canonicalized params}` → { data, cachedAt, validators }
  static key(url, params?): string
  get(key): CacheEntry | undefined
  getFresh(key, maxAgeMs?): CacheEntry | undefined
  set(key, data, validators): void
  refresh(entry): void            // re-stamp validated entry as fresh
  delete(key): void
  invalidatePrefix(urlPrefix): void
  clear(): void
  get enabled(): boolean          // false when ttlMs <= 0
}
```

- Trust window: entry younger than `ttlMs` (default 60_000) → serve without
  any network I/O.
- Older entry → validation path (below) revalidates or evicts.
- `TOODLEDO_CACHE_TTL` env var (seconds) overrides; `0` disables caching
  entirely (every read goes to the network — escape hatch for debugging).
- Unbounded map is fine: keys are the handful of GET endpoints × params
  variants in one session; entries are refreshed in place.

### `src/client.ts` changes

1. **`getAccountInfo()`** — new public method, `GET /account/get.php`.
   Returns the account object including the `lastedit_*`/`lastdelete_*`
   fields. Cached itself with a short TTL (~30s) so a burst of validations
   costs at most 2 calls/minute. (Not exposed as an MCP tool — internal
   only, for now.)
2. **Read path** (a thin `cachedGet()` used by the five `get*` methods):
   - fresh hit (≤ trust window) → return cached data;
   - stale hit → `getAccountInfo()`, compare the entry's stored
     `lastedit_{type}` **and** `lastdelete_{type}` (deletes made in the
     Toodledo app do NOT bump `lastedit`) against current values; equal →
     re-stamp entry as fresh and return it; changed → fetch, restore cache;
   - miss → fetch and cache, stamping the entry with the current
     `lastedit`/`lastdelete` values from `getAccountInfo()`.
   - Validator mapping: tasks → `lastedit_task`+`lastdelete_task`; notes →
     `lastedit_note`+`lastdelete_note`; lists → `lastedit_list`; folders →
     `lastedit_folder`.
3. **Write path (read-your-writes guarantee):** on any successful POST,
   invalidate by URL prefix (`/tasks/` → tasks, etc.) and drop the cached
   account info (its lastedit values just changed). Cross-type effects:
   folder and list writes ALSO invalidate tasks and notes — deleting a
   folder unassigns its tasks/notes server-side, and a prefix-only
   invalidation would leave them cached with a dead folder id for up to
   the trust window. (Tasks/notes writes never mutate folders/lists, so no
   invalidation in the other direction.) `editList`'s internal version
   lookup (`getLists({id})`) participates in caching automatically — a
   nice free win for bulk list edits.
4. **Constructor:** accept an optional `ResponseCache` (same DI style as
   `TokenStore`); default `new ResponseCache()` honoring
   `TOODLEDO_CACHE_TTL`.

### Semantics to preserve

- `getLists()` null-body normalization stays intact (cache the normalized
  `[]` or normalize on exit — be consistent and test it).
- Inline-error unwrapping (`unwrapItem`/`unwrapItems`) is downstream of
  `request()` and unaffected.
- Different `params` are different cache keys (canonicalize by sorting
  keys) — `get_tasks {comp:0}` and `{comp:0, fields:'folder'}` never serve
  each other's data.
- 401-refresh retry happens beneath the cache; a cache hit performs no
  auth work at all.

## Docs

- **README:** short "Caching" paragraph under Development — default
  behavior, the worst-case staleness for edits made in the Toodledo app
  (~90s: 60s trust window + 30s account snapshot), and
  `TOODLEDO_CACHE_TTL=0` to disable.
- **ADR 0004** (`docs/adr/0004-response-caching-plan.md`): this plan,
  per the repo convention.
- CLAUDE.md is NOT touched (per standing rule, unless Pedro asks and
  confirms a diff separately).

## Testing

- `src/cache.test.ts`: unit tests for ResponseCache — trust-window hit,
  expiry, invalidatePrefix matching, TTL=0 disable, injected clock.
- `src/client.test.ts` additions (msw with request counters):
  1. two `getTasks()` calls within the window → exactly one HTTP request;
  2. stale entry + unchanged `lastedit_task`/`lastdelete_task` → account/get
     fired, tasks/get NOT fired, cached data returned;
  3. stale entry + bumped `lastdelete_task` → tasks/get re-fired (delete
     detection);
  4. `addTask()` then `getTasks()` → cache invalidated, fresh fetch
     (read-your-writes); `deleteFolder()` then `getTasks()` → tasks cache
     also invalidated (cross-type);
  5. `TOODLEDO_CACHE_TTL=0` → every read hits the network;
  6. distinct params → distinct cache entries.
- **Live E2E (`npm run e2e`)** runs unchanged and doubles as the
  invalidation acceptance test: every add/edit/delete is verified through
  an immediately-following `get_*`, which only passes if write
  invalidation works. Optionally append a cheap cache check (two
  back-to-back `get_folders` calls, assert both succeed).
- `npm run build && npm test` green before push (CI mirror).

## Verification

1. Unit suite green, including the new request-count tests.
2. `npm run e2e` → 17/17 with caching enabled (proves read-your-writes).
3. Manual spot check: run the server, call `get_tasks` twice within a
   minute, confirm the second call makes no HTTP request; edit a task in
   the Toodledo web app, wait >90s, confirm `get_tasks` reflects it.

## Out of scope (explicitly)

- Incremental sync with `modafter` (fetch-only-changed-records).
- Persistent (disk) cache across server restarts.
- Exposing `get_account` as an MCP tool.
