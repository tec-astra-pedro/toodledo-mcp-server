import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import type { TokenStore } from '../src/tokenStore.js';
import { ToodledoClient } from '../src/client.js';

const server = setupServer();

beforeAll(() => server.listen());
afterAll(() => server.close());

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
        return HttpResponse.json([{ id: 20, content: 'New Note' }]);
      })
    );

    const client = new ToodledoClient(credentials);
    const note = await client.addNote({ notes: [{ content: 'New Note' }] });
    expect(note[0].content).toBe('New Note');
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
        return HttpResponse.json({ id: 1, title: 'Updated List' });
      })
    );

    const client = new ToodledoClient(credentials);
    const list = await client.editList(1, { title: 'Updated List' });
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
        return HttpResponse.json({ status: 'success' });
      })
    );

    const client = new ToodledoClient(credentials);
    await client.deleteList(1);
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
});
