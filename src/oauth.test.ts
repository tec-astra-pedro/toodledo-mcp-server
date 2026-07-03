import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import type { TokenResponse } from '../src/client.js';
import { exchangeAuthorizationCode, refreshToken } from '../src/oauth.js';

const server = setupServer();

beforeAll(() => server.listen());
afterAll(() => server.close());

const credentials = {
  clientId: 'test_client_id',
  clientSecret: 'test_client_secret',
};

describe('oauth', () => {
  describe('exchangeAuthorizationCode', () => {
    it('should exchange an authorization code for a token response', async () => {
      server.use(
        http.post('https://api.toodledo.com/3/account/token.php', async ({ request }) => {
          const body = Object.fromEntries(new URLSearchParams(await request.text()));
          expect(body.grant_type).toBe('authorization_code');
          expect(body.code).toBe('auth_code_123');
          expect(body.redirect_uri).toBe('http://127.0.0.1:8585/callback');
          // Verify Basic auth header is set.
          const auth = request.headers.get('authorization');
          expect(auth).toMatch(/^Basic /);

          return HttpResponse.json({
            access_token: 'access_abc',
            refresh_token: 'refresh_xyz',
            expires_in: 3600,
          } satisfies TokenResponse);
        })
      );

      const result = await exchangeAuthorizationCode(
        credentials,
        'auth_code_123',
        'http://127.0.0.1:8585/callback'
      );
      expect(result.access_token).toBe('access_abc');
      expect(result.refresh_token).toBe('refresh_xyz');
    });

    it('should propagate token endpoint errors', async () => {
      server.use(
        http.post('https://api.toodledo.com/3/account/token.php', () => {
          return new HttpResponse(null, { status: 400 });
        })
      );

      await expect(
        exchangeAuthorizationCode(credentials, 'bad_code', 'http://127.0.0.1:8585/callback')
      ).rejects.toThrow();
    });
  });

  describe('refreshToken', () => {
    it('should refresh an access token and return the new pair', async () => {
      server.use(
        http.post('https://api.toodledo.com/3/account/token.php', async ({ request }) => {
          const body = Object.fromEntries(new URLSearchParams(await request.text()));
          expect(body.grant_type).toBe('refresh_token');
          expect(body.refresh_token).toBe('old_refresh_token');

          return HttpResponse.json({
            access_token: 'new_access',
            refresh_token: 'new_refresh',
            expires_in: 3600,
          } satisfies TokenResponse);
        })
      );

      const result = await refreshToken(credentials, 'old_refresh_token');
      expect(result.access_token).toBe('new_access');
      expect(result.refresh_token).toBe('new_refresh');
    });

    it('should propagate token endpoint errors', async () => {
      server.use(
        http.post('https://api.toodledo.com/3/account/token.php', () => {
          return new HttpResponse(null, { status: 401 });
        })
      );

      await expect(refreshToken(credentials, 'bad_token')).rejects.toThrow();
    });
  });
});
