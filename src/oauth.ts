import axios from 'axios';
import type { TokenResponse, ToodledoCredentials } from './client.js';

const TOKEN_URL = '/3/account/token.php';

/**
 * Build the HTTP Basic auth header for OAuth2 credential verification.
 */
function buildAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

interface OAuthOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
}

/**
 * POST /3/account/token.php with HTTP Basic auth of clientId:clientSecret.
 * Used for both `authorization_code` and `refresh_token` grant types.
 */
export async function callTokenEndpoint(
  credentials: ToodledoCredentials,
  params: URLSearchParams,
  options: OAuthOptions = {}
): Promise<TokenResponse> {
  const baseUrl = options.baseUrl ?? 'https://api.toodledo.com';
  const response = await axios.post<TokenResponse>(
    `${baseUrl}${TOKEN_URL}`,
    params,
    {
      headers: {
        Authorization: buildAuthHeader(credentials.clientId, credentials.clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded',
        ...options.headers,
      },
    }
  );
  return response.data;
}

/**
 * Exchange an authorization code for a token pair.
 */
export async function exchangeAuthorizationCode(
  credentials: ToodledoCredentials,
  code: string,
  redirectUri: string
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  return callTokenEndpoint(credentials, params);
}

/**
 * Refresh an access token using a refresh token.
 */
export async function refreshToken(
  credentials: ToodledoCredentials,
  currentRefreshToken: string
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: currentRefreshToken,
  });
  return callTokenEndpoint(credentials, params);
}
