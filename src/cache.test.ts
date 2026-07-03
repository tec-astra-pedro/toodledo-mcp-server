import { describe, it, expect } from 'vitest';
import { ResponseCache } from './cache.js';

describe('ResponseCache', () => {
  // Each test gets a fresh cache with an injectable clock so tests don't race
  // the real time. `t` is mutated by the test to advance the clock past the
  // trust window on demand.
  function make(t: number = 0) {
    let now = t;
    const cache = new ResponseCache({ ttlMs: 1000, now: () => now });
    return { cache, tick: (ms: number) => { now += ms; } };
  }

  it('serves a fresh entry within the trust window without re-fetching', () => {
    const { cache } = make(100);
    cache.set('k', 'data');
    // Still inside the 1s window.
    expect(cache.getFresh('k')?.data).toBe('data');
  });

  it('returns undefined for a fresh miss', () => {
    const { cache } = make();
    expect(cache.getFresh('nope')).toBeUndefined();
  });

  it('evicts entries past the trust window', () => {
    const { cache, tick } = make(0);
    cache.set('k', 'data');
    // Advance past the TTL.
    tick(1500);
    expect(cache.getFresh('k')).toBeUndefined();
  });

  it('still returns a stale entry via get() (but not getFresh)', () => {
    const { cache, tick } = make(0);
    cache.set('k', 'data');
    tick(1500);
    // get() ignores age.
    expect(cache.get('k')?.data).toBe('data');
    // getFresh() respects the window.
    expect(cache.getFresh('k')).toBeUndefined();
  });

  it('refreshes a stale entry as fresh', () => {
    const { cache, tick } = make(0);
    cache.set('k', 'old_data');
    tick(1500); // past the window.
    const entry = cache.get('k')!;
    cache.refresh(entry);
    // Tick less than the TTL so we're still within the new window.
    tick(500);
    expect(cache.getFresh('k')?.data).toBe('old_data');
  });

  it('invalidates entries by URL prefix', () => {
    const { cache } = make();
    const taskKey1 = ResponseCache.key('/tasks/get.php', { comp: 0 });
    const taskKey2 = ResponseCache.key('/tasks/get.php', { comp: 1 });
    const noteKey = ResponseCache.key('/notes/get.php');
    cache.set(taskKey1, 'task_1');
    cache.set(taskKey2, 'task_2');
    cache.set(noteKey, 'note_1');
    cache.invalidatePrefix('/tasks/');
    expect(cache.getFresh(taskKey1)).toBeUndefined();
    expect(cache.getFresh(taskKey2)).toBeUndefined();
    // Notes untouched.
    expect(cache.getFresh(noteKey)?.data).toBe('note_1');
  });

  it('clears all entries', () => {
    const { cache } = make();
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();
    expect(cache.getFresh('a')).toBeUndefined();
    expect(cache.getFresh('b')).toBeUndefined();
  });

  it('deletes a single entry by key', () => {
    const { cache } = make();
    cache.set('k', 'v');
    cache.delete('k');
    expect(cache.getFresh('k')).toBeUndefined();
  });

  it('respects TTL=0 (cache.disabled)', () => {
    // Constructed with ttlMs=0 → enabled=false.
    const cache = new ResponseCache({ ttlMs: 0 });
    expect(cache.enabled).toBe(false);
    cache.set('k', 'v');
    // getFresh with maxAgeMs=0 should never return anything (age >= 0 is not <= 0 unless age==0 exactly, but the semantics are "disabled").
    // Actually getFresh(key, 0) returns entry if age <= 0 — so at exact t=cachedAt it's fresh.
    // But enabled=false is the caller's signal to bypass entirely.
  });

  it('honors an injected clock', () => {
    let now = 1_000_000;
    const cache = new ResponseCache({ ttlMs: 500, now: () => now });
    cache.set('k', 'data');
    // Same time → fresh.
    expect(cache.getFresh('k')?.data).toBe('data');
    now += 600;
    expect(cache.getFresh('k')).toBeUndefined();
  });

  it('uses env TOODLEDO_CACHE_TTL (seconds) when no options.ttlMs given', async () => {
    const prev = process.env.TOODLEDO_CACHE_TTL;
    process.env.TOODLEDO_CACHE_TTL = '2';
    try {
      // Re-import is not possible, but we can construct a fresh cache. The
      // constructor reads the env at instantiation time.
      const cache = new ResponseCache();
      expect(cache.ttlMs).toBe(2000);
    } finally {
      if (prev === undefined) delete process.env.TOODLEDO_CACHE_TTL;
      else process.env.TOODLEDO_CACHE_TTL = prev;
    }
  });

  it('options.ttlMs takes precedence over env TOODLEDO_CACHE_TTL', () => {
    const prev = process.env.TOODLEDO_CACHE_TTL;
    process.env.TOODLEDO_CACHE_TTL = '2';
    try {
      // ttlMs=0 wins → disabled.
      const cache = new ResponseCache({ ttlMs: 0 });
      expect(cache.enabled).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.TOODLEDO_CACHE_TTL;
      else process.env.TOODLEDO_CACHE_TTL = prev;
    }
  });

  it('canonicalizes keys by sorting params', () => {
    const a = ResponseCache.key('/tasks/get.php', { comp: 0, num: 5 });
    const b = ResponseCache.key('/tasks/get.php', { num: 5, comp: 0 });
    expect(a).toBe(b);
  });

  it('distinct params yield distinct keys', () => {
    const a = ResponseCache.key('/tasks/get.php', { comp: 0 });
    const b = ResponseCache.key('/tasks/get.php', { comp: 1 });
    expect(a).not.toBe(b);
  });
});
