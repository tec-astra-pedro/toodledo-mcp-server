import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as dotenv from "dotenv";
import { ToodledoClient } from "./client.js";

dotenv.config();

/**
 * Toodledo MCP Server
 */
export async function createServer(client: ToodledoClient): Promise<Server> {
  const server = new Server(
    {
      name: "toodledo-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Tool registration
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "ping",
        description: "Check if the server is alive",
        inputSchema: {
          type: "object",
          properties: {},
        },
        title: "Ping",
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      // --- Tasks ---
      {
        name: "get_tasks",
        description: "Retrieve a list of tasks from Toodledo",
        inputSchema: {
          type: "object",
          properties: {
            params: { type: "object", description: "Filtering parameters for the task list" }
          },
        },
        title: "Get Tasks",
        outputSchema: {
          type: "object",
          properties: {
            result: { type: "array", items: { type: "object", additionalProperties: true } }
          },
          required: ["result"],
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      {
        name: "add_task",
        description: "Create a new task in Toodledo",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "The title of the task" },
            list_id: { type: "number", description: "The ID of the list the task belongs to" },
            folder_id: { type: "number", description: "The ID of the folder the task belongs to" },
            description: { type: "string", description: "The description/content of the task" }
          },
          required: ["title"],
        },
        title: "Add Task",
        outputSchema: {
          type: "object",
          properties: {
            result: { type: "object", additionalProperties: true }
          },
          required: ["result"],
        },
        annotations: {
          readOnlyHint: false,
          idempotentHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "edit_task",
        description: "Update an existing task",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "number", description: "The ID of the task to update" },
            title: { type: "string" },
            description: { type: "string" },
            list_id: { type: "number" },
            folder_id: { type: "number" },
          },
          required: ["id"],
        },
        title: "Edit Task",
        outputSchema: {
          type: "object",
          properties: {
            result: { type: "object", additionalProperties: true }
          },
          required: ["result"],
        },
        annotations: {
          readOnlyHint: false,
          idempotentHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "delete_task",
        description: "Delete one or more tasks",
        inputSchema:
        {
          type: "object",
          properties:
          {
            ids: { type: "array", items: { type: "number" }, description: "Array of task IDs to delete" },
          },
          required: ["ids"],
        },
        title: "Delete Tasks",
        annotations:
        {
          readOnlyHint: false,
          idempotentHint: true,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      // --- Notes ---
      {
        name: "get_notes",
        description: "Retrieve notes from Toodledo",
        inputSchema: {
          type: "object",
          properties: {
            params: { type: "object", description: "Filtering parameters for notes" }
          },
        },
        title: "Get Notes",
        outputSchema:
        {
          type: "object",
          properties: {
            result: { type: "array", items: { type: "object", additionalProperties: true } }
          },
          required: ["result"],
        },
        annotations:
          {
          readOnlyHint: true,
          idempotentHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      {
        name: "add_note",
        description: "Add a note to Toodledo",
        inputSchema:
        {
          type: "object",
          properties:
            {
            notes: {
              type: "array",
              description: "An array of note objects",
              items: {
                type: "object",
                properties: {
                  task_id: { type: "number" },
                  content: { type: "string" }
                },
                required: ["content"]
              }
            }
          },
          required: ["notes"],
        },
        title: "Add Note",
        outputSchema:
        {
          type: "object",
          properties: {
            result: { type: "array", items: { type: "object", additionalProperties: true } }
          },
          required: ["result"],
        },
        annotations:
          {
          readOnlyHint: false,
          idempotentHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "edit_note",
        description: "Update an existing note",
        inputSchema:
        {
          type: "object",
          properties:
            {
            id: { type: "number", description: "The ID of the note to update" },
            content: { type: "string" },
          },
          required: ["id"],
        },
        title: "Edit Note",
        outputSchema:
        {
          type: "object",
          properties: {
            result: { type: "array", items: { type: "object", additionalProperties: true } }
          },
          required: ["result"],
        },
        annotations:
          {
          readOnlyHint: false,
          idempotentHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "delete_note",
        description: "Delete one or more notes",
        inputSchema:
        {
          type: "object",
          properties:
          {
            ids: { type: "array", items: { type: "number" }, description: "Array of note IDs to delete" },
          },
          required: ["ids"],
        },
        title: "Delete Notes",
        annotations:
          {
          readOnlyHint: false,
          idempotentHint: true,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      // --- List Tools ---
      {
        name: "get_lists",
        description: "Retrieve a list of lists from Toodledo",
        inputSchema:
        {
          type: "object",
          properties:
          {
            params: { type: "object", description: "Filtering parameters for lists" }
          },
        },
        title: "Get Lists",
        outputSchema:
        {
          type: "object",
          properties:
            {
            result: { type: "array", items: { type: "object", additionalProperties: true } }
          },
          required: ["result"],
        },
        annotations:
          {
          readOnlyHint: true,
          idempotentHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      {
        name: "add_list",
        description: "Create a new list in Toodledo",
        inputSchema:
        {
          type: "object",
          properties:
          {
            title: { type: "string" },
            ref: { type: "string" },
          },
          required: ["title"],
        },
        title: "Add List",
        outputSchema:
        {
          type: "object",
          properties:
            {
            result: { type: "object", additionalProperties: true }
          },
          required: ["result"],
        },
        annotations:
          {
          readOnlyHint: false,
          idempotentHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "edit_list",
        description: "Update an existing list",
        inputSchema:
        {
          type: "object",
          properties:
          {
            id: { type: "number" },
            title: { type: "string" },
            ref: { type: "string" },
          },
          required: ["id"],
        },
        title: "Edit List",
        outputSchema:
        {
          type: "object",
          properties:
            {
            result: { type: "object", additionalProperties: true }
          },
          required: ["result"],
        },
        annotations:
        {
          readOnlyHint: false,
          idempotentHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "delete_list",
        description: "Delete one or more lists",
        inputSchema:
        {
          type: "object",
          properties:
          {
            ids: { type: "array", items: { type: "number" }, description: "Array of list IDs to delete" },
          },
          required: ["ids"],
        },
        title: "Delete Lists",
        annotations:
        {
          readOnlyHint: false,
          idempotentHint: true,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      // --- Folder Tools ---
      {
        name: "get_folders",
        description: "Retrieve a list of folders from Toodledo",
        inputSchema:
        {
          type: "object",
          properties:
          {
            params: { type: "object", description: "Filtering parameters for folders" }
          },
        },
        title: "Get Folders",
        outputSchema:
        {
          type: "object",
          properties:
            {
            result: { type: "array", items: { type: "object", additionalProperties: true } }
          },
          required: ["result"],
        },
        annotations:
          {
          readOnlyHint: true,
          idempotentHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      {
        name: "add_folder",
        description: "Create a new folder in Toodledo",
        inputSchema:
        {
          type: "object",
          properties:
            {
            title: { type: "string" },
            description: { type: "string" }
          },
          required: ["title"],
        },
        title: "Add Folder",
        outputSchema:
        {
          type: "object",
          properties: {
            result: { type: "object", additionalProperties: true }
          },
          required: ["result"],
        },
        annotations:
          {
          readOnlyHint: false,
          idempotentHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "edit_folder",
        description: "Update an existing folder",
        inputSchema:
        {
          type: "object",
          properties:
            {
            id: { type: "number" },
            title: { type: "string" },
            description: { type: "string" },
          },
          required: ["id"],
        },
        title: "Edit Folder",
        outputSchema:
        {
          type: "object",
          properties: {
            result: { type: "object", additionalProperties: true }
          },
          required: ["result"],
        },
        annotations:
          {
          readOnlyHint: false,
          idempotentHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "delete_folder",
        description: "Delete one or more folders",
        inputSchema:
        {
          type: "object",
          properties: {
            ids: {
              type: "array",
              items: { type: "number" },
              description: "Array of folder IDs to delete",
            },
          },
          required: ["ids"],
        },
        title: "Delete Folders",
        annotations: {
          readOnlyHint: false,
          idempotentHint: true,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
    ],
  }));

  // Tool implementation
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments as any;
    try {
      switch (request.params.name) {
        case "ping": {
          return {
            content: [{ type: "text", text: "Pong! Toodledo MCP server is running." }],
          };
        }

        // --- Task Tools ---
        case "get_tasks": {
          const tasks = await client.getTasks(args);
          return {
            content: [{ type: "text", text: JSON.stringify({ result: tasks }, null, 2) }],
            structuredContent: { result: tasks },
          };
        }

        case "add_task": {
          const task = await client.addTask({
            title: args.title,
            list_id: args.list_id,
            folder_id: args.folder_id,
            description: args.description
          });
          return {
            content: [{ type: "text", text: JSON.stringify({ result: task }, null, 2) }],
            structuredContent: { result: task },
          };
        }

        case "edit_task": {
          const { id, ...data } = args;
          const task = await client.editTask(Number(id), data);
          return {
            content: [{ type: "text", text: JSON.stringify({ result: task }, null, 2) }],
            structuredContent: { result: task },
          };
        }

        case "delete_task": {
          const { ids } = args;
          await client.deleteTask(ids.map(Number));
          return {
            content: [{ type: "text", text: `Successfully deleted tasks: ${ids.join(', ')}` }],
          };
        }

        // --- Note Tools ---
        case "get_notes": {
          const notes = await client.getNotes(args);
          return {
            content: [{ type: "text", text: JSON.stringify({ result: notes }, null, 2) }],
            structuredContent: { result: notes },
          };
        }

        case "add_note": {
          const notes = await client.addNote(args);
          return {
            content: [{ type: "text", text: JSON.stringify({ result: notes }, null, 2) }],
            structuredContent: { result: notes },
          };
        }

        case "edit_note": {
          const { id, ...data } = args;
          const notes = await client.editNote(Number(id), data);
          return {
            content: [{ type: "text", text: JSON.stringify({ result: notes }, null, 2) }],
            structuredContent: { result: notes },
          };
        }

        case "delete_note": {
          const ids = args.ids as number[];
          await Promise.all(ids.map(id => client.deleteNote(Number(id))));
          return {
            content: [{ type: "text", text: `Successfully deleted ${ids.length} note(s): ${ids.join(', ')}` }],
          };
        }

        // --- List Tools ---
        case "get_lists": {
          const lists = await client.getLists(args);
          return {
            content: [{ type: "text", text: JSON.stringify({ result: lists }, null, 2) }],
            structuredContent: { result: lists },
          };
        }

        case "add_list": {
          const list = await client.addList(args);
          return {
            content: [{ type: "text", text: JSON.stringify({ result: list }, null, 2) }],
            structuredContent: { result: list },
          };
        }

        case "edit_list": {
          const { id, ...data } = args;
          const list = await client.editList(Number(id), data);
          return {
            content: [{ type: "text", text: JSON.stringify({ result: list }, null, 2) }],
            structuredContent: { result: list },
          };
        }

        case "delete_list": {
          const ids = args.ids as number[];
          await Promise.all(ids.map(id => client.deleteList(Number(id))));
          return {
            content: [{ type: "text", text: `Successfully deleted ${ids.length} list(s): ${ids.join(', ')}` }],
          };
        }

        // --- Folder Tools ---
        case "get_folders": {
          const folders = await client.getFolders(args);
          return {
            content: [{ type: "text", text: JSON.stringify({ result: folders }, null, 2) }],
            structuredContent: { result: folders },
          };
        }

        case "add_folder": {
          const folder = await client.addFolder(args.title, args.description);
          return {
            content: [{ type: "text", text: JSON.stringify({ result: folder }, null, 2) }],
            structuredContent: { result: folder },
          };
        }

        case "edit_folder": {
          const { id, ...data } = args;
          const folder = await client.editFolder(Number(id), data);
          return {
            content: [{ type: "text", text: JSON.stringify({ result: folder }, null, 2) }],
            structuredContent: { result: folder },
          };
        }

        case "delete_folder": {
          const ids = args.ids as number[];
          await Promise.all(ids.map(id => client.deleteFolder(Number(id))));
          return {
            content: [{ type: "text", text: `Successfully deleted ${ids.length} folder(s): ${ids.join(', ')}` }],
          };
        }

        default:
          throw new Error(`Tool not found: ${request.params.name}`);
      }
    } catch (error: any) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error.message,
          },
        ],
      };
    }
  });

  return server;
}

export async function main() {
  const clientId = process.env.TOODLEDO_CLIENT_ID;
  const clientSecret = process.env.TOODLEDO_CLIENT_SECRET;
  // Refresh token is no longer required here — the client sources it from
  // the token store (populated by `npm run auth`) if not provided directly.
  const refreshToken = process.env.TOODLEDO_REFRESH_TOKEN;

  if (!clientId || !clientSecret) {
    console.error("Error: TOODLEDO_CLIENT_ID and TOODLEDO_CLIENT_SECRET must be set in environment variables.");
    process.exit(1);
  }

  const client = new ToodledoClient({
    clientId,
    clientSecret,
    refreshToken,
  });

  const server = await createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Toodledo MCP Server running on stdio");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
  });
}
