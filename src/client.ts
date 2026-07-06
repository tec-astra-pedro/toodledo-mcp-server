import axios, { type AxiosInstance } from 'axios';
import * as dotenv from 'dotenv';
import type { TokenStore } from './tokenStore.js';
import { createFileTokenStore } from './tokenStore.js';
import { refreshToken as refreshAccessTokenHttp } from './oauth.js';
import { ResponseCache } from './cache.js';
import type {
  ToodledoTask,
  ToodledoNote,
  ToodledoList,
  ToodledoFolder,
  TaskCreateRequest,
  NoteCreateRequest,
  ListCreateRequest
} from './types.js';

/**
 * Validator field names for each collection type — the `lastedit_*` and
 * `lastdelete_*` timestamps returned by `/account/get.php`. Used both to
 * validate cached collections against drift and to stamp fresh entries.
 */
const VALIDATORS_BY_URL = {
  '/tasks/': ['lastedit_task', 'lastdelete_task'],
  '/notes/': ['lastedit_note', 'lastdelete_note'],
  '/lists/': ['lastedit_list'],
  '/folders/': ['lastedit_folder'],
} as const;

type ValidatorPrefix = keyof typeof VALIDATORS_BY_URL;

/** URL prefixes that also invalidate tasks and notes on write. */
const CROSSTYPE_INVALIDATION_PREFIXES = ['/lists/', '/folders/'];

/** Maximum age of a cached account snapshot before revalidation is required (30s). */
const ACCOUNT_INFO_MAX_AGE_MS = 30_000;

// quiet: dotenv v17 logs "injected env" to stdout by default, which corrupts
// the stdio JSON-RPC transport
dotenv.config({ quiet: true });

/**
 * OAuth2 app credentials from Toodledo app registration
 * (https://api.toodledo.com/3/account/index.php). The optional
 * `refreshToken` overrides the token store — mainly useful for tests.
 */
export interface ToodledoCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
}

/**
 * Response of POST /3/account/token.php. Access tokens live ~2 hours;
 * every response also rotates the refresh token, immediately invalidating
 * the previous one — which is why rotations must be persisted.
 */
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Client for the Toodledo API v3.
 *
 * Handles OAuth2 access-token lifecycle transparently: tokens are minted
 * lazily from a refresh token (taken from the credentials or, failing that,
 * the token store), rotated refresh tokens are persisted back to the store,
 * and 401 responses trigger one refresh-and-retry.
 */
export class ToodledoClient {
  private readonly baseUrl = 'https://api.toodledo.com/3';
  private client: AxiosInstance;
  private credentials: ToodledoCredentials;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenStore: TokenStore;
  private cache: ResponseCache;

  /**
   * @param credentials App credentials; an explicit `refreshToken` here takes
   *   precedence over the token store.
   * @param tokenStore Where rotated refresh tokens are persisted. Defaults to
   *   the file-backed store at the project root; inject a mock in tests so
   *   they never touch the real token file.
   * @param cache In-memory response cache for GET endpoints. Honors
   *   `TOODLEDO_CACHE_TTL` (seconds) and disables entirely when 0; default is
   *   `new ResponseCache()`. Inject a mock or TTL=0 cache in tests so cached
   *   reads don't trigger unhandled `/account/get.php` requests.
   */
  constructor(credentials: ToodledoCredentials, tokenStore?: TokenStore, cache?: ResponseCache) {
    this.credentials = credentials;
    // Explicit credential takes precedence over the store on construction.
    this.refreshToken = credentials.refreshToken ?? null;
    this.tokenStore = tokenStore ?? createFileTokenStore();
    this.cache = cache ?? new ResponseCache();
    this.client = axios.create({
      baseURL: this.baseUrl,
    });
  }

