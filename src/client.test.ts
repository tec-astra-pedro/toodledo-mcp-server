import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
      }),
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

  it('revalidates with account/get but does NOT refetch when validators match', async () => {
    let tasksCount = 0;
    let accountCount = 0;
    // Advance past the trust window on demand.
    let now = 0;

    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
      }),
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        tasksCount++;
        return HttpResponse.json([{ id: 1, title: 'Task' }]);
      }),
      http.get('https://api.toodledo.com/3/account/get.php', () => {
        accountCount++;
        // Stamps match what we stamped on the initial fetch — validator path should pass.
        return accountResponse({ lastedit_task: 10, lastdelete_task: 20 });
      })
    );

    const cache = new ResponseCache({ ttlMs: 5_000, now: () => now });
    const client = new ToodledoClient(credentials, MOCK_STORE, cache);

    // First call — stamps the entry with (lastedit_task=10, lastdelete_task=20).
    await client.getTasks();
    expect(tasksCount).toBe(1);
    expect(accountCount).toBe(1);

    // Advance past the trust window.
    now = 6_000;

    // Second call — should hit /account/get.php but NOT refetch tasks/get because validators match.
    const result = await client.getTasks();
    expect(result[0].title).toBe('Task');
    expect(tasksCount).toBe(1); // not re-fetched
    expect(accountCount).toBe(2); // account called for validation
  });

  it('refetches when lastdelete_task has been bumped (external deletion)', async () => {
    let tasksCount = 0;
    let now = 0;

    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
      }),
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
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
      }),
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
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
      }),
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
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
      }),
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

  it('TOODLEDO_CACHE_TTL=0 (or ttlMs=0) disables caching — every read hits the network', async () => {
    let tasksCount = 0;
    const cache = new ResponseCache({ ttlMs: 0 }); // disabled.
    expect(cache.enabled).toBe(false);

    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        return HttpResponse.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
      }),
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
});
