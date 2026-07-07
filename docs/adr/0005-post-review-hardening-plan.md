# 0005 — Post-review hardening: OAuth redirect override fix and caching correctness

Date: 2026-07-05
Status: Accepted (plan; implementation handed off)

## Context

Two review passes ran against `main` after the response-cache merge (PR #11):

1. A high-effort multi-angle code review of the caching diff
   (`1a559dc...d7e6dbe`): 8 finder angles, 14 candidates individually
   verified. Result: 7 CONFIRMED, 3 PLAUSIBLE, 4 REFUTED findings.
2. External reviewer feedback on `src/authorize.ts` surfaced a verified
   OAuth bug that earlier reviews missed: the `TOODLEDO_REDIRECT_URI`
   override is honored by the callback listener and the token exchange but
   never passed into the authorization URL, so overriding the port makes
   the flow impossible to complete (browser redirected to 8585, listener
   on the override port). The `EADDRINUSE` handler actively recommends
   this broken path.

Notable refutations worth recording so they aren't re-litigated:

- The documented ~90s worst-case external staleness bound **holds**. Any
  re-stamp at validation time `t` requires a pre-edit snapshot no older
  than 30s, so a re-stamped entry expires before `edit + 90s`; chained
  re-stamps cannot extend it.
- `VALIDATORS_BY_URL` is correct as written: Toodledo v3's
  `/account/get.php` exposes **no** `lastdelete_list`/`lastdelete_folder`
  fields, and the v3 note fields really are `lastedit_note`/
  `lastdelete_note` (the `*_notebook` names are v2-only). Externally
  deleted lists/folders therefore cannot be detected via account
  validators at all — Toodledo's answer is the separate
  `/lists/deleted.php` style endpoints, out of scope here.

## Decision

Fix everything verified, plus cheap cleanup, in **two PRs off `main`**:

### PR A — OAuth redirect override fix (`src/authorize.ts`)

1. Resolve `redirectUri` (`process.env.TOODLEDO_REDIRECT_URI ??
   DEFAULT_REDIRECT_URI`) once at the top of `runAuthorize()`; pass it to
   `buildAuthorizeUrl(...)` and derive `parsedRedirect` from the same
   value. All three uses (authorize URL, listener, token exchange) must
   agree.
2. Bind the callback server to loopback:
   `server.listen(port, parsedRedirect.hostname || '127.0.0.1', ...)`.
3. Test coverage in `src/authorize.test.ts` (pure pieces only, per the
   existing convention): `buildAuthorizeUrl` includes a supplied
   `redirectUri`.

### PR B — Caching correctness + cleanup (`src/client.ts`, `src/cache.ts`, tests)

Correctness (each with a regression test):

4. **TOCTOU write race**: `cachedGet` awaits the fetch then
   unconditionally `cache.set`s, clobbering a concurrent write's
   `invalidateOnWrite` with pre-write data stamped fresh (read-your-writes
   broken for a full TTL). Guard with a generation counter: bump it in
   `invalidateOnWrite`/`clear`; after the awaited fetch, only `set` if the
   generation observed before the fetch is unchanged. Same guard in
   `getAccountInfo`.
5. **`editList` stale version**: the internal `getLists({id})` version
   lookup now reads through the cache; an external edit within the trust
   window yields Toodledo error 914 where pre-cache code succeeded. Make
   the lookup bypass the cache (direct `request`).
6. **Vacuous validator matches**: `undefined` validator values (degraded
   account response) satisfy `validatorsMatch`, re-stamping stale entries
   forever. Treat any `undefined` (stored or current) as a mismatch and
   skip `set` when any captured validator is `undefined`.
7. **Inline errors cached on GET**: 200-wrapped `{errorCode, errorDesc}`
   bodies would be cached as collection data. Apply the existing
   `checkItem`-style guard to GET responses (including `getAccountInfo`)
   before caching; on error, throw instead of caching.
8. **Cold-miss double cost**: `cachedGet` spends `/account/get.php`
   before checking whether an entry exists, making cold sessions cost 2
   calls where uncached code cost 1. Check `cache.get(key)` first; on a
   true miss fetch the collection directly and stamp validators lazily
   (fetch account info only when a stale entry needs revalidation).
9. **Cache-key variants**: normalize inside `ResponseCache.key` — drop
   `null`/`undefined` param entries and stringify values so `{}` /
   omitted / `{comp: null}` / `5` vs `"5"` share entries (matches axios
   serialization).
10. **NaN TTL**: `Number.isFinite` check on the parsed
    `TOODLEDO_CACHE_TTL`; on malformed input warn on stderr and fall back
    to the 60s default instead of silently disabling.
11. **Silent prefix mismatch class**: derive the URL prefix inside
    `cachedGet`/`invalidateOnWrite` from the url via `VALIDATORS_BY_URL`
    keys (drop the separate `urlPrefix` parameter); type write-side
    prefixes as `keyof typeof VALIDATORS_BY_URL`.
12. **Aliasing hazard**: cached data is returned by reference; document
    the no-mutation contract in the `get*` method JSDoc (defensive
    cloning judged not worth the cost for current JSON.stringify-only
    consumers).
13. **AGENTS.md test rule**: the 7 cache-integration tests in
    `src/client.test.ts` construct `new ToodledoClient(credentials,
    undefined, cache)` — inject a mock `TokenStore` in each, per the
    standing rule.

Cleanup:

14. Remove dead `cache.enabled` re-checks inside `cachedGet`/
    `getAccountInfo` (an early return already handled disabled) and the
    unreachable no-validators branch (subsumed by item 11's derivation).
15. Simplify `validatorsMatch` (drop `as any`; plain
    `Object.keys(stored).every(...)` — folds into item 6's rewrite).
16. Name the account snapshot age cap (`ACCOUNT_INFO_MAX_AGE_MS = 30_000`).
17. Test hygiene: shared msw token-endpoint handler helper in
    `client.test.ts`; `vi.stubEnv` instead of hand-rolled env
    save/restore in `cache.test.ts`; replace the assertion-free
    "respects TTL=0" test (and its commented-out musings) with a real
    assertion of disabled-path behavior.

ADR 0005 (this file) lands in PR B.

## Out of scope (deliberate)

Behavior-changing efficiency ideas with real tradeoffs, deferred:

- Targeted account-snapshot invalidation (sentinel per collection instead
  of deleting the whole snapshot on every write).
- Cross-type invalidation only on deletes (adds/edits of folders/lists
  cannot unassign tasks/notes).
- In-flight request dedup (memoized promise) for concurrent identical GETs.
- Cache size caps / eviction (unbounded Map growth is immaterial at this
  project's scale).
- Delete detection for lists/folders via `/lists/deleted.php` (API
  limitation; no account validator exists).

## Verification

- `npm run build && npm test` green per commit (CI mirror); new
  regression tests for items 4–10.
- Live E2E `npm run e2e` → 17/17 before opening PR B (it changes
  `src/client.ts` request behavior — the standing rule applies).
- PR A manual check: `TOODLEDO_REDIRECT_URI=http://127.0.0.1:9999/callback
  npm run auth` completes end-to-end.
