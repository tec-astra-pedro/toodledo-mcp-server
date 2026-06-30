import axios, { type AxiosInstance } from 'axios';
import * as dotenv from 'dotenv';

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

  constructor(credentials: ToodledoCredentials) {
    this.credentials = credentials;
    this.refreshToken = credentials.refreshToken || null;
    this.client = axios.create({
      baseURL: this.baseUrl,
    });
  }

  /**
   * Ensures we have a valid access token.
   * If not, it attempts to refresh the token using the refresh token.
   */
  private async ensureAuthenticated(): Promise<void> {
    if (this.accessToken) return;

    if (!this.refreshToken) {
      throw new Error('No refresh token available. Manual authentication required.');
    }

    await this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<void> {
    console.error(`Refreshing Toodledo access token using refresh token...`);

    // Basic Auth for OAuth2 exchange: Client ID and Secret encoded in Base64
    const authHeader = Buffer.from(`${this.credentials.clientId}:${this.credentials.clientSecret}`).toString('base64');

    try {
      const response = await axios.post<TokenResponse>(
        `${this.baseUrl}/account/token.php`,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken!,
        }),
        {
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      this.accessToken = response.data.access_token;
      // Toodledo refresh tokens are single-use according to our research
      this.refreshToken = response.data.refresh_token;
      console.error(`Token refreshed successfully. New access token: ${this.accessToken?.substring(0, 8)}...`);
    } catch (error: any) {
      console.error('Failed to refresh Toodledo token:', error.response?.data || error.message);
      throw new Error('Authentication failed.');
    }
  }

  /**
   * A wrapper around axios that automatically handles authentication and retries on 401.
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
        console.error('Access token expired. Attempting one-time refresh...');
        await this.refreshAccessToken();
        // Retry the request once with the new token
        const retryResponse = await this.client.request<T>({
          ...config,
          headers: {
            ...config.headers,
            Authorization: `Bearer ${this.accessToken}`,
          },
        });
        return retryResponse.data;
      }
      throw error;
    }
  }

  // --- API Methods (To be implemented) ---

  async getTasks() {
    return this.request<any>({ method: 'GET', url: '/tasks/get.php' });
  }

  async addTask(title: string) {
    return this.request<any>({
      method: 'POST',
      url: '/tasks/add.php',
      data: new URLSearchParams({ title }),
    });
  }
}
