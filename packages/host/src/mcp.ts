import type { MCPServerConfig } from "@growthbeaker/ai-chat-core";
import type { MCPClient, MCPTransport } from "@ai-sdk/mcp";
import { createMCPClient } from "@ai-sdk/mcp";
import type { CoreTool } from "ai";

/**
 * Manages MCP client connections and tool discovery.
 * Creates clients for configured MCP servers and merges discovered tools.
 */
export class MCPManager {
  private clients: Array<{ name: string; client: MCPClient }> = [];

  /** Connect to all configured MCP servers */
  async connect(configs: MCPServerConfig[]): Promise<void> {
    const results = await Promise.allSettled(
      configs.map(async (config) => {
        const transport = await buildTransport(config);
        const client = await createMCPClient({ transport });
        this.clients.push({ name: config.name, client });
      }),
    );

    // Log failures but don't block
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === "rejected") {
        console.error(`MCP: Failed to connect to "${configs[i]!.name}":`, result.reason);
      }
    }
  }

  /** Get all tools from connected MCP servers, merged into a single record */
  async getTools(): Promise<Record<string, CoreTool>> {
    const allTools: Record<string, CoreTool> = {};

    const results = await Promise.allSettled(
      this.clients.map(async ({ name, client }) => {
        const tools = await client.tools();
        for (const [toolName, tool] of Object.entries(tools)) {
          // Prefix with server name to avoid collisions
          const key = this.clients.length > 1 ? `${name}_${toolName}` : toolName;
          // MCP tools are compatible with CoreTool but types don't overlap directly
          allTools[key] = tool as unknown as CoreTool;
        }
      }),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        console.error("MCP: Failed to get tools:", result.reason);
      }
    }

    return allTools;
  }

  /** Close all MCP client connections */
  async close(): Promise<void> {
    await Promise.allSettled(this.clients.map(({ client }) => client.close()));
    this.clients = [];
  }

  /** Number of connected clients */
  get connectedCount(): number {
    return this.clients.length;
  }
}

async function buildTransport(
  config: MCPServerConfig,
): Promise<{ type: "sse" | "http"; url: string; headers?: Record<string, string> } | MCPTransport> {
  switch (config.transport) {
    case "stdio": {
      if (!config.command) {
        throw new Error(`MCP server "${config.name}" requires a command for stdio transport`);
      }
      return loadStdioTransport(config);
    }
    case "sse":
      if (!config.url) {
        throw new Error(`MCP server "${config.name}" requires a url for sse transport`);
      }
      return { type: "sse", url: config.url, headers: config.headers };
    case "http":
      if (!config.url) {
        throw new Error(`MCP server "${config.name}" requires a url for http transport`);
      }
      return { type: "http", url: config.url, headers: config.headers };
  }
}

async function loadStdioTransport(config: MCPServerConfig): Promise<MCPTransport> {
  const { Experimental_StdioMCPTransport } = await import("@ai-sdk/mcp/mcp-stdio");
  return new Experimental_StdioMCPTransport({
    command: config.command!,
    args: config.args,
    env: config.env,
  });
}
