import axios, { type AxiosInstance } from 'axios';
import * as dotenv from 'dotenv';
import type { TokenStore } from './tokenStore.js';
import { createFileTokenStore } from './tokenStore.js';
import { refreshToken as refreshAccessTokenHttp } from './oauth.js';
import type {
  ToodledoTask,
  ToodledoNote,
  ToodledoList,
  ToodledoFolder,
  TaskCreateRequest,
  NoteCreateRequest,
  ListCreateRequest
} from './types.js';

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

  /**
   * @param credentials App credentials; an explicit `refreshToken` here takes
   *   precedence over the token store.
   * @param tokenStore Where rotated refresh tokens are persisted. Defaults to
   *   the file-backed store at the project root; inject a mock in tests so
   *   they never touch the real token file.
   */
  constructor(credentials: ToodledoCredentials, tokenStore?: TokenStore) {
    this.credentials = credentials;
    // Explicit credential takes precedence over the store on construction.
    this.refreshToken = credentials.refreshToken ?? null;
    this.tokenStore = tokenStore ?? createFileTokenStore();
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
   */
  async getTasks(params?: any): Promise<ToodledoTask[]> {
    return this.request<ToodledoTask[]>({ method: 'GET', url: '/tasks/get.php', params });
  }

  /** Create a task and return it with its assigned id. */
  async addTask(data: TaskCreateRequest): Promise<ToodledoTask> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/tasks/add.php',
      data: new URLSearchParams({ tasks: JSON.stringify([data]) }),
    });
    return this.unwrapItem<ToodledoTask>(res);
  }

  /** Update fields of an existing task and return the edited task. */
  async editTask(id: number, data: Partial<TaskCreateRequest>): Promise<ToodledoTask> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/tasks/edit.php',
      data: new URLSearchParams({ tasks: JSON.stringify([{ ...data, id }]) }),
    });
    return this.unwrapItem<ToodledoTask>(res);
  }

  /** Delete tasks by id; returns one `{id}` entry per deleted task. */
  async deleteTask(ids: number[]): Promise<any> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/tasks/delete.php',
      data: new URLSearchParams({ tasks: JSON.stringify(ids) }),
    });
    return this.unwrapItems(res);
  }

  // --- Notes ---

  /** Fetch notes. `params` maps to notes/get.php (`after`/`before`, `id`, `start`/`num`). */
  async getNotes(params?: any): Promise<ToodledoNote[]> {
    return this.request<ToodledoNote[]>({ method: 'GET', url: '/notes/get.php', params });
  }

  /** Create one or more notes; returns them with assigned ids, in submission order. */
  async addNote(data: NoteCreateRequest): Promise<ToodledoNote[]> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/notes/add.php',
      data: new URLSearchParams({ notes: JSON.stringify(data.notes) } as any),
    });
    return this.unwrapItems<ToodledoNote>(res);
  }

  /** Update fields (`title`, `text`, `folder`) of an existing note. */
  async editNote(id: number, data: Partial<ToodledoNote>): Promise<ToodledoNote[]> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/notes/edit.php',
      data: new URLSearchParams({ notes: JSON.stringify([{ ...data, id }]) }),
    });
    return this.unwrapItems<ToodledoNote>(res);
  }

  /** Delete a single note by id. */
  async deleteNote(id: number): Promise<any> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/notes/delete.php',
      data: new URLSearchParams({ notes: JSON.stringify([id]) } as any),
    });
    return this.unwrapItems(res);
  }

  // --- Lists ---

  /** Fetch lists. `params` maps to lists/get.php (`after`/`before`, `id`, `start`/`num`). */
  async getLists(params?: any): Promise<ToodledoList[]> {
    // Toodledo returns a literal null body when the account has no lists.
    const res = await this.request<ToodledoList[]>({ method: 'GET', url: '/lists/get.php', params });
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
    return this.unwrapItem<ToodledoList>(res);
  }

  /**
   * Update fields of an existing list.
   * @throws when the list does not exist (its `version` cannot be resolved).
   */
  async editList(id: string, data: Partial<ToodledoList>): Promise<ToodledoList> {
    // `version` is mandatory on edit (conflict detection) — fetch it if the
    // caller didn't supply one.
    let version = (data as any).version;
    if (version === undefined) {
      const existing = await this.getLists({ id });
      version = existing.find((l: any) => l.id === id)?.version;
      if (version === undefined) {
        throw new Error(`List ${id} not found — cannot determine its version for editing.`);
      }
    }
    const res = await this.request<any>({
      method: 'POST',
      url: '/lists/edit.php',
      data: new URLSearchParams({ lists: JSON.stringify([{ ...data, id, version }]) }),
    });
    return this.unwrapItem<ToodledoList>(res);
  }

  /** Delete a single list by its hex-string id. */
  async deleteList(id: string): Promise<any> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/lists/delete.php',
      data: new URLSearchParams({ lists: JSON.stringify([id]) }),
    });
    return this.unwrapItems(res);
  }

  // --- Folders ---

  /** Fetch all folders (folders/get.php takes no filter parameters). */
  async getFolders(params?: any): Promise<ToodledoFolder[]> {
    return this.request<ToodledoFolder[]>({ method: 'GET', url: '/folders/get.php', params });
  }

  /** Create a folder and return it with its assigned id. */
  async addFolder(name: string, isPrivate?: number): Promise<ToodledoFolder> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/folders/add.php',
      data: new URLSearchParams({ name, ...(isPrivate !== undefined ? { private: String(isPrivate) } : {}) }),
    });
    return this.unwrapItem<ToodledoFolder>(res);
  }

  /** Update fields (`name`, `private`, `archived`) of an existing folder. */
  async editFolder(id: number, data: Partial<ToodledoFolder>): Promise<ToodledoFolder> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/folders/edit.php',
      data: new URLSearchParams({ id: id.toString(), ...data as any } as any),
    });
    return this.unwrapItem<ToodledoFolder>(res);
  }

  /** Delete a single folder by id. */
  async deleteFolder(id: number): Promise<any> {
    const res = await this.request<any>({
      method: 'POST',
      url: '/folders/delete.php',
      data: new URLSearchParams({ id: id.toString() } as any),
    });
    return this.unwrapItems(res);
  }
}
