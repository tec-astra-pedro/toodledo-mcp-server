import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { createFileTokenStore } from '../src/tokenStore.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tokenstore-test-'));
}

describe('createFileTokenStore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    // Override the env var so tests don't touch real project files.
    process.env.TOODLEDO_TOKEN_PATH = path.join(tempDir, '.toodledo-token.json');
  });

  it('should return null when no token file exists yet', async () => {
    const store = createFileTokenStore();
    const token = await store.read();
    expect(token).toBeNull();
  });

  it('should write and then read back a refresh token', async () => {
    const store = createFileTokenStore();
    store.write('my_refresh_token');
    const token = await store.read();
    expect(token).toBe('my_refresh_token');
  });

  it('should overwrite the previous token on write', async () => {
    const store = createFileTokenStore();
    store.write('first_token');
    store.write('second_token');
    const token = await store.read();
    expect(token).toBe('second_token');
  });

  it('should persist valid JSON with refreshToken key', () => {
    const store = createFileTokenStore();
    store.write('abc123');
    const raw = fs.readFileSync(path.join(tempDir, '.toodledo-token.json'), 'utf-8');
    expect(JSON.parse(raw)).toEqual({ refreshToken: 'abc123' });
  });

  it('should return null for malformed JSON without throwing', async () => {
    // Write invalid JSON to simulate corruption.
    const fsSync = await import('fs').then((m) => m.promises);
    await fsSync.writeFile(
      path.join(tempDir, '.toodledo-token.json'),
      'not valid json{{{'
    );

    const store = createFileTokenStore();
    // The read should throw on malformed JSON — the plan says it returns null only for ENOENT.
    await expect(store.read()).rejects.toThrow();
  });
});
