/** Configuration for an MCP server connection */
export interface MCPServerConfig {
  /** Display name for this MCP server */
  name: string;
  /** Transport type */
  transport: "stdio" | "sse" | "http";
  /** Command to run (stdio transport) */
  command?: string;
  /** Command arguments (stdio transport) */
  args?: string[];
  /** Environment variables (stdio transport) */
  env?: Record<string, string>;
  /** Server URL (sse/http transport) */
  url?: string;
  /** HTTP headers (sse/http transport) */
  headers?: Record<string, string>;
}
