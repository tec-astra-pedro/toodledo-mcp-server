import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as dotenv from "dotenv";
import { ToodledoClient } from "./client.js";

// Load environment variables
dotenv.config();

/**
 * Toodledo MCP Server
 */
async function main() {
  const clientId = process.env.TOODLEDO_CLIENT_ID;
  const clientSecret = process.env.TOODLEDO_CLIENT_SECRET;
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

  // Tool definitions
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "ping",
        description: "Check if the server is alive",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "list_tasks",
        description: "Retrieve a list of tasks from Toodledo",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  }));

  // Tool implementation
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
      case "ping": {
        return {
          content: [
            {
              type: "text",
              text: "Pong! Toodledo MCP server is running.",
            },
          ],
        };
      }

      case "list_tasks": {
        try {
          const tasks = await client.getTasks();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(tasks, null, 2),
              },
            ],
          };
        } catch (error: any) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Failed to fetch tasks: ${error.message}`,
              },
            ],
          };
        }
      }

      default:
        throw new Error(`Tool not found: ${request.params.name}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Toodledo MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
