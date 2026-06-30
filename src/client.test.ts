import { describe, it, expect } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { ToodledoClient } from '../src/client.js';

const server = setupServer();

beforeAll(() => server.listen());
afterAll(() => server.close());

describe('ToodledoClient Full API', () => {
  const credentials = {
    clientId: 'test_id',
    clientSecret: 'test_secret',
    refreshToken: 'test_refresh',
  };

  it('should handle full lifecycle of a task', async () => {
    let authenticated = false;

    server.use(
      http.post('https://api.toodledo.com/3/account/token.php', () => {
        authenticated = true;
        return HttpResponse.json({
          access_token: 'new_token',
          refresh_token: 'new_refresh',
          expires_in: 3600,
        });
      }),
      http.get('https://api.toodledo.com/3/tasks/get.php', () => {
        return HttpResponse.json([{ id: 1, title: 'Existing Task' }]);
      }),
      http.post('https://api.toodledo.com/3/tasks/add.php', () => {
        return HttpResponse.json({ id: 2, title: 'New Task' });
      })
    );

    const client = new ToodledoClient(credentials);

    const tasks = await client.getTasks();
    expect(tasks[0].id).toBe(1);

    const newTask = await client.addTask({ title: 'New Task' });
    expect(newTask.id).toBe(2);
  });
});
