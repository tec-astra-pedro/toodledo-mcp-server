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
});
