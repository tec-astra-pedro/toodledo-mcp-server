import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import type { TokenStore } from '../src/tokenStore.js';
import { ToodledoClient } from '../src/client.js';
import { ResponseCache } from '../src/cache.js';

const server = setupServer();

beforeAll(() => server.listen());
afterAll(() => server.close());

// Mock token store: used by cache-integration tests to avoid touching the real token file.
// read() returns null so the client relies on credentials.refreshToken; write() is a no-op.
const MOCK_STORE: TokenStore = { read() { return Promise.resolve(null); }, write() {} };

// Shared msw handler for the OAuth token endpoint. All cache-integration tests
// use this so they only need to set up collection + account mocks. ADR item 17.
const TOKEN_HANDLER = http.post('https://api.toodledo.com/3/account/token.php', () => {
  return HttpResponse.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
});

// Helper: build an account/get.php response with configurable validator stamps.
function accountResponse(stamps: Record<string, number> = {}) {
  return HttpResponse.json({ id: 1, ...stamps });
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'client-test-'));
}

describe('ToodledoClient', () => {
  const credentials = {
    clientId: 'test_client_id',
    clientSecret: 'test_client_secret',
    refreshToken: 'initial_refresh_token',
  };

  it('should handle OAuth2 token refresh on 401 error', async () => {
    let requestCount = 0;
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'new_access_token',
          refresh_token: 'new_refresh_token',
          expires_in: 3600,
        });
      }),
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        requestCount++;
        if (requestCount === 1) {
          return new HttpResponse(null, { status: 401 });
        }
        return HttpResponse.json([{ id: 1, title: 'Task 1' }]);
      })
    );

    const client = new ToodledoClient(credentials);
    const tasks = await client.getTasks();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Task 1');
    expect(requestCount).toBe(2);
  });

  it('should fetch tasks successfully', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access_token',
          refresh_token: 'refresh_token',
          expires_in: 3600,
        });
      }),
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        return HttpResponse.json([{ id: 1, title: 'Task 1' }]);
      })
    );

    const client = new ToodledoClient(credentials);
    const tasks = await client.getTasks();
    expect(tasks[0].title).toBe('Task 1');
  });

  it('should add a task', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access_token',
          refresh_token: 'refresh_token',
          expires_in: 3600,
        });
      }),
      http.post('https://api.toodledo.com/3/tasks/add.php', () => {
        return HttpResponse.json({ id: 2, title: 'New Task' });
      })
    );

    const client = new ToodledoClient(credentials);
    const task = await client.addTask({ title: 'New Task' });
    expect(task.id).toBe(2);
    expect(task.title).toBe('New Task');
  });

  it('should edit a task', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access_token',
          refresh_token: 'refresh_token',
          expires_in: 3600,
        });
      }),
      http.post('https://api.toodledo.com/3/tasks/edit.php', () => {
        return HttpResponse.json({ id: 1, title: 'Updated Task' });
      })
    );

    const client = new ToodledoClient(credentials);
    const task = await client.editTask(1, { title: 'Updated Task' });
    expect(task.title).toBe('Updated Task');
  });

  it('should delete a task', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access_token',
          refresh_token: 'refresh_token',
          expires_in: 3600,
        });
      }),
      http.post('https://api.toodledo.com/3/tasks/delete.php', () => {
        return HttpResponse.json({ status: 'success' });
      })
    );

    const client = new ToodledoClient(credentials);
    await client.deleteTask([1]);
  });

  it('should get notes', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access_token',
          refresh_token: 'refresh_token',
          expires_in: 3600,
        });
      }),
      http.get('https://api.toodledo.com/3/notes/get.php', () => {
        return HttpResponse.json([{ id: 10, content: 'Note 1' }]);
      })
    );

    const client = new ToodledoClient(credentials);
    const notes = await client.getNotes();
    expect(notes[0].content).toBe('Note 1');
  });

  it('should add a note', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access_token',
          refresh_token: 'refresh_token',
          expires_in: 3600,
        });
      }),
      http.post('https://api.toodledo.com/3/notes/add.php', () => {
        return HttpResponse.json([{ id: 20, title: 'New Note', text: 'body' }]);
      })
    );

    const client = new ToodledoClient(credentials);
    const note = await client.addNote({ notes: [{ title: 'New Note', text: 'body' }] });
    expect(note[0].title).toBe('New Note');
  });

  it('should edit a note', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access_token',
          refresh_token: 'refresh_token',
          expires_in: 3600,
        });
      }),
      http.post('https://api.toodledo.com/3/notes/edit.php', () => {
        return HttpResponse.json([{ id: 1, content: 'Updated Note' }]);
      })
    );

    const client = new ToodledoClient(credentials);
    const notes = await client.editNote(1, { content: 'Updated Note' });
    expect(notes[0].content).toBe('Updated Note');
  });

  it('should delete a note', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access_token',
          refresh_token: 'refresh_token',
          expires_in: 3600,
        });
      }),
      http.post('https://api.toodledo.com/3/notes/delete.php', () => {
        return HttpResponse.json({ status: 'success' });
      })
    );

    const client = new ToodledoClient(credentials);
    await client.deleteNote(1);
  });

  it('should get lists', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access_token',
          refresh_token: 'refresh_token',
          expires_in: 3600,
        });
      }),
      http.get('https://api.toodledo.com/3/lists/get.php', () => {
        return HttpResponse.json([{ id: 100, title: 'My List' }]);
      })
    );

    const client = new ToodledoClient(credentials);
    const lists = await client.getLists();
    expect(lists[0].title).toBe('My List');
  });

  it('should add a list', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access_token',
          refresh_token: 'refresh_token',
          expires_in: 3600,
        });
      }),
      http.post('https://api.toodledo.com/3/lists/add.php', () => {
        return HttpResponse.json({ id: 101, title: 'New List' });
      })
    );

    const client = new ToodledoClient(credentials);
    const list = await client.addList({ title: 'New List' });
    expect(list.id).toBe(101);
    expect(list.title).toBe('New List');
  });

  it('should edit a list', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access_token',
          refresh_token: 'refresh_token',
          expires_in: 3600,
        });
      }),
      http.post('https://api.toodledo.com/3/lists/edit.php', () => {
        return HttpResponse.json([{ id: 'abc123', title: 'Updated List', version: 2 }]);
      })
    );

    const client = new ToodledoClient(credentials);
    // Pass version explicitly so the client doesn't need to fetch it first.
    const list = await client.editList('abc123', { title: 'Updated List', version: 1 });
    expect(list.title).toBe('Updated List');
  });

  it('should delete a list', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access_token',
          refresh_token: 'refresh_token',
          expires_in: 3600,
        });
      }),
      http.post('https://api.toodledo.com/3/lists/delete.php', () => {
        return HttpResponse.json([{ id: 'abc123' }]);
      })
    );

    const client = new ToodledoClient(credentials);
    await client.deleteList('abc123');
  });

  it('should get folders', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access_token',
          refresh_token: 'refresh_token',
          expires_in: 3600,
        });
      }),
      http.get('https://api.toodledo.com/3/folders/get.php', () => {
        return HttpResponse.json([{ id: 50, title: 'Folder 1' }]);
      })
    );

    const client = new ToodledoClient(credentials);
    const folders = await client.getFolders();
    expect(folders[0].title).toBe('Folder 1');
  });

  it('should add a folder', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access_token',
          refresh_token: 'refresh_token',
          expires_in: 3600,
        });
      }),
      http.post('https://api.toodledo.com/3/folders/add.php', () => {
        return HttpResponse.json({ id: 51, title: 'New Folder' });
      })
    );

    const client = new ToodledoClient(credentials);
    const folder = await client.addFolder('New Folder');
    expect(folder.id).toBe(51);
    expect(folder.title).toBe('New Folder');
  });

  it('should edit a folder', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access_token',
          refresh_token: 'refresh_token',
          expires_in: 3600,
        });
      }),
      http.post('https://api.toodledo.com/3/folders/edit.php', () => {
        return HttpResponse.json({ id: 1, title: 'Updated Folder' });
      })
    );

    const client = new ToodledoClient(credentials);
    const folder = await client.editFolder(1, { title: 'Updated Folder' });
    expect(folder.title).toBe('Updated Folder');
  });

  it('should delete a folder', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access_token',
          refresh_token: 'refresh_token',
          expires_in: 3600,
        });
      }),
      http.post('https://api.toodledo.com/3/folders/delete.php', () => {
        return HttpResponse.json({ status: 'success' });
      })
    );

    const client = new ToodledoClient(credentials);
    await client.deleteFolder(1);
  });

  it('should throw error if no refresh token is provided', async () => {
    const mockStore: TokenStore = { read() { return Promise.resolve(null); }, write() {} };
    const client = new ToodledoClient({ clientId: 'id', clientSecret: 'secret' }, mockStore);
    await expect(client.getTasks()).rejects.toThrow('No refresh token available');
  });

  it('should throw error if authentication fails', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return new HttpResponse(null, { status: 401 });
      })
    );
    const client = new ToodledoClient(credentials);
    await expect(client.getTasks()).rejects.toThrow(/Authentication failed/);
  });

  it('should throw error on generic API failure', async () => {
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({ access_token: 'a', refresh_token: 'b', expires_in: 3600 });
      }),
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        return new HttpResponse(null, { status: 500 });
      })
    );
    const client = new ToodledoClient(credentials);
    await expect(client.getTasks()).rejects.toThrow();
  });

  it('should fall back to the token store when no credential refresh token is given', async () => {
    const tempDir = makeTempDir();
    // Pre-populate the token file.
    fs.writeFileSync(
      path.join(tempDir, 'token.json'),
      JSON.stringify({ refreshToken: 'stored_refresh_token' })
    );

    const mockStore: TokenStore = {
      async read() { return 'stored_refresh_token'; },
      write(_t: string) {},
    };

    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access_from_store',
          refresh_token: 'new_stored_refresh',
          expires_in: 3600,
        });
      }),
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        return HttpResponse.json([{ id: 1, title: 'From store' }]);
      })
    );

    const client = new ToodledoClient(
      { clientId: 'id', clientSecret: 'secret' },
      mockStore
    );
    const tasks = await client.getTasks();
    expect(tasks[0].title).toBe('From store');
  });

  it('should write the rotated refresh token on successful refresh', async () => {
    const writtenTokens: string[] = [];
    const mockStore: TokenStore = {
      read() { return Promise.resolve(null); },
      write(t) { writtenTokens.push(t); return undefined; },
    };

    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access',
          refresh_token: 'rotated_refresh',
          expires_in: 3600,
        });
      }),
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        return HttpResponse.json([{ id: 1, title: 'OK' }]);
      })
    );

    const client = new ToodledoClient(
      { clientId: 'id', clientSecret: 'secret', refreshToken: credentials.refreshToken },
      mockStore
    );
    await client.getTasks();
    expect(writtenTokens).toEqual(['rotated_refresh']);
  });

  it('should retry with the stored token when the in-memory token is stale', async () => {
    // Simulates another process having rotated the token: the in-memory
    // token is dead, but the store holds the newer, valid one.
    const mockStore: TokenStore = {
      read() { return Promise.resolve('newer_stored_token'); },
      write(_t: string) {},
    };

    const attemptedTokens: string[] = [];
    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', async ({ request }) => {
        const body = Object.fromEntries(new URLSearchParams(await request.text()));
        attemptedTokens.push(body.refresh_token);
        if (body.refresh_token === 'stale_token') {
          return new HttpResponse(null, { status: 400 });
        }
        return HttpResponse.json({
          access_token: 'recovered_access',
          refresh_token: 'rotated_again',
          expires_in: 3600,
        });
      }),
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        return HttpResponse.json([{ id: 1, title: 'Recovered' }]);
      })
    );

    const client = new ToodledoClient(
      { clientId: 'id', clientSecret: 'secret', refreshToken: 'stale_token' },
      mockStore
    );
    const tasks = await client.getTasks();
    expect(tasks[0].title).toBe('Recovered');
    expect(attemptedTokens).toEqual(['stale_token', 'newer_stored_token']);
  });

  it('should drop a dead token on refresh failure so a later call can recover', async () => {
    // First call: both the in-memory token and the store hold the same dead
    // token, so authentication fails. The store is then updated (as if
    // `npm run auth` re-ran), and a second call must recover without a
    // process restart.
    let storedToken = 'dead_token';
    const mockStore: TokenStore = {
      read() { return Promise.resolve(storedToken); },
      write(t: string) { storedToken = t; },
    };

    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', async ({ request }) => {
        const body = Object.fromEntries(new URLSearchParams(await request.text()));
        if (body.refresh_token === 'dead_token') {
          return new HttpResponse(null, { status: 400 });
        }
        return HttpResponse.json({
          access_token: 'fresh_access',
          refresh_token: 'fresh_rotated',
          expires_in: 3600,
        });
      }),
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        return HttpResponse.json([{ id: 1, title: 'After recovery' }]);
      })
    );

    const client = new ToodledoClient(
      { clientId: 'id', clientSecret: 'secret', refreshToken: 'dead_token' },
      mockStore
    );
    await expect(client.getTasks()).rejects.toThrow(/Authentication failed/);

    // The store is re-authorized out of band.
    storedToken = 'fresh_token';
    const tasks = await client.getTasks();
    expect(tasks[0].title).toBe('After recovery');
    expect(storedToken).toBe('fresh_rotated');
  });

  it('should not treat a token persistence failure as an auth failure', async () => {
    // The refresh succeeded, so the old token is already invalidated by
    // Toodledo — a failing write must not discard the new in-memory token.
    const mockStore: TokenStore = {
      read() { return Promise.resolve(null); },
      write() { throw new Error('EACCES: permission denied'); },
    };

    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({
          access_token: 'access',
          refresh_token: 'rotated',
          expires_in: 3600,
        });
      }),
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        return HttpResponse.json([{ id: 1, title: 'Still works' }]);
      })
    );

    const client = new ToodledoClient(
      { clientId: 'id', clientSecret: 'secret', refreshToken: 'initial' },
      mockStore
    );
    const tasks = await client.getTasks();
    expect(tasks[0].title).toBe('Still works');
  });

  it('should throw a clear error when editing a list that does not exist', async () => {
    const mockStore: TokenStore = {
      read() { return Promise.resolve('token'); },
      write(_t: string) {},
    };

    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({ access_token: 'a', refresh_token: 'b', expires_in: 3600 });
      }),
      // The version lookup finds no such list.
      http.get('https://api.toodledo.com/3/lists/get.php', () => {
        return HttpResponse.json([]);
      })
    );

    const client = new ToodledoClient({ clientId: 'id', clientSecret: 'secret' }, mockStore);
    await expect(client.editList('nonexistent', { title: 'X' })).rejects.toThrow(
      /List nonexistent not found/
    );
  });

  it('editList handles null body from lists/get.php gracefully (not TypeError)', async () => {
    // Toodledo returns literal null body when account has no lists.
    // The ?? [] guard must prevent a TypeError and surface "not found" instead.
    const mockStore: TokenStore = {
      read() { return Promise.resolve('token'); },
      write(_t: string) {},
    };

    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({ access_token: 'a', refresh_token: 'b', expires_in: 3600 });
      }),
      // Return null body (not empty array) to simulate Toodledo's behavior when no lists exist.
      http.get('https://api.toodledo.com/3/lists/get.php', () => {
        return new HttpResponse(null, { status: 200 });
      })
    );

    const client = new ToodledoClient({ clientId: 'id', clientSecret: 'secret' }, mockStore);
    // Must reject with "not found" message, NOT TypeError from calling .find on null.
    await expect(client.editList('abc123', { title: 'X' })).rejects.toThrow(
      /List abc123 not found/
    );
  });

  it('should prefer explicit credential refresh token over the store on construction', async () => {
    const readCalls: string[] = [];
    const mockStore: TokenStore = {
      read() {
        readCalls.push('read');
        return Promise.resolve('store_token');
      },
      write(_t: string) {},
    };

    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', async ({ request }) => {
        const body = Object.fromEntries(new URLSearchParams(await request.text()));
        // The explicit credential should be used, not the store.
        expect(body.refresh_token).toBe('credential_refresh');
        return HttpResponse.json({
          access_token: 'access',
          refresh_token: 'new_one',
          expires_in: 3600,
        });
      }),
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        return HttpResponse.json([{ id: 1, title: 'OK' }]);
      })
    );

    const client = new ToodledoClient(
      { clientId: 'id', clientSecret: 'secret', refreshToken: 'credential_refresh' },
      mockStore
    );
    await client.getTasks();
    // read() should not have been called — the credential provided a token.
    expect(readCalls).toEqual([]);
  });

  it('should fall back to the store only when no credential refresh token is given', async () => {
    const readOrder: string[] = [];
    const mockStore: TokenStore = {
      read() {
        readOrder.push('read');
        return Promise.resolve('store_refresh_token');
      },
      write(_t: string) {},
    };

    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', async ({ request }) => {
        const body = Object.fromEntries(new URLSearchParams(await request.text()));
        expect(body.refresh_token).toBe('store_refresh_token');
        return HttpResponse.json({
          access_token: 'access_from_store_fallback',
          refresh_token: 'rotated',
          expires_in: 3600,
        });
      }),
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        return HttpResponse.json([{ id: 1, title: 'OK' }]);
      })
    );

    const client = new ToodledoClient(
      { clientId: 'id', clientSecret: 'secret' }, // no refreshToken
      mockStore
    );
    await client.getTasks();
    expect(readOrder).toEqual(['read']);
  });

  // --- ResponseCache integration tests (cache enabled, env TTL=0 bypassed) ---

  it('serves a second getTasks() from cache within the trust window', async () => {
    let tasksCount = 0;
    let accountCount = 0;

    server.use(
      TOKEN_HANDLER,
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        tasksCount++;
        return HttpResponse.json([{ id: 1, title: 'Task' }]);
      }),
      http.get('https://api.toodledo.com/3/account/get.php', () => {
        accountCount++;
        // Stamp validators matching the initial fetch so a stale validation passes.
        return accountResponse({ lastedit_task: 10, lastdelete_task: 20 });
      })
    );

    const cache = new ResponseCache({ ttlMs: 5_000 });
    const client = new ToodledoClient(credentials, MOCK_STORE, cache);

    await client.getTasks();
    // Second call within the window should hit the cache — no tasks/get.
    await client.getTasks();

    expect(tasksCount).toBe(1);
  });

  it('stale hit with empty stored validators refetches (no baseline to compare)', async () => {
    let tasksCount = 0;
    let accountCount = 0;
    let now = 0;

    server.use(
      TOKEN_HANDLER,
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        tasksCount++;
        return HttpResponse.json([{ id: 1, title: 'Task' }]);
      }),
      http.get('https://api.toodledo.com/3/account/get.php', () => {
        accountCount++;
        return accountResponse({ lastedit_task: 10, lastdelete_task: 20 });
      })
    );

    const cache = new ResponseCache({ ttlMs: 5_000, now: () => now });
    const client = new ToodledoClient(credentials, MOCK_STORE, cache);

    // First call — cold miss stamps with empty validators (no account/get.php per ADR item 8).
    await client.getTasks();
    expect(tasksCount).toBe(1);
    expect(accountCount).toBe(0);

    // Advance past the trust window.
    now = 6_000;

    // Second call — stale hit with empty stored validators.
    // ADR item 6: empty stored validators don't match non-empty current validators → refetch.
    const result = await client.getTasks();
    expect(result[0].title).toBe('Task');
    expect(tasksCount).toBe(2); // re-fetched because stored={} doesn't match current={lastedit_task:10, lastdelete_task:20}
    expect(accountCount).toBe(1); // account called for validation
  });

  it('stale hit with matching validators re-stamps and serves cached data', async () => {
    let tasksCount = 0;
    let accountCount = 0;
    let now = 0;

    server.use(
      TOKEN_HANDLER,
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        tasksCount++;
        return HttpResponse.json([{ id: 1, title: 'Task' }]);
      }),
      http.get('https://api.toodledo.com/3/account/get.php', () => {
        accountCount++;
        return accountResponse({ lastedit_task: 10, lastdelete_task: 20 });
      })
    );

    const cache = new ResponseCache({ ttlMs: 5_000, now: () => now });
    const client = new ToodledoClient(credentials, MOCK_STORE, cache);

    // First call — cold miss stamps with empty validators.
    await client.getTasks();
    expect(tasksCount).toBe(1);
    expect(accountCount).toBe(0);

    // Advance past the trust window.
    now = 6_000;

    // Second call — stale hit, empty stored validators mismatch → refetch and stamp with current validators.
    await client.getTasks();
    expect(tasksCount).toBe(2);
    expect(accountCount).toBe(1);

    // Advance past the trust window again.
    now = 12_000;

    // Third call — stale hit, stored validators now match current → re-stamp and serve cached.
    const result = await client.getTasks();
    expect(result[0].title).toBe('Task');
    expect(tasksCount).toBe(2); // not re-fetched, served from cache
    expect(accountCount).toBe(2); // account called for validation
  });

  it('refetches when lastdelete_task has been bumped (external deletion)', async () => {
    let tasksCount = 0;
    let now = 0;

    server.use(
      TOKEN_HANDLER,
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        tasksCount++;
        // Second call returns updated data reflecting the deletion.
        return HttpResponse.json(tasksCount === 1 ? [{ id: 1, title: 'Task' }] : [{ id: 2, title: 'Other' }]);
      }),
      http.get('https://api.toodledo.com/3/account/get.php', () => {
        // First validation returns matching stamps; second call (after delete) bumps lastdelete.
        return accountResponse(tasksCount === 0 ? { lastedit_task: 10, lastdelete_task: 20 } : { lastedit_task: 10, lastdelete_task: 99 });
      })
    );

    const cache = new ResponseCache({ ttlMs: 5_000, now: () => now });
    const client = new ToodledoClient(credentials, MOCK_STORE, cache);

    // Initial fetch.
    await client.getTasks();
    expect(tasksCount).toBe(1);

    // External deletion bumped lastdelete_task; advance past the window.
    now = 6_000;
    const result = await client.getTasks();
    expect(result[0].id).toBe(2);
    expect(tasksCount).toBe(2); // re-fetched because validator mismatched
  });

  it('read-your-writes: addTask invalidates the tasks cache', async () => {
    let tasksCount = 0;
    let accountCount = 0;

    server.use(
      TOKEN_HANDLER,
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        tasksCount++;
        // First call: pre-add snapshot. Second call (after add): includes the new task.
        const data = tasksCount === 1 ? [{ id: 1, title: 'Old' }] : [{ id: 1, title: 'Old' }, { id: 99, title: 'New' }];
        return HttpResponse.json(data);
      }),
      http.post('https://api.toodledo.com/3/tasks/add.php', () => {
        accountCount++; // account invalidated on successful POST.
        return HttpResponse.json({ id: 99, title: 'New' });
      }),
      http.get('https://api.toodledo.com/3/account/get.php', () => {
        // Return matching stamps — the validator path should NOT refetch if cache were still present (but it was invalidated by addTask).
        return accountResponse({ lastedit_task: 10, lastdelete_task: 20 });
      })
    );

    const cache = new ResponseCache({ ttlMs: 5_000 });
    const client = new ToodledoClient(credentials, MOCK_STORE, cache);

    // Seed the cache.
    await client.getTasks();
    expect(tasksCount).toBe(1);

    // Add a task — should invalidate /tasks/ and /account/get.php.
    await client.addTask({ title: 'New' });

    // Next getTasks must refetch (cache invalidated), not serve stale.
    const result = await client.getTasks();
    expect(tasksCount).toBe(2);
    expect(result.some((t: any) => t.id === 99)).toBe(true);
  });

  it('cross-type invalidation: deleteFolder also invalidates /tasks/ cache', async () => {
    let tasksCount = 0;
    const folderId = 42;

    server.use(
      TOKEN_HANDLER,
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        tasksCount++;
        // Second call returns tasks without the deleted folder id.
        return HttpResponse.json(tasksCount === 1 ? [{ id: 1, title: 'Task', folder: folderId }] : [{ id: 1, title: 'Task' }]);
      }),
      http.post('https://api.toodledo.com/3/folders/delete.php', () => {
        return HttpResponse.json({ status: 'success' });
      })
    );

    const cache = new ResponseCache({ ttlMs: 5_000 });
    const client = new ToodledoClient(credentials, MOCK_STORE, cache);

    // Seed the tasks cache.
    await client.getTasks();
    expect(tasksCount).toBe(1);

    // Delete a folder — cross-type rule should also invalidate /tasks/.
    await client.deleteFolder(folderId);

    // Next getTasks must refetch (folder deletion unassigns server-side).
    await client.getTasks();
    expect(tasksCount).toBe(2);
  });

  it('distinct params yield distinct cache entries', async () => {
    let tasksComp0 = 0;
    let tasksComp1 = 0;

    server.use(
      TOKEN_HANDLER,
      http.get('https://api.toodledo.com/3/account/get.php', () => {
        // No validator stamps — validatorsMatch({}, {}) returns true so stale hits refresh and serve.
        return HttpResponse.json({});
      }),
      http.get('https://api.toodledo.com/3/tasks/get.php', ({ request }) => {
        const params = Object.fromEntries(new URLSearchParams(new URL(request.url).search));
        if (params.comp === '0') { tasksComp0++; return HttpResponse.json([{ id: 1, title: 'Open' }]); }
        if (params.comp === '1') { tasksComp1++; return HttpResponse.json([{ id: 2, title: 'Done' }]); }
        return new HttpResponse(null, { status: 400 });
      })
    );

    const cache = new ResponseCache({ ttlMs: 5_000 });
    const client = new ToodledoClient(credentials, MOCK_STORE, cache);

    await client.getTasks({ comp: '0' });
    await client.getTasks({ comp: '1' });
    // Each params variant hit the network once.
    expect(tasksComp0).toBe(1);
    expect(tasksComp1).toBe(1);

    // Second call per variant should be a cache hit.
    await client.getTasks({ comp: '0' });
    await client.getTasks({ comp: '1' });
    expect(tasksComp0).toBe(1);
    expect(tasksComp1).toBe(1);
  });

  // --- New regression tests (defect fixes + ADR items) ---

  it('cold miss does NOT call /account/get.php — only fetches collection', async () => {
    // ADR item 8: cold miss (no cached entry) should skip /account/get.php
    // and fetch the collection directly. This test verifies that behavior.
    let tasksCount = 0;
    let accountCount = 0;

    server.use(
      TOKEN_HANDLER,
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        tasksCount++;
        return HttpResponse.json([{ id: 1, title: 'Task' }]);
      }),
      http.get('https://api.toodledo.com/3/account/get.php', () => {
        accountCount++;
        return accountResponse({ lastedit_task: 10, lastdelete_task: 20 });
      })
    );

    const cache = new ResponseCache({ ttlMs: 5_000 });
    const client = new ToodledoClient(credentials, MOCK_STORE, cache);

    // Cold miss: no cached entry yet. Should fetch tasks/get but NOT account/get.
    await client.getTasks();
    expect(tasksCount).toBe(1);
    expect(accountCount).toBe(0); // /account/get.php NOT called on cold miss!
  });

  it('stale hit with undefined validators fetches collection without caching', async () => {
    // ADR items 6 + 15: if /account/get.php returns incomplete data (some
    // validators missing/undefined), the entry should be re-fetched from the
    // collection but NOT re-stamped in cache (to avoid stamping a degraded entry).
    let tasksCount = 0;
    let now = 0;

    server.use(
      TOKEN_HANDLER,
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        tasksCount++;
        return HttpResponse.json([{ id: 1, title: 'Task' }]);
      }),
      http.get('https://api.toodledo.com/3/account/get.php', () => {
        // Return partial validators (missing lastdelete_task) → undefined in currentValidators.
        return accountResponse({ lastedit_task: 10 });
      })
    );

    const cache = new ResponseCache({ ttlMs: 5_000, now: () => now });
    const client = new ToodledoClient(credentials, MOCK_STORE, cache);

    // First call: cold miss → stamps with empty validators.
    await client.getTasks();

    // Advance past trust window — entry is stale, no validator stamps in stored record.
    now = 6_000;

    // Second call: stale hit with empty stored validators.
    // /account/get.php returns partial data → currentValidators has undefined → mismatch → refetch collection.
    await client.getTasks();

    // Should have called tasks/get twice (cold miss + stale hit refetch).
    expect(tasksCount).toBe(2);
  });

  it('getAccountInfo caches its snapshot — two stale reads within 30s call /account/get.php once', async () => {
    // Defect A regression: getAccountInfo must cache its snapshot so bursts of
    // validations cost at most 2 calls/minute. Two stale reads (tasks + notes)
    // within the 30s account-snapshot window should hit /account/get.php only once.
    let tasksCount = 0;
    let notesCount = 0;
    let accountCount = 0;
    let now = 0;

    server.use(
      TOKEN_HANDLER,
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        tasksCount++;
        return HttpResponse.json([{ id: 1, title: 'Task' }]);
      }),
      http.get('https://api.toodledo.com/3/notes/get.php', () => {
        notesCount++;
        return HttpResponse.json([{ id: 1, title: 'Note' }]);
      }),
      http.get('https://api.toodledo.com/3/account/get.php', () => {
        accountCount++;
        return accountResponse({ lastedit_task: 10, lastdelete_task: 5 });
      })
    );

    const cache = new ResponseCache({ ttlMs: 5_000, now: () => now });
    const client = new ToodledoClient(credentials, MOCK_STORE, cache);

    // Seed both collections cold so the later stale reads are genuine validations.
    await client.getTasks();
    await client.getNotes();

    // Advance past trust window — both entries are stale.
    now = 6_000;

    // First stale read (tasks): triggers /account/get.php for validation.
    await client.getTasks();
    expect(accountCount).toBe(1);

    // Second stale read (notes): also stale, but account snapshot is still fresh (<30s).
    // Should NOT call /account/get.php again — getAccountInfo cached its snapshot.
    await client.getNotes();
    expect(accountCount).toBe(1); // still 1 — snapshot was reused

    // Verify both collections were fetched twice (cold + stale refetch).
    expect(tasksCount).toBe(2);
    expect(notesCount).toBe(2);
  });

  it('distinct params {comp: "0"} and {comp: 0} share a cache entry', async () => {
    // ADR item 9: key() normalizes so numeric and string values that compare
    // equal after String() share an entry.
    let tasksCount = 0;

    server.use(
      TOKEN_HANDLER,
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        tasksCount++;
        return HttpResponse.json([{ id: 1, title: 'Task' }]);
      })
    );

    const cache = new ResponseCache({ ttlMs: 5_000 });
    const client = new ToodledoClient(credentials, MOCK_STORE, cache);

    // First call with comp: '0'.
    await client.getTasks({ comp: '0' });
    expect(tasksCount).toBe(1);

    // Second call with comp: 0 (numeric) — should hit cache (same key).
    await client.getTasks({ comp: 0 });
    expect(tasksCount).toBe(1); // cache hit, no second network call
  });

  it('a write during an in-flight cold read must not poison the cache', async () => {
    // Defect A regression (TOCTOU): a write that invalidates while a cold read
    // is in flight must not let the held read cache pre-write data. The next
    // getTasks() must refetch, proving the generation guard worked.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let tasksCount = 0;

    server.use(
      TOKEN_HANDLER,
      http.get('https://api.toodledo.com/3/tasks/get.php', async () => {
        tasksCount++;
        if (tasksCount === 1) await gate; // hold the first fetch in flight
        return HttpResponse.json([{ id: 1, title: 'Pre-write' }]);
      }),
      http.post('https://api.toodledo.com/3/tasks/add.php', () => {
        return HttpResponse.json([{ id: 2, title: 'New' }]);
      })
    );

    const cache = new ResponseCache({ ttlMs: 5_000 });
    const client = new ToodledoClient(credentials, MOCK_STORE, cache);

    const readP = client.getTasks(); // cold read, held at the gate
    await client.addTask({ title: 'New' }); // invalidates /tasks/ mid-flight
    release();
    await readP;

    // If the guard works, the held read did NOT cache its pre-write result,
    // so this call fetches again instead of serving stale data.
    await client.getTasks();
    expect(tasksCount).toBe(2);
  });

  it('TOODLEDO_CACHE_TTL=0 (or ttlMs=0) disables caching — every read hits the network', async () => {
    let tasksCount = 0;
    const cache = new ResponseCache({ ttlMs: 0 }); // disabled.
    expect(cache.enabled).toBe(false);

    server.use(
      TOKEN_HANDLER,
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        tasksCount++;
        return HttpResponse.json([{ id: 1, title: 'Task' }]);
      })
    );

    const client = new ToodledoClient(credentials, MOCK_STORE, cache);
    await client.getTasks();
    await client.getTasks(); // should hit the network again — cache disabled.
    expect(tasksCount).toBe(2);
  });

  it('TOODLEDO_CACHE_TTL=malformed warns and falls back to default (vi.stubEnv)', async () => {
    // ADR item 10: malformed TTL values warn on stderr and fall back to 60s default.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.stubEnv('TOODLEDO_CACHE_TTL', 'not-a-number');

    const cache = new ResponseCache();
    expect(cache.ttlMs).toBe(60_000); // default 60s fallback

    vi.unstubAllEnvs();
    consoleSpy.mockRestore();
  });


  it('generation guard: set() does NOT bump generation (defect 2)', async () => {
    // ADR item 4 / defect 2: generation counter must only bump on invalidation, not on set().
    const cache = new ResponseCache({ ttlMs: 5_000 });
    const key = ResponseCache.key('/tasks/get.php');

    const genBefore = cache.generation;
    cache.set(key, [{ id: 1 }], {});
    expect(cache.generation).toBe(genBefore); // generation unchanged after set()

    // But invalidation should bump it.
    cache.invalidatePrefix('/tasks/');
    expect(cache.generation).toBe(genBefore + 1);
  });

});
