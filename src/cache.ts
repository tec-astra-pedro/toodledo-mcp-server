/**
 * In-memory response cache for Toodledo GET endpoints.
 *
 * Toodledo allows only 100 API calls per access token (~1,000/hour) and its
 * docs ask clients to minimize call volume. This cache serves repeated reads
 * from memory within a trust window and, past that, lets the client
 * revalidate entries against the account's `lastedit_*`/`lastdelete_*`
 * timestamps (Toodledo's documented sync algorithm) instead of refetching.
 *
 * The cache itself is a dumb store; freshness policy beyond the trust
 * window (validation, invalidation on writes) lives in ToodledoClient.
 */

export interface CacheEntry {
  data: any;
  cachedAt: number;
  /**
   * The account `lastedit_*`/`lastdelete_*` values observed when the entry
   * was stored, e.g. { lastedit_task: 123, lastdelete_task: 456 }. An entry
   * is still exact iff these all match the current account values.
   */
  validators: Record<string, number>;
}

export interface CacheOptions {
  /** Trust window in ms. 0 disables the cache entirely. Default 60s, overridable via TOODLEDO_CACHE_TTL (seconds). */
  ttlMs?: number;
  /** Clock override for tests. */
  now?: () => number;
}

export class ResponseCache {
  readonly ttlMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, CacheEntry>();

  constructor(options: CacheOptions = {}) {
    const envTtl = process.env.TOODLEDO_CACHE_TTL;
    this.ttlMs = options.ttlMs ?? (envTtl !== undefined ? Number(envTtl) * 1000 : 60_000);
    this.now = options.now ?? Date.now;
  }

  /** False when the TTL is 0 (or negative/NaN) — callers should bypass the cache entirely. */
  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  /**
   * Canonical cache key for a GET request: url plus params with sorted keys,
   * so `{comp:0, num:5}` and `{num:5, comp:0}` share an entry but any
   * differing param value gets its own.
   */
  static key(url: string, params?: Record<string, any>): string {
    const canonical = params
      ? JSON.stringify(Object.keys(params).sort().map((k) => [k, params[k]]))
      : '';
    return `${url}|${canonical}`;
  }

  /** The entry for `key` regardless of age, or undefined on a miss. */
  get(key: string): CacheEntry | undefined {
    return this.entries.get(key);
  }

  /**
   * The entry for `key` only if it is within the trust window
   * (`maxAgeMs`, defaulting to the cache TTL).
   */
  getFresh(key: string, maxAgeMs: number = this.ttlMs): CacheEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    return this.now() - entry.cachedAt <= maxAgeMs ? entry : undefined;
  }

  set(key: string, data: any, validators: Record<string, number> = {}): void {
    this.entries.set(key, { data, cachedAt: this.now(), validators });
  }

  /** Re-stamp a validated entry as fresh without refetching its data. */
  refresh(entry: CacheEntry): void {
    entry.cachedAt = this.now();
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Drop every entry whose key starts with `urlPrefix` (e.g. '/tasks/'). */
  invalidatePrefix(urlPrefix: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(urlPrefix)) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