  /**
   * Make sure an access token is in hand before a request goes out, minting
   * one from the refresh token (credential first, then token store) if
   * needed. Throws with a pointer to `npm run auth` when no token exists.
   */
  private async ensureAuthenticated(): Promise<void> {
    if (this.accessToken) return;
    if (!this.refreshToken) {
      // Fall back to the token store — may be populated from a prior session.
      const stored = await this.tokenStore.read();
      if (stored) {
        this.refreshToken = stored;
      } else {
        throw new Error(
          'No refresh token available. Run `npm run auth` to authorize this client, ' +
            'or set TOODLEDO_REFRESH_TOKEN in the environment.'
        );
      }
    }
    await this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<void> {
    let response: TokenResponse | null = null;
    // At most two attempts: the in-memory token may be stale — another
    // process (or a re-run of `npm run auth`) may have rotated it and
    // persisted a newer one — so on failure re-read the store and retry once
    // with the stored token before giving up.
    for (let attempt = 0; response === null; attempt++) {
      const attempted = this.refreshToken!;
      try {
        response = await refreshAccessTokenHttp(this.credentials, attempted);
      } catch (error: any) {
        const stored = attempt === 0 ? await this.tokenStore.read().catch(() => null) : null;
        if (stored && stored !== attempted) {
          this.refreshToken = stored;
          continue;
        }
        // Drop the dead token so a later call re-reads the store instead of
        // retrying a token that Toodledo has already invalidated.
        this.accessToken = null;
        this.refreshToken = null;
        throw new Error(`Authentication failed: ${error.message}`);
      }
    }

    this.accessToken = response.access_token;
    this.refreshToken = response.refresh_token;
    // Persist the rotated refresh token so it survives process restarts. A
    // persistence failure must not be treated as an auth failure: Toodledo
    // has already invalidated the previous token, so discarding the new one
    // would break authentication until the user re-runs `npm run auth`.
    try {
      this.tokenStore.write(response.refresh_token);
    } catch (err: any) {
      console.error(`Warning: could not persist rotated refresh token: ${err.message}`);
    }
  }

  /**
   * Execute an authenticated request. On a 401 (expired access token) the
   * token is refreshed and the request retried once.
   */
  private async request<T>(config: any): Promise<T> {
    await this.ensureAuthenticated();
    try {
      const response = await this.client.request<T>({
        ...config,
        headers: {
          ...config.headers,
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401 && this.refreshToken) {
        await this.refreshAccessToken();
        return this.request<T>({
          ...config,
          headers: {
            ...config.headers,
            Authorization: `Bearer ${this.accessToken}`,
          },
        });
      }
      throw error;
    }
  }

  // --- Caching integration ---

  /**
   * Fetch the account info from `/account/get.php`. Returns the account object
   * including `lastedit_*`/`lastdelete_*` timestamps used for cache validation.
   * Cached itself with a short TTL (~30s, capped to cache.ttlMs) so bursts of
   * validations cost at most 2 calls/minute. Not exposed as an MCP tool —
   * internal only.
   */

  async getAccountInfo(): Promise<any> {
    const key = ResponseCache.key('/account/get.php');
    if (this.cache.enabled) {
      const fresh = this.cache.getFresh(key, Math.min(ACCOUNT_INFO_MAX_AGE_MS, this.cache.ttlMs));
      if (fresh) return fresh.data;
    }
    const gen = this.cache.generation;
    const data = await this.request<any>({ method: 'GET', url: '/account/get.php' });
    ToodledoClient.checkItem(data);
    if (this.cache.enabled && this.cache.generation === gen) {
      this.cache.set(key, data);
    }
    return data;
  }

  /**
   * Read path with caching + validation: serves cached data when fresh, or
   * revalidates via getAccountInfo() against the entry's stored validator
   * values (tasks: lastedit_task+lastdelete_task; notes: lastedit_note+...;
   * etc.). Returns the cached/stale-then-freshly-fetched collection.
   *
   * NOTE: The returned data is shared with internal cache state — do not mutate it.
   */
  private async cachedGet<T>(url: string, params?: any): Promise<T> {
    const urlPrefix = this.deriveUrlPrefix(url);
    if (!urlPrefix) return this.request<T>({ method: 'GET', url, params });

    // Cache disabled → direct request. ADR item 14: this is the only disabled gate;
    // the later `this.cache.enabled &&` guard on cache.set was redundant and has been removed.
    if (!this.cache.enabled) return this.request<T>({ method: 'GET', url, params });

    const validators = VALIDATORS_BY_URL[urlPrefix];
    const key = ResponseCache.key(url, params);

    const existing = this.cache.get(key);

    // Fresh entry within trust window → serve without network I/O. No account
    // or collection call needed. ADR item 8: avoid double cost on cold/warm path.
    if (existing) {
      const fresh = this.cache.getFresh(key);
      if (fresh) return fresh.data;
    }

    // Cold miss (no cached entry at all) → fetch collection directly without
    // /account/get.php. Stamp with empty validators; subsequent stale hits will
    // then call /account/get.php for real validator comparison. ADR item 8.
    if (!existing) {
      const gen = this.cache.generation;
      const data = await this.request<T>({ method: 'GET', url, params });
      ToodledoClient.checkItem(data);
      if (this.cache.generation === gen) {
        this.cache.set(key, data, {});
      }
      return data;
    }

    // Stale hit (cached entry exists but past trust window) → need /account/get.php
    // to get current validators for comparison. ADR item 8: only incur this cost
    // when we have something to validate against.
    let accountInfo: any;
    try {
      accountInfo = await this.getAccountInfo();
    } catch (err: any) {
      console.warn(`ResponseCache: getAccountInfo() failed (${err.message}); bypassing for this read`);
      return this.request<T>({ method: 'GET', url, params });
    }

    const currentValidators = validators.reduce<Record<string, number>>((acc, v) => {
      acc[v] = accountInfo?.[v];
      return acc;
    }, {});

    // Any undefined validator → mismatch. Skip cache.set to avoid stamping a
    // degraded entry that would revalidate forever against an empty snapshot. ADR item 6.
    if (validators.some((v) => currentValidators[v] === undefined)) {
      const data = await this.request<T>({ method: 'GET', url, params });
      ToodledoClient.checkItem(data);
      return data;
    }

    // Stale hit with matching validators → re-stamp as fresh and serve.
    if (this.validatorsMatch(existing.validators, currentValidators)) {
      this.cache.refresh(existing);
      return existing.data;
    }

    // Validators mismatched (external change) → refetch collection. ADR item 6:
    // skip cache.set when any captured validator is undefined (handled above);
    // only stamp with fresh validators on successful revalidation. ADR item 15.
    const gen = this.cache.generation;
    const data = await this.request<T>({ method: 'GET', url, params });

    // Reject inline errors before caching.
    ToodledoClient.checkItem(data);

    if (this.cache.generation === gen) {
      this.cache.set(key, data, currentValidators);
    }
    return data;
  }

  /** True iff every stored validator matches the corresponding current value. An entry stamped with empty validators (cold miss) is treated as needing full revalidation. */
  private validatorsMatch(stored: Record<string, number>, current: Record<string, number>): boolean {
    if (Object.keys(stored).length === 0 && Object.keys(current).length > 0) return false;
    return Object.keys(stored).every(
      (k) => stored[k] !== undefined && stored[k] === current[k]
    );
  }

  /** Derive the collection URL prefix from a full Toodledo API path by matching against VALIDATORS_BY_URL keys. Returns null if no match found. */
  private deriveUrlPrefix(url: string): ValidatorPrefix | null {
    for (const prefix of Object.keys(VALIDATORS_BY_URL)) {
      if (url.startsWith(prefix)) return prefix as ValidatorPrefix;
    }
    return null;
  }

  /**
   * Invalidate cached collection data after a successful write. Invalidates by
   * URL prefix, plus cross-type rules: folder/list writes also invalidate
   * tasks and notes (deletion unassigns server-side). Always drops the cached
   * account snapshot since its lastedit values just changed.
   */
  private invalidateOnWrite(urlPrefix: ValidatorPrefix): void {
    if (!this.cache.enabled) return;
    // Drop the account info first — its validator values just changed.
    this.cache.delete(ResponseCache.key('/account/get.php'));
    // Invalidate by URL prefix (e.g. /tasks/ → all task entries).
    this.cache.invalidatePrefix(urlPrefix);
    // Cross-type: folder/list writes also unassign tasks and notes server-side.
    if (CROSSTYPE_INVALIDATION_PREFIXES.includes(urlPrefix)) {
      for (const cross of ['/tasks/', '/notes/']) {
        this.cache.invalidatePrefix(cross);
      }
    }
  }

  // --- API Methods ---

  // Toodledo's write endpoints (tasks/notes/lists) take a JSON-encoded array
  // form field and respond with HTTP 200 even when items fail — failures are
  // reported inline as { errorCode, errorDesc } objects. These helpers
  // surface such errors instead of returning them as data.

  private static checkItem(item: any): void {
    if (item && typeof item === 'object' && 'errorCode' in item) {
      throw new Error(`Toodledo error ${item.errorCode}: ${item.errorDesc}`);
    }
  }

  private unwrapItem<T>(response: any): T {
    const item = Array.isArray(response) ? response[0] : response;
    ToodledoClient.checkItem(item);
    return item;
  }

  private unwrapItems<T>(response: any): T[] {
    const items = Array.isArray(response) ? response : [response];
    for (const item of items) ToodledoClient.checkItem(item);
    return items;
  }

  /**
   * Fetch tasks. `params` maps directly to tasks/get.php query parameters
   * (`comp` 0/1/-1, `after`/`before` timestamps, `id`, `fields`,
   * `start`/`num`). Note: Toodledo prepends a summary object
   * (`{num, total}`) to the returned array.
   * NOTE: The returned data is shared with internal cache state — do not mutate it.
   */
  async getTasks(params?: any): Promise<ToodledoTask[]> {
    return this.cachedGet<ToodledoTask[]>('/tasks/get.php', params);
  }

  /** Create a task and return it with its assigned id. */
  async addTask(data: TaskCreateRequest): Promise<ToodledoTask> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/tasks/add.php',
      data: new URLSearchParams({ tasks: JSON.stringify([data]) }),
    });
    this.invalidateOnWrite('/tasks/');
    return this.unwrapItem<ToodledoTask>(res);
  }

