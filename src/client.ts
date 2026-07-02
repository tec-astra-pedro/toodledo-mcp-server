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
  ListCreateRequest,
  CommonResponse
} from './types.js';

dotenv.config();

export interface ToodledoCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class ToodledoClient {
  private readonly baseUrl = 'https://api.toodledo.com/3';
  private client: AxiosInstance;
  private credentials: ToodledoCredentials;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenStore: TokenStore;

  constructor(credentials: ToodledoCredentials, tokenStore?: TokenStore) {
    this.credentials = credentials;
    // Explicit credential takes precedence over the store on construction.
    this.refreshToken = credentials.refreshToken ?? null;
    this.tokenStore = tokenStore ?? createFileTokenStore();
    this.client = axios.create({
      baseURL: this.baseUrl,
    });
  }

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
    try {
      const response = await refreshAccessTokenHttp(this.credentials, this.refreshToken!);
      this.accessToken = response.access_token;
      this.refreshToken = response.refresh_token;
      // Persist the rotated refresh token so it survives process restarts.
      this.tokenStore.write(response.refresh_token);
    } catch (error: any) {
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

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

  async getTasks(params?: any): Promise<ToodledoTask[]> {
    return this.request<ToodledoTask[]>({ method: 'GET', url: '/tasks/get.php', params });
  }

  async addTask(data: TaskCreateRequest): Promise<ToodledoTask> {
    return this.request<ToodledoTask>({
      method: 'POST',
      url: '/tasks/add.php',
      data: new URLSearchParams({ ...data, task_id: '0' } as any),
    });
  }

  async editTask(id: number, data: Partial<TaskCreateRequest>): Promise<ToodledoTask> {
    return this.request<ToodledoTask>({
      method: 'POST',
      url: '/tasks/edit.php',
      data: new URLSearchParams({ ...data, id: id.toString() } as any),
    });
  }

  async deleteTask(ids: number[]): Promise<any> {
    return this.request<any>({
      method: 'POST',
      url: '/tasks/delete.php',
      data: new URLSearchParams({ ids: ids.join(',') } as any),
    });
  }

  // --- Notes ---
  async getNotes(params?: any): Promise<ToodledoNote[]> {
    return this.request<ToodledoNote[]>({ method: 'GET', url: '/notes/get.php', params });
  }

  async addNote(data: NoteCreateRequest): Promise<ToodledoNote[]> {
    return this.request<ToodledoNote[]>({
      method: 'POST',
      url: '/notes/add.php',
      data: new URLSearchParams({ notes: JSON.stringify(data.notes) } as any),
    });
  }

  async editNote(id: number, data: Partial<ToodledoNote>): Promise<ToodledoNote[]> {
    return this.request<ToodledoNote[]>({
      method: 'POST',
      url: '/notes/edit.php',
      data: new URLSearchParams({ id: id.toString(), ...data as any } as any),
    });
  }

  async deleteNote(id: number): Promise<any> {
    return this.request<any>({
      method: 'POST',
      url: '/notes/delete.php',
      data: new URLSearchParams({ notes: JSON.stringify([id]) } as any),
    });
  }

  // --- Lists ---
  async getLists(params?: any): Promise<ToodledoList[]> {
    return this.request<ToodledoList[]>({ method: 'GET', url: '/lists/get.php', params });
  }

  async addList(data: ListCreateRequest): Promise<ToodledoList> {
    return this.request<ToodledoList>({
      method: 'POST',
      url: '/lists/add.php',
      data: new URLSearchParams(data as any),
    });
  }

  async editList(id: number, data: Partial<ToodledoList>): Promise<ToodledoList> {
    return this.request<ToodledoList>({
      method: 'POST',
      url: '/lists/edit.php',
      data: new URLSearchParams({ id: id.toString(), ...data as any } as any),
    });
  }

  async deleteList(id: number): Promise<any> {
    return this.request<any>({
      method: 'POST',
      url: '/lists/delete.php',
      data: new URLSearchParams({ id: id.toString() } as any),
    });
  }

  // --- Folders ---
  async getFolders(params?: any): Promise<ToodledoFolder[]> {
    return this.request<ToodledoFolder[]>({ method: 'GET', url: '/folders/get.php', params });
  }

  async addFolder(title: string, description?: string): Promise<ToodledoFolder> {
    return this.request<ToodledoFolder>({
      method: 'POST',
      url: '/folders/add.php',
      data: new URLSearchParams({ title, description } as any),
    });
  }

  async editFolder(id: number, data: Partial<ToodledoFolder>): Promise<ToodledoFolder> {
    return this.request<ToodledoFolder>({
      method: 'POST',
      url: '/folders/edit.php',
      data: new URLSearchParams({ id: id.toString(), ...data as any } as any),
    });
  }

  async deleteFolder(id: number): Promise<any> {
    return this.request<any>({
      method: 'POST',
      url: '/folders/delete.php',
      data: new URLSearchParams({ id: id.toString() } as any),
    });
  }
}
