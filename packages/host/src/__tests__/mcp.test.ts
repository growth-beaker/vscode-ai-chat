import { describe, it, expect, vi, beforeEach } from "vitest";
import { MCPManager } from "../mcp.js";

// Mock @ai-sdk/mcp
vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: vi.fn(),
}));

import { createMCPClient } from "@ai-sdk/mcp";
const mockCreateMCPClient = vi.mocked(createMCPClient);

function createMockClient(tools: Record<string, unknown> = {}) {
  return {
    tools: vi.fn(async () => tools),
    close: vi.fn(async () => {}),
    listTools: vi.fn(),
    toolsFromDefinitions: vi.fn(),
    listResources: vi.fn(),
    readResource: vi.fn(),
    listResourceTemplates: vi.fn(),
    experimental_listPrompts: vi.fn(),
    experimental_getPrompt: vi.fn(),
    onElicitationRequest: vi.fn(),
  };
}

describe("MCPManager", () => {
  let manager: MCPManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new MCPManager();
  });

  it("starts with zero connected clients", () => {
    expect(manager.connectedCount).toBe(0);
  });

  it("connects to SSE server", async () => {
    const mockClient = createMockClient({ myTool: { execute: vi.fn() } });
    mockCreateMCPClient.mockResolvedValue(mockClient as never);

    await manager.connect([{ name: "test", transport: "sse", url: "http://localhost:3000" }]);

    expect(manager.connectedCount).toBe(1);
    expect(mockCreateMCPClient).toHaveBeenCalledWith({
      transport: { type: "sse", url: "http://localhost:3000", headers: undefined },
    });
  });

  it("connects to HTTP server with headers", async () => {
    const mockClient = createMockClient();
    mockCreateMCPClient.mockResolvedValue(mockClient as never);

    await manager.connect([
      {
        name: "test",
        transport: "http",
        url: "http://localhost:3000",
        headers: { Authorization: "Bearer token" },
      },
    ]);

    expect(mockCreateMCPClient).toHaveBeenCalledWith({
      transport: {
        type: "http",
        url: "http://localhost:3000",
        headers: { Authorization: "Bearer token" },
      },
    });
  });

  it("gets tools from connected servers", async () => {
    const mockTools = {
      readFile: { execute: vi.fn(), description: "Read a file" },
      writeFile: { execute: vi.fn(), description: "Write a file" },
    };
    const mockClient = createMockClient(mockTools);
    mockCreateMCPClient.mockResolvedValue(mockClient as never);

    await manager.connect([{ name: "fs", transport: "sse", url: "http://localhost:3000" }]);
    const tools = await manager.getTools();

    expect(Object.keys(tools)).toEqual(["readFile", "writeFile"]);
  });

  it("prefixes tool names when multiple servers connected", async () => {
    const client1 = createMockClient({ read: { execute: vi.fn() } });
    const client2 = createMockClient({ search: { execute: vi.fn() } });

    mockCreateMCPClient
      .mockResolvedValueOnce(client1 as never)
      .mockResolvedValueOnce(client2 as never);

    await manager.connect([
      { name: "fs", transport: "sse", url: "http://localhost:3001" },
      { name: "web", transport: "sse", url: "http://localhost:3002" },
    ]);

    const tools = await manager.getTools();
    expect(Object.keys(tools)).toEqual(["fs_read", "web_search"]);
  });

  it("handles connection failure gracefully", async () => {
    mockCreateMCPClient.mockRejectedValueOnce(new Error("Connection refused"));

    await manager.connect([{ name: "broken", transport: "sse", url: "http://localhost:9999" }]);

    expect(manager.connectedCount).toBe(0);
  });

  it("continues if one server fails while others succeed", async () => {
    const mockClient = createMockClient({ tool1: { execute: vi.fn() } });

    mockCreateMCPClient
      .mockRejectedValueOnce(new Error("Connection refused"))
      .mockResolvedValueOnce(mockClient as never);

    await manager.connect([
      { name: "broken", transport: "sse", url: "http://localhost:9999" },
      { name: "working", transport: "sse", url: "http://localhost:3000" },
    ]);

    expect(manager.connectedCount).toBe(1);
    const tools = await manager.getTools();
    expect(Object.keys(tools)).toEqual(["tool1"]);
  });

  it("closes all clients", async () => {
    const mockClient = createMockClient();
    mockCreateMCPClient.mockResolvedValue(mockClient as never);

    await manager.connect([{ name: "test", transport: "sse", url: "http://localhost:3000" }]);
    expect(manager.connectedCount).toBe(1);

    await manager.close();
    expect(mockClient.close).toHaveBeenCalled();
    expect(manager.connectedCount).toBe(0);
  });

  it("returns empty tools when no clients connected", async () => {
    const tools = await manager.getTools();
    expect(tools).toEqual({});
  });

  it("throws for SSE without URL", async () => {
    await expect(manager.connect([{ name: "bad", transport: "sse" }])).resolves.not.toThrow();
    // Error is caught internally, client not added
    expect(manager.connectedCount).toBe(0);
  });

  it("throws for HTTP without URL", async () => {
    await expect(manager.connect([{ name: "bad", transport: "http" }])).resolves.not.toThrow();
    expect(manager.connectedCount).toBe(0);
  });
});
