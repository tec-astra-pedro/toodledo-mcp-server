import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServer } from './index.js';
import { ToodledoClient } from './client.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

describe('Toodledo MCP Server', () => {
  let mockClient: ToodledoClient;
  let server: any; // Server instance
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeEach(async () => {
    mockClient = {
      getTasks: vi.fn(),
      addTask: vi.fn(),
      editTask: vi.fn(),
      deleteTask: vi.fn(),
      getNotes: vi.fn(),
      addNote: vi.fn(),
      editNote: vi.fn(),
      deleteNote: vi.fn(),
      getLists: vi.fn(),
      addList: vi.fn(),
      editList: vi.fn(),
      deleteList: vi.fn(),
      getFolders: vi.fn(),
      addFolder: vi.fn(),
      editFolder: vi.fn(),
      deleteFolder: vi.fn(),
    } as unknown as ToodledoClient;

    server = await createServer(mockClient);
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client(
      {
        name: 'test-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  async function callTool(name: string, args: Record<string, any> = {}): Promise<any> {
    return client.callTool({ name, arguments: args }, CallToolResultSchema);
  }

  describe('get_tasks', () => {
    it('returns structured result and content matching the payload', async () => {
      const mockTasks = [
        { id: 1, title: 'Task 1' },
        { id: 2, title: 'Task 2' },
      ];
      vi.mocked(mockClient.getTasks).mockResolvedValue(mockTasks);

      const response: any = await client.callTool(
        {
          name: 'get_tasks',
          arguments: {},
        },
        CallToolResultSchema
      );

      expect(response.content[0].type).toBe('text');
      expect(JSON.parse(response.content[0].text as string)).toEqual({ result: mockTasks });
      expect(response.structuredContent?.result).toEqual(mockTasks);
    });

    it('forwards the inner params object to the client, not the whole arguments wrapper', async () => {
      vi.mocked(mockClient.getTasks).mockResolvedValue([]);
      vi.mocked(mockClient.getNotes).mockResolvedValue([]);
      vi.mocked(mockClient.getLists).mockResolvedValue([]);
      vi.mocked(mockClient.getFolders).mockResolvedValue([]);

      await callTool('get_tasks', { params: { comp: 0 } });
      expect(mockClient.getTasks).toHaveBeenCalledWith({ comp: 0 });

      await callTool('get_notes', { params: { before: 123 } });
      expect(mockClient.getNotes).toHaveBeenCalledWith({ before: 123 });

      await callTool('get_lists', { params: { after: 456 } });
      expect(mockClient.getLists).toHaveBeenCalledWith({ after: 456 });

      await callTool('get_folders', { params: { id: 7 } });
      expect(mockClient.getFolders).toHaveBeenCalledWith({ id: 7 });
    });
  });

  describe('add_task', () => {
    it('returns structured result and content matching the payload', async () => {
      const newTask = { id: 3, title: 'New Task', list_id: 1 };
      vi.mocked(mockClient.addTask).mockResolvedValue(newTask as any);

      const response: any = await client.callTool(
        {
          name: 'add_task',
          arguments: { title: 'New Task', list_id: 1 },
        },
        CallToolResultSchema
      );

      expect(response.content[0].type).toBe('text');
      expect(JSON.parse(response.content[0].text as string)).toEqual({ result: newTask });
      expect(response.structuredContent?.result).toEqual(newTask);
    });
  });

  describe('get_notes', () => {
    it('returns structured result and content matching the payload', async () => {
      const mockNotes = [
        { id: 10, content: 'Note 1' },
        { id: 11, content: 'Note 2' },
      ];
      vi.mocked(mockClient.getNotes).mockResolvedValue(mockNotes as any);

      const response: any = await client.callTool(
        {
          name: 'get_notes',
          arguments: {},
        },
        CallToolResultSchema
      );

      expect(response.content[0].type).toBe('text');
      expect(JSON.parse(response.content[0].text as string)).toEqual({ result: mockNotes });
      expect(response.structuredContent?.result).toEqual(mockNotes);
    });
  });

  describe('add_note', () => {
    it('returns structured result and content matching the payload (array)', async () => {
      const mockNotes = [
        { id: 20, content: 'Note 1' },
      ];
      vi.mocked(mockClient.addNote).mockResolvedValue(mockNotes as any);

      const response: any = await client.callTool(
        {
          name: 'add_note',
          arguments: { notes: [{ content: 'Note 1' }] },
        },
        CallToolResultSchema
      );

      expect(response.content[0].type).toBe('text');
      expect(JSON.parse(response.content[0].text as string)).toEqual({ result: mockNotes });
      expect(response.structuredContent?.result).toEqual(mockNotes);
    });
  });

  describe('tools/list', () => {
    it('lists all 17 tools with the expected shapes', async () => {
      const { tools } = await client.listTools();

      expect(tools).toHaveLength(17);

      const getTasks = tools.find((t) => t.name === 'get_tasks');
      expect(getTasks?.outputSchema).toBeDefined();
      expect(getTasks?.annotations).toEqual({
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });

      const deleteTask = tools.find((t) => t.name === 'delete_task');
      expect(deleteTask?.outputSchema).toBeUndefined();

      const ping = tools.find((t) => t.name === 'ping');
      expect(ping?.outputSchema).toBeUndefined();
    });
  });

  describe('ping', () => {
    it('returns a plain-text pong with no structured content', async () => {
      const response = await callTool('ping');

      expect(response.content[0].type).toBe('text');
      expect(response.content[0].text).toBe('Pong! Toodledo MCP server is running.');
      expect(response.structuredContent).toBeUndefined();
    });
  });

  describe('edit_task', () => {
    it('returns structured result and content matching the payload', async () => {
      const updatedTask = { id: 1, title: 'Updated Task' };
      vi.mocked(mockClient.editTask).mockResolvedValue(updatedTask as any);

      const response = await callTool('edit_task', { id: 1, title: 'Updated Task' });

      expect(mockClient.editTask).toHaveBeenCalledWith(1, { title: 'Updated Task' });
      expect(JSON.parse(response.content[0].text as string)).toEqual({ result: updatedTask });
      expect(response.structuredContent?.result).toEqual(updatedTask);
    });
  });

  describe('delete_task', () => {
    it('deletes tasks and returns a plain-text confirmation', async () => {
      vi.mocked(mockClient.deleteTask).mockResolvedValue(undefined as any);

      const response = await callTool('delete_task', { ids: [1, 2] });

      expect(mockClient.deleteTask).toHaveBeenCalledWith([1, 2]);
      expect(response.content[0].text).toBe('Successfully deleted tasks: 1, 2');
      expect(response.structuredContent).toBeUndefined();
    });
  });

  describe('edit_note', () => {
    it('returns structured result and content matching the payload (array)', async () => {
      const updatedNotes = [{ id: 20, content: 'Updated Note' }];
      vi.mocked(mockClient.editNote).mockResolvedValue(updatedNotes as any);

      const response = await callTool('edit_note', { id: 20, content: 'Updated Note' });

      expect(mockClient.editNote).toHaveBeenCalledWith(20, { content: 'Updated Note' });
      expect(JSON.parse(response.content[0].text as string)).toEqual({ result: updatedNotes });
      expect(response.structuredContent?.result).toEqual(updatedNotes);
    });
  });

  describe('delete_note', () => {
    it('deletes a note and returns a plain-text confirmation', async () => {
      vi.mocked(mockClient.deleteNote).mockResolvedValue(undefined as any);

      const response = await callTool('delete_note', { ids: [5] });

      expect(mockClient.deleteNote).toHaveBeenCalledWith(5);
      expect(response.content[0].text).toBe('Successfully deleted 1 note(s): 5');
      expect(response.structuredContent).toBeUndefined();
    });

    it('deletes multiple notes', async () => {
      vi.mocked(mockClient.deleteNote).mockResolvedValue(undefined as any);

      const response = await callTool('delete_note', { ids: [1, 2, 3] });

      expect(mockClient.deleteNote).toHaveBeenCalledTimes(3);
      expect(mockClient.deleteNote).toHaveBeenCalledWith(1);
      expect(mockClient.deleteNote).toHaveBeenCalledWith(2);
      expect(mockClient.deleteNote).toHaveBeenCalledWith(3);
      expect(response.content[0].text).toBe('Successfully deleted 3 note(s): 1, 2, 3');
    });
  });

  describe('get_lists', () => {
    it('returns structured result and content matching the payload', async () => {
      const mockLists = [{ id: 1, title: 'List 1' }];
      vi.mocked(mockClient.getLists).mockResolvedValue(mockLists as any);

      const response = await callTool('get_lists');

      expect(JSON.parse(response.content[0].text as string)).toEqual({ result: mockLists });
      expect(response.structuredContent?.result).toEqual(mockLists);
    });
  });

  describe('add_list', () => {
    it('returns structured result and content matching the payload', async () => {
      const newList = { id: 2, title: 'New List' };
      vi.mocked(mockClient.addList).mockResolvedValue(newList as any);

      const response = await callTool('add_list', { title: 'New List' });

      expect(JSON.parse(response.content[0].text as string)).toEqual({ result: newList });
      expect(response.structuredContent?.result).toEqual(newList);
    });
  });

  describe('edit_list', () => {
    it('returns structured result and content matching the payload', async () => {
      const updatedList = { id: 2, title: 'Updated List' };
      vi.mocked(mockClient.editList).mockResolvedValue(updatedList as any);

      const response = await callTool('edit_list', { id: 2, title: 'Updated List' });

      expect(mockClient.editList).toHaveBeenCalledWith(2, { title: 'Updated List' });
      expect(JSON.parse(response.content[0].text as string)).toEqual({ result: updatedList });
      expect(response.structuredContent?.result).toEqual(updatedList);
    });
  });

  describe('delete_list', () => {
    it('deletes a list and returns a plain-text confirmation', async () => {
      vi.mocked(mockClient.deleteList).mockResolvedValue(undefined as any);

      const response = await callTool('delete_list', { ids: [7] });

      expect(mockClient.deleteList).toHaveBeenCalledWith(7);
      expect(response.content[0].text).toBe('Successfully deleted 1 list(s): 7');
      expect(response.structuredContent).toBeUndefined();
    });

    it('deletes multiple lists', async () => {
      vi.mocked(mockClient.deleteList).mockResolvedValue(undefined as any);

      const response = await callTool('delete_list', { ids: [1, 2, 3] });

      expect(mockClient.deleteList).toHaveBeenCalledTimes(3);
      expect(mockClient.deleteList).toHaveBeenCalledWith(1);
      expect(mockClient.deleteList).toHaveBeenCalledWith(2);
      expect(mockClient.deleteList).toHaveBeenCalledWith(3);
      expect(response.content[0].text).toBe('Successfully deleted 3 list(s): 1, 2, 3');
    });
  });

  describe('get_folders', () => {
    it('returns structured result and content matching the payload', async () => {
      const mockFolders = [{ id: 1, name: 'Folder 1' }];
      vi.mocked(mockClient.getFolders).mockResolvedValue(mockFolders as any);

      const response = await callTool('get_folders');

      expect(JSON.parse(response.content[0].text as string)).toEqual({ result: mockFolders });
      expect(response.structuredContent?.result).toEqual(mockFolders);
    });
  });

  describe('add_folder', () => {
    it('returns structured result and content matching the payload', async () => {
      const newFolder = { id: 2, name: 'New Folder' };
      vi.mocked(mockClient.addFolder).mockResolvedValue(newFolder as any);

      const response = await callTool('add_folder', { title: 'New Folder', description: 'desc' });

      expect(mockClient.addFolder).toHaveBeenCalledWith('New Folder', 'desc');
      expect(JSON.parse(response.content[0].text as string)).toEqual({ result: newFolder });
      expect(response.structuredContent?.result).toEqual(newFolder);
    });
  });

  describe('edit_folder', () => {
    it('returns structured result and content matching the payload', async () => {
      const updatedFolder = { id: 2, name: 'Updated Folder' };
      vi.mocked(mockClient.editFolder).mockResolvedValue(updatedFolder as any);

      const response = await callTool('edit_folder', { id: 2, title: 'Updated Folder' });

      expect(mockClient.editFolder).toHaveBeenCalledWith(2, { title: 'Updated Folder' });
      expect(JSON.parse(response.content[0].text as string)).toEqual({ result: updatedFolder });
      expect(response.structuredContent?.result).toEqual(updatedFolder);
    });
  });

  describe('delete_folder', () => {
    it('deletes a folder and returns a plain-text confirmation', async () => {
      vi.mocked(mockClient.deleteFolder).mockResolvedValue(undefined as any);

      const response = await callTool('delete_folder', { ids: [9] });

      expect(mockClient.deleteFolder).toHaveBeenCalledWith(9);
      expect(response.content[0].text).toBe('Successfully deleted 1 folder(s): 9');
      expect(response.structuredContent).toBeUndefined();
    });

    it('deletes multiple folders', async () => {
      vi.mocked(mockClient.deleteFolder).mockResolvedValue(undefined as any);

      const response = await callTool('delete_folder', { ids: [1, 2, 3] });

      expect(mockClient.deleteFolder).toHaveBeenCalledTimes(3);
      expect(mockClient.deleteFolder).toHaveBeenCalledWith(1);
      expect(mockClient.deleteFolder).toHaveBeenCalledWith(2);
      expect(mockClient.deleteFolder).toHaveBeenCalledWith(3);
      expect(response.content[0].text).toBe('Successfully deleted 3 folder(s): 1, 2, 3');
    });
  });

  describe('error handling', () => {
    it('returns isError with the error message when a client call rejects', async () => {
      vi.mocked(mockClient.getTasks).mockRejectedValue(new Error('boom'));

      const response = await callTool('get_tasks');

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toBe('boom');
      expect(response.structuredContent).toBeUndefined();
    });

    it('returns isError for an unknown tool name', async () => {
      const response = await callTool('not_a_real_tool');

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toBe('Tool not found: not_a_real_tool');
    });
  });
});
