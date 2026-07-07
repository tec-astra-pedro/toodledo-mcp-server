import { describe, it, expect, vi } from 'vitest';
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
    const cache = new ResponseCache({ ttlMs: 0 });
    expect(cache.enabled).toBe(false);
    // Disabled cache should never serve entries, even immediately after set.
    cache.set('k', 'v');
    expect(cache.getFresh('k')).toBeUndefined();
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

  it('uses env TOODLEDO_CACHE_TTL (seconds) when no options.ttlMs given', () => {
    // ADR item 17: use vi.stubEnv for env tests.
    vi.stubEnv('TOODLEDO_CACHE_TTL', '2');
    const cache = new ResponseCache();
    expect(cache.ttlMs).toBe(2000);
  });

  it('options.ttlMs takes precedence over env TOODLEDO_CACHE_TTL', () => {
    vi.stubEnv('TOODLEDO_CACHE_TTL', '2');
    // ttlMs=0 wins → disabled.
    const cache = new ResponseCache({ ttlMs: 0 });
    expect(cache.enabled).toBe(false);
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

  // --- Key normalization tests (ADR item 9) ---

  it('drops null/undefined param values so {} === omitted === {comp: null}', () => {
    const a = ResponseCache.key('/tasks/get.php'); // omitted params
    const b = ResponseCache.key('/tasks/get.php', {}); // empty object
    const c = ResponseCache.key('/tasks/get.php', { comp: null }); // null value dropped
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('stringifies primitives so {id: 5} === {id: "5"} share an entry', () => {
    const a = ResponseCache.key('/tasks/get.php', { id: 5 });
    const b = ResponseCache.key('/tasks/get.php', { id: '5' });
    expect(a).toBe(b);
  });

  it('JSON-stringifies nested objects so {a:{x:1}} !== {a:{x:2}}', () => {
    const a = ResponseCache.key('/tasks/get.php', { a: { x: 1 } });
    const b = ResponseCache.key('/tasks/get.php', { a: { x: 2 } });
    expect(a).not.toBe(b);
    // And distinct from primitives.
    const c = ResponseCache.key('/tasks/get.php', { id: '5' });
    expect(a).not.toBe(c);
  });

  // --- Generation counter / TOCTOU tests ---

  it('set() does NOT bump generation (concurrent reads both cache)', () => {
    const { cache } = make();
    const genBefore = cache.generation;
    cache.set('a', '1');
    cache.set('b', '2');
    // Neither set should have bumped the counter.
    expect(cache.generation).toBe(genBefore);
  });

  it('invalidatePrefix bumps generation exactly once per call, not per deleted key', () => {
    const { cache } = make();
    cache.set('/tasks/a', '1');
    cache.set('/tasks/b', '2');
    cache.set('/tasks/c', '3');
    const genBefore = cache.generation;
    cache.invalidatePrefix('/tasks/');
    // Only one bump, not three.
    expect(cache.generation).toBe(genBefore + 1);
    // All entries gone.
    expect(cache.getFresh('/tasks/a')).toBeUndefined();
    expect(cache.getFresh('/tasks/b')).toBeUndefined();
    expect(cache.getFresh('/tasks/c')).toBeUndefined();
  });

  it('readers that captured generation before a write detect the change and skip set', () => {
    // Simulates: reader captures gen=0, writes happen (gen becomes 1), reader's set() is skipped.
    const { cache } = make();
    expect(cache.generation).toBe(0);

    // Reader A starts a fetch (simulated by capturing the generation).
    const capturedGen = cache.generation;

    // Meanwhile, someone invalidates /tasks/.
    cache.set('/tasks/x', 'pre_invalid');
    cache.invalidatePrefix('/tasks/');
    expect(cache.generation).toBe(1);

    // Reader A's fetch completes and wants to stamp the cache.
    // Because generation changed, it must NOT write (stale data).
    if (cache.generation === capturedGen) {
      cache.set('/tasks/x', 'stale_data');
    } else {
      // Skip — this is what a real TOCTOU guard would do.
    }

    // The key should still be missing because the set was skipped.
    expect(cache.getFresh('/tasks/x')).toBeUndefined();
  });
});