  /** Update fields of an existing task and return the edited task. */
  async editTask(id: number, data: Partial<TaskCreateRequest>): Promise<ToodledoTask> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/tasks/edit.php',
      data: new URLSearchParams({ tasks: JSON.stringify([{ ...data, id }]) }),
    });
    this.invalidateOnWrite('/tasks/');
    return this.unwrapItem<ToodledoTask>(res);
  }

  /** Delete tasks by id; returns one `{id}` entry per deleted task. */
  async deleteTask(ids: number[]): Promise<any> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/tasks/delete.php',
      data: new URLSearchParams({ tasks: JSON.stringify(ids) }),
    });
    this.invalidateOnWrite('/tasks/');
    return this.unwrapItems(res);
  }

  // --- Notes ---

  /** Fetch notes. `params` maps to notes/get.php (`after`/`before`, `id`, `start`/`num`). NOTE: The returned data is shared with internal cache state — do not mutate it. */
  async getNotes(params?: any): Promise<ToodledoNote[]> {
    return this.cachedGet<ToodledoNote[]>('/notes/get.php', params);
  }

  /** Create one or more notes; returns them with assigned ids, in submission order. */
  async addNote(data: NoteCreateRequest): Promise<ToodledoNote[]> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/notes/add.php',
      data: new URLSearchParams({ notes: JSON.stringify(data.notes) } as any),
    });
    this.invalidateOnWrite('/notes/');
    return this.unwrapItems<ToodledoNote>(res);
  }

  /** Update fields (`title`, `text`, `folder`) of an existing note. */
  async editNote(id: number, data: Partial<ToodledoNote>): Promise<ToodledoNote[]> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/notes/edit.php',
      data: new URLSearchParams({ notes: JSON.stringify([{ ...data, id }]) }),
    });
    this.invalidateOnWrite('/notes/');
    return this.unwrapItems<ToodledoNote>(res);
  }

  /** Delete a single note by id. */
  async deleteNote(id: number): Promise<any> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/notes/delete.php',
      data: new URLSearchParams({ notes: JSON.stringify([id]) } as any),
    });
    this.invalidateOnWrite('/notes/');
    return this.unwrapItems(res);
  }

  // --- Lists ---

  /** Fetch lists. `params` maps to lists/get.php (`after`/`before`, `id`, `start`/`num`). NOTE: The returned data is shared with internal cache state — do not mutate it. */
  async getLists(params?: any): Promise<ToodledoList[]> {
    // Toodledo returns a literal null body when the account has no lists.
    const res = await this.cachedGet<ToodledoList[] | null>('/lists/get.php', params);
    return res ?? [];
  }

  /** Create a list and return it with its assigned (hex-string) id. */
  async addList(data: ListCreateRequest): Promise<ToodledoList> {
    // `ref` is mandatory on add (used by Toodledo for duplicate detection).
    const res = await this.request<any>({
      method: 'POST',
      url: '/lists/add.php',
      data: new URLSearchParams({ lists: JSON.stringify([{ ref: String(Date.now()), ...data }]) }),
    });
    this.invalidateOnWrite('/lists/');
    return this.unwrapItem<ToodledoList>(res);
  }

  /**
   * Update fields of an existing list.
   * @throws when the list does not exist (its `version` cannot be resolved).
   */
  async editList(id: string, data: Partial<ToodledoList>): Promise<ToodledoList> {
    // `version` is mandatory on edit (conflict detection) — fetch it if the
    // caller didn't supply one. Bypass cache so a cached stale snapshot doesn't
    // yield Toodledo error 914 when an external edit occurred within the trust window.
    let version = (data as any).version;
    if (version === undefined) {
      const existing: ToodledoList[] | null = await this.request<any>({ method: 'GET', url: '/lists/get.php', params: { id } });
      const normalized = Array.isArray(existing) ? existing : [];
      version = normalized.find((l: any) => l.id === id)?.version;
      if (version === undefined) {
        throw new Error(`List ${id} not found — cannot determine its version for editing.`);
      }
    }
    const res = await this.request<any>({
      method: 'POST',
      url: '/lists/edit.php',
      data: new URLSearchParams({ lists: JSON.stringify([{ ...data, id, version }]) }),
    });
    this.invalidateOnWrite('/lists/');
    return this.unwrapItem<ToodledoList>(res);
  }

  /** Delete a single list by its hex-string id. */
  async deleteList(id: string): Promise<any> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/lists/delete.php',
      data: new URLSearchParams({ lists: JSON.stringify([id]) }),
    });
    this.invalidateOnWrite('/lists/');
    return this.unwrapItems(res);
  }

  // --- Folders ---

  /** Fetch all folders (folders/get.php takes no filter parameters). NOTE: The returned data is shared with internal cache state — do not mutate it. */
  async getFolders(params?: any): Promise<ToodledoFolder[]> {
    return this.cachedGet<ToodledoFolder[]>('/folders/get.php', params);
  }

  /** Create a folder and return it with its assigned id. */
  async addFolder(name: string, isPrivate?: number): Promise<ToodledoFolder> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/folders/add.php',
      data: new URLSearchParams({ name, ...(isPrivate !== undefined ? { private: String(isPrivate) } : {}) }),
    });
    this.invalidateOnWrite('/folders/');
    return this.unwrapItem<ToodledoFolder>(res);
  }

  /** Update fields (`name`, `private`, `archived`) of an existing folder. */
  async editFolder(id: number, data: Partial<ToodledoFolder>): Promise<ToodledoFolder> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/folders/edit.php',
      data: new URLSearchParams({ id: id.toString(), ...data as any } as any),
    });
    this.invalidateOnWrite('/folders/');
    return this.unwrapItem<ToodledoFolder>(res);
  }

  /** Delete a single folder by id. */
  async deleteFolder(id: number): Promise<any> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/folders/delete.php',
      data: new URLSearchParams({ id: id.toString() } as any),
    });
    this.invalidateOnWrite('/folders/');
    return this.unwrapItems(res);
  }
}
