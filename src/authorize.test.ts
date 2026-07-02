import { describe, it, expect } from 'vitest';
import { buildAuthorizeUrl, validateState } from '../src/authorize.js';

describe('authorize (pure pieces)', () => {
  describe('buildAuthorizeUrl', () => {
    it('should include the required OAuth parameters', () => {
      const url = buildAuthorizeUrl({ clientId: 'my-client-id' });
      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe('https://api.toodledo.com/3/account/authorize.php');
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('client_id')).toBe('my-client-id');
      expect(parsed.searchParams.get('scope')).toBe('basic tasks notes outlines lists write');
      expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8585/callback');
    });

    it('should include a random state parameter', () => {
      const url = buildAuthorizeUrl({ clientId: 'id' });
      const state = new URL(url).searchParams.get('state');
      expect(state).toBeTruthy();
      expect(state!.length).toBeGreaterThan(10); // crypto.randomUUID is 36 chars; our fallback should be long too.
    });

    it('should override scope and redirect_uri when provided', () => {
      const url = buildAuthorizeUrl({
        clientId: 'id',
        scope: 'tasks write',
        redirectUri: 'http://127.0.0.1:9999/callback',
      });
      const parsed = new URL(url);
      expect(parsed.searchParams.get('scope')).toBe('tasks write');
      expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:9999/callback');
    });
  });

  describe('validateState', () => {
    it('should accept the matching state', () => {
      const expected = 'abc123-xyz';
      expect(validateState(expected, expected)).toBe(true);
    });

    it('should reject a different state', () => {
      expect(validateState('wrong_state', 'expected_one')).toBe(false);
    });

    it('should reject null / empty state', () => {
      expect(validateState(null, 'anything')).toBe(false);
      expect(validateState('', 'anything')).toBe(false);
    });

    it('should reject mismatched lengths (timing-safe)', () => {
      // Different length → short-circuit to false.
      expect(validateState('short', 'much longer string here')).toBe(false);
    });
  });
});
