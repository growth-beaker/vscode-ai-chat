# vscode-ai-chat

A drop-in AI chat UI library for VS Code extensions. Build a fully-featured, multi-threaded chat panel with streaming LLM responses, tool execution, MCP integration, and persistent conversation history — in under 20 lines of code.

**Works with any LLM provider** — Anthropic, OpenAI, Google, Mistral, local models, or anything supported by the [Vercel AI SDK](https://sdk.vercel.ai). Or use **manual mode** to drive the chat UI from your own backend — no Vercel AI SDK required.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Integration Modes](#integration-modes)
- [Configuration Reference](#configuration-reference)
- [LLM Providers](#llm-providers)
- [Tool Integration](#tool-integration)
- [Tool Approval (Human-in-the-Loop)](#tool-approval-human-in-the-loop)
- [MCP Server Integration](#mcp-server-integration)
- [Persistence & Storage](#persistence--storage)
- [Multi-Thread Conversations](#multi-thread-conversations)
- [Model Switching](#model-switching)
- [Chat Templates](#chat-templates)
- [Custom UI & Theming](#custom-ui--theming)
- [Message Editing & Branching](#message-editing--branching)
- [Manual Mode (Custom Backend)](#manual-mode-custom-backend)
- [Message Interception (`onMessage`)](#message-interception-onmessage)
- [Slash Commands](#slash-commands)
- [Progress Indicators](#progress-indicators)
- [Programmatic Control](#programmatic-control)
- [System Messages & User Actions](#system-messages--user-actions)
- [Custom Data Parts & Tool UIs](#custom-data-parts--tool-uis)
- [Webview Setup & Build Configuration](#webview-setup--build-configuration)
- [Extension Manifest (package.json)](#extension-manifest-packagejson)
- [API Reference](#api-reference)
- [Examples](#examples)

---

## Features

- **Streaming Chat UI** — Real-time token streaming with markdown rendering, code highlighting, and cancel support
- **Managed & Manual Modes** — Use with Vercel AI SDK for automatic LLM streaming, or drive the UI yourself from any backend
- **Any LLM Provider** — Anthropic, OpenAI, Google Gemini, Mistral, Ollama, LM Studio, or any Vercel AI SDK-compatible provider
- **Multi-Thread Conversations** — Create, switch, and delete independent chat threads with a sidebar thread list
- **Tool Execution** — Define tools with Zod schemas; the LLM calls them automatically with multi-step reasoning
- **Human-in-the-Loop Approval** — Require user approval before executing sensitive tools
- **MCP Integration** — Connect to Model Context Protocol servers (stdio, HTTP, SSE transports) and expose their tools to the LLM
- **Persistent Storage** — Save conversations to VS Code global state or the filesystem; or provide your own storage adapter
- **Model Switching** — Let users switch between models at runtime from a dropdown
- **Chat Templates** — Pre-configured sessions with custom system prompts, tools, and model overrides
- **Message Editing** — Edit previous messages and regenerate from that point
- **Message Reload** — Re-generate any assistant response
- **Custom Theming** — Inject custom CSS; inherits VS Code theme colors automatically
- **VS Code Native** — Strict CSP compliance, nonce-based script loading, proper webview lifecycle management
- **System Messages** — Inject messages from external workflows (progress cards, approval requests, result summaries)
- **Message Interception** — Hook into user messages before they reach the LLM with `onMessage`
- **Progress Indicators** — Show transient status text during long operations
- **Programmatic Control** — Send messages and execute slash commands from extension code
- **Custom Data Parts** — Render extension-defined UI cards within the conversation

---

## Architecture

The library is split into three packages:

```
┌─────────────────────────────────────────────────┐
│                 Your Extension                   │
│                                                  │
│   ┌─────────────────┐   ┌─────────────────────┐ │
│   │  Extension Host  │   │     Webview (React)  │ │
│   │                  │   │                      │ │
│   │  @vscode-ai-chat │◄─►│  @vscode-ai-chat     │ │
│   │  /host           │   │  /react              │ │
│   └────────┬─────────┘   └──────────┬───────────┘ │
│            │                        │             │
│            └────────┬───────────────┘             │
│                     │                             │
│            ┌────────▼─────────┐                   │
│            │ @vscode-ai-chat  │                   │
│            │ /core            │                   │
│            │ (shared types)   │                   │
│            └──────────────────┘                   │
└─────────────────────────────────────────────────┘
```

| Package | Runtime | Purpose |
|---|---|---|
| `@growthbeaker/ai-chat-core` | Shared | Types, event protocol, and utilities |
| `@growthbeaker/ai-chat-host` | Node.js (extension host) | `ChatWebviewProvider`, LLM streaming, storage, MCP |
| `@growthbeaker/ai-chat-react` | Browser (webview) | `ChatPanel` component, runtime adapter, thread list |

---

## Installation

```bash
# Using pnpm (recommended)
pnpm add @growthbeaker/ai-chat-core @growthbeaker/ai-chat-host @growthbeaker/ai-chat-react

# Using npm
npm install @growthbeaker/ai-chat-core @growthbeaker/ai-chat-host @growthbeaker/ai-chat-react

# Using yarn
yarn add @growthbeaker/ai-chat-core @growthbeaker/ai-chat-host @growthbeaker/ai-chat-react
```

You also need the Vercel AI SDK and a provider of your choice:

```bash
# AI SDK core (required)
pnpm add ai zod

# Pick your provider(s)
pnpm add @ai-sdk/anthropic    # Anthropic (Claude)
pnpm add @ai-sdk/openai       # OpenAI (GPT)
pnpm add @ai-sdk/google       # Google (Gemini)
pnpm add @ai-sdk/mistral      # Mistral

# For MCP support (optional)
pnpm add @ai-sdk/mcp
```

### Peer Dependencies

| Package | Peer Dependencies |
|---|---|
| `@growthbeaker/ai-chat-host` | `ai` (>=4.0.0), `zod` (>=3.0.0), `@ai-sdk/mcp` (>=1.0.0, optional) |
| `@growthbeaker/ai-chat-react` | `react` (>=18.0.0 <20), `react-dom` |

### React

The webview UI requires React. Install it alongside the chat packages:

```bash
pnpm add react react-dom
pnpm add -D @types/react @types/react-dom
```

> **Note:** `@assistant-ui/react` is bundled inside `@growthbeaker/ai-chat-react` — you do not need to install it separately.

---

## Quick Start

A working AI chat panel in two files.

### 1. Extension Host (`src/extension.ts`)

```typescript
import * as vscode from "vscode";
import { ChatWebviewProvider } from "@growthbeaker/ai-chat-host";
import { anthropic } from "@ai-sdk/anthropic";

export function activate(context: vscode.ExtensionContext) {
  const provider = new ChatWebviewProvider(context.extensionUri, {
    model: anthropic("claude-sonnet-4-5"),
    system: "You are a helpful coding assistant.",
    ui: {
      title: "AI Chat",
      placeholder: "Ask me anything...",
    },
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("myExtension.chatView", provider),
  );
}

export function deactivate() {}
```

### 2. Webview Entry (`src/webview/index.tsx`)

```tsx
import { createRoot } from "react-dom/client";
import { ChatPanel } from "@growthbeaker/ai-chat-react";
import "@growthbeaker/ai-chat-react/styles";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<ChatPanel />);
}
```

That's it. You now have a streaming chat panel with markdown rendering, code highlighting, and message cancellation.

---

## Integration Modes

There are two ways to integrate the chat into your extension. Choose based on how much control you need over the UI.

### Mode 1: Standalone View (Sidebar / Panel)

The Quick Start example above uses this mode. `ChatWebviewProvider` acts as a VS Code `WebviewViewProvider` — you register it and VS Code manages the view lifecycle. The chat appears as its own view in the sidebar, bottom panel, or a custom activity bar container.

This is how extensions like [Roo Code](https://github.com/RooVetGit/Roo-Code) integrate chat — a dedicated sidebar panel that users open from the activity bar.

```typescript
// Extension host
const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
});

context.subscriptions.push(
  vscode.window.registerWebviewViewProvider("myExtension.chatView", provider),
);
```

**View placement options** — control where the chat appears in your `package.json`:

| Location | `contributes.views` key | Result |
|---|---|---|
| Custom activity bar icon | `"myContainer"` (with `viewsContainers.activitybar`) | Dedicated icon in the sidebar |
| Explorer | `"explorer"` | Nested inside the Explorer panel |
| Bottom panel | `"panel"` | Tab in the bottom panel area |
| SCM / Debug / Test | `"scm"` / `"debug"` / `"test"` | Nested in those built-in panels |

You can also place the chat alongside your other views under a single activity bar icon:

```json
{
  "viewsContainers": {
    "activitybar": [
      { "id": "myExtension", "title": "My Extension", "icon": "$(tools)" }
    ]
  },
  "views": {
    "myExtension": [
      { "id": "myExtension.dashboard", "name": "Dashboard", "type": "webview" },
      { "id": "myExtension.chatView", "name": "AI Chat", "type": "webview" },
      { "id": "myExtension.history", "name": "History" }
    ]
  }
}
```

Users can collapse, expand, drag, or hide individual views. The chat is just another VS Code view — no special close/back button needed.

**Programmatic control** — open or focus the chat from your extension code:

```typescript
// Focus the chat (opens it if collapsed or hidden)
await vscode.commands.executeCommand("myExtension.chatView.focus");

// Reveal the entire view container
await vscode.commands.executeCommand("workbench.view.extension.myExtension");
```

### Mode 2: Embedded Component

If your extension already has its own React-based webview, you can embed `ChatPanel` directly inside your existing UI as a regular React component. This gives you full control over layout, sizing, and visibility.

```tsx
// Your extension's webview — ChatPanel is just another component
import { createRoot } from "react-dom/client";
import { ChatPanel } from "@growthbeaker/ai-chat-react";
import "@growthbeaker/ai-chat-react/styles";
import { MyDashboard, MySidebar } from "./components";

function App() {
  const [showChat, setShowChat] = useState(false);

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <MySidebar />
      <MyDashboard onOpenChat={() => setShowChat(true)} />
      {showChat && (
        <div style={{ width: "350px", borderLeft: "1px solid var(--vscode-panel-border)" }}>
          <ChatPanel />
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
```

The extension host still uses `ChatWebviewProvider` to handle the message bridge and LLM streaming — but you register it against your own webview rather than as a standalone view. The `ChatPanel` component communicates with the host via `postMessage` just like in standalone mode.

This approach is ideal when you want the chat to feel like a native part of your extension's UI rather than a separate panel.

---

## Configuration Reference

The `ChatWebviewProvider` constructor accepts an `extensionUri` and a `ChatProviderConfig` object:

```typescript
interface ChatProviderConfig {
  /** The default LLM model. Omit for manual mode. */
  model?: LanguageModel;

  /** Additional models for runtime switching, keyed by display ID */
  models?: ModelMap;

  /** System prompt sent with every request */
  system?: string;

  /** Tool definitions (Vercel AI SDK CoreTool instances) */
  tools?: ToolDefinitions;

  /** Maximum tool-use steps per generation (default: 5) */
  maxSteps?: number;

  /** Tools that require user approval before execution */
  requiresApproval?: ToolApprovalConfig;

  /** UI configuration */
  ui?: ChatConfig;

  /** Persistence configuration (omit for in-memory only) */
  persistence?: PersistenceConfig;

  /** MCP server configurations */
  mcpServers?: MCPServerConfig[];

  /** Chat session templates */
  templates?: ChatTemplate[];

  /** Slash commands available in the chat */
  slashCommands?: SlashCommandHandler[];

  /** Context mention provider for @file, @workspace, @symbol resolution */
  contextMentionProvider?: ContextMentionProvider;

  /** Message interceptor — called before messages reach the LLM */
  onMessage?: (message: string, thread: ChatThread) => OnMessageResult | Promise<OnMessageResult>;

  /** Cancel callback — runs custom logic when the user cancels generation */
  onCancel?: () => void | Promise<void>;

  /** Tool result callback — fires after each tool execution completes */
  onToolResult?: (toolName: string, args: unknown, result: unknown) => void | Promise<void>;
}
```

### UI Configuration (`ChatConfig`)

```typescript
interface ChatConfig {
  /** Display name for the chat panel */
  title?: string;

  /** Placeholder text in the input box */
  placeholder?: string;

  /** Whether to show the thread list sidebar */
  showThreadList?: boolean;

  /** Whether to allow message editing */
  allowEditing?: boolean;

  /** Whether to allow message branching */
  allowBranching?: boolean;

  /** Custom CSS to inject into the webview */
  customCss?: string;

  /** Maximum number of threads to persist */
  maxThreads?: number;

  /** Currently active model identifier */
  activeModel?: string;
}
```

### Full Configuration Example

```typescript
import { ChatWebviewProvider } from "@growthbeaker/ai-chat-host";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { tool } from "ai";
import { z } from "zod";

const provider = new ChatWebviewProvider(context.extensionUri, {
  // Default model
  model: anthropic("claude-sonnet-4-5"),

  // Multiple models for switching
  models: {
    "claude-sonnet": () => anthropic("claude-sonnet-4-5"),
    "claude-haiku": () => anthropic("claude-haiku-4-5-20251001"),
    "gpt-4o": () => openai("gpt-4o"),
  },

  // System prompt
  system: "You are a senior software engineer. Be concise and precise.",

  // Tools
  tools: {
    getWeather: tool({
      description: "Get the current weather for a city",
      parameters: z.object({
        city: z.string().describe("The city name"),
      }),
      execute: async ({ city }) => {
        return { temperature: 72, condition: "sunny", city };
      },
    }),
  },

  // Require approval for specific tools
  requiresApproval: ["deleteFile", "runCommand"],

  // Max tool-use steps
  maxSteps: 10,

  // UI options
  ui: {
    title: "Code Assistant",
    placeholder: "Describe what you need...",
    showThreadList: true,
    allowEditing: true,
    allowBranching: true,
    maxThreads: 50,
  },

  // Persist conversations to filesystem
  persistence: {
    type: "filesystem",
    storagePath: context.globalStorageUri.fsPath + "/chat-history",
  },

  // MCP servers
  mcpServers: [
    {
      name: "filesystem",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
    },
  ],

  // Chat templates
  templates: [
    {
      id: "code-review",
      label: "Code Review",
      systemPrompt: "You are a code reviewer. Focus on bugs, security, and best practices.",
    },
    {
      id: "docs-writer",
      label: "Documentation Writer",
      systemPrompt: "You write clear, concise technical documentation.",
    },
  ],
});
```

---

## LLM Providers

Any [Vercel AI SDK](https://sdk.vercel.ai/providers) provider works out of the box.

### Anthropic (Claude)

```typescript
import { anthropic } from "@ai-sdk/anthropic";

const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
});
```

Requires `ANTHROPIC_API_KEY` in the environment.

### OpenAI (GPT)

```typescript
import { openai } from "@ai-sdk/openai";

const provider = new ChatWebviewProvider(context.extensionUri, {
  model: openai("gpt-4o"),
});
```

Requires `OPENAI_API_KEY` in the environment.

### Google (Gemini)

```typescript
import { google } from "@ai-sdk/google";

const provider = new ChatWebviewProvider(context.extensionUri, {
  model: google("gemini-2.0-flash"),
});
```

Requires `GOOGLE_GENERATIVE_AI_API_KEY` in the environment.

### Ollama (Local Models)

```typescript
import { ollama } from "ollama-ai-provider";

const provider = new ChatWebviewProvider(context.extensionUri, {
  model: ollama("llama3.2"),
});
```

No API key required — runs locally.

### Custom / OpenAI-Compatible

```typescript
import { createOpenAI } from "@ai-sdk/openai";

const lmstudio = createOpenAI({
  baseURL: "http://localhost:1234/v1",
  apiKey: "not-needed",
});

const provider = new ChatWebviewProvider(context.extensionUri, {
  model: lmstudio("my-local-model"),
});
```

---

## Tool Integration

Define tools using the Vercel AI SDK's `tool()` function with Zod schemas. The LLM can invoke these tools automatically during conversation, with multi-step reasoning (up to `maxSteps` iterations).

### Basic Tool Definition

```typescript
import { tool } from "ai";
import { z } from "zod";

const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  tools: {
    readFile: tool({
      description: "Read the contents of a file in the workspace",
      parameters: z.object({
        path: z.string().describe("Relative file path"),
      }),
      execute: async ({ path }) => {
        const uri = vscode.Uri.joinPath(
          vscode.workspace.workspaceFolders![0].uri,
          path,
        );
        const content = await vscode.workspace.fs.readFile(uri);
        return new TextDecoder().decode(content);
      },
    }),

    listFiles: tool({
      description: "List files in a directory",
      parameters: z.object({
        directory: z.string().describe("Directory path").default("."),
        pattern: z.string().describe("Glob pattern").default("**/*"),
      }),
      execute: async ({ directory, pattern }) => {
        const uri = vscode.Uri.joinPath(
          vscode.workspace.workspaceFolders![0].uri,
          directory,
        );
        const files = await vscode.workspace.findFiles(
          new vscode.RelativePattern(uri, pattern),
          null,
          50,
        );
        return files.map((f) => vscode.workspace.asRelativePath(f));
      },
    }),

    runTerminalCommand: tool({
      description: "Execute a command in the terminal",
      parameters: z.object({
        command: z.string().describe("Shell command to execute"),
      }),
      execute: async ({ command }) => {
        const terminal = vscode.window.createTerminal("AI Chat");
        terminal.sendText(command);
        terminal.show();
        return { status: "executed", command };
      },
    }),
  },
  maxSteps: 10, // Allow up to 10 tool-use iterations per response
});
```

### Multi-Step Tool Use

When `maxSteps` > 1 (default is 5), the LLM can call tools, inspect results, and call more tools before composing a final answer. For example, the LLM might:

1. Call `listFiles` to find relevant files
2. Call `readFile` to read their contents
3. Analyze the code and provide a response

All of this happens in a single streaming response.

### Observing Tool Results

Use `onToolResult` to observe tool executions without wrapping each tool. This is useful for tracking side effects, updating external state, or triggering follow-up actions:

```typescript
const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  tools: { readFile, writeFile, listFiles },
  onToolResult: (toolName, args, result) => {
    if (toolName === "writeFile") {
      modifiedFiles.add((args as { path: string }).path);
    }
  },
});
```

The callback fires after each tool execution completes and the result is streamed to the webview. Errors thrown in the callback are logged but do not interrupt the LLM stream.

---

## Tool Approval (Human-in-the-Loop)

Require user approval before executing potentially dangerous tools.

### By Tool Name

```typescript
const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  tools: {
    readFile: tool({ /* ... */ }),
    deleteFile: tool({ /* ... */ }),
    runCommand: tool({ /* ... */ }),
    search: tool({ /* ... */ }),
  },
  // Only these tools require approval; others execute immediately
  requiresApproval: ["deleteFile", "runCommand"],
});
```

### By Predicate Function

```typescript
const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  tools: { /* ... */ },
  requiresApproval: (toolName) => {
    // Approve read operations automatically; require approval for writes
    return !toolName.startsWith("read") && !toolName.startsWith("list");
  },
});
```

When a tool requires approval:
1. The tool call is sent to the webview UI
2. The user sees the tool name and arguments
3. The user approves or denies execution (with optional feedback)
4. If denied, the LLM receives a denial message and can adjust its approach

---

## MCP Server Integration

Connect to [Model Context Protocol](https://modelcontextprotocol.io/) servers. Tools discovered from MCP servers are automatically merged with local tools and made available to the LLM.

### stdio Transport

```typescript
const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  mcpServers: [
    {
      name: "filesystem",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
    },
    {
      name: "database",
      transport: "stdio",
      command: "node",
      args: ["./mcp-servers/database-server.js"],
      env: {
        DATABASE_URL: "postgresql://localhost:5432/mydb",
      },
    },
  ],
});
```

### HTTP / SSE Transport

```typescript
const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  mcpServers: [
    {
      name: "remote-tools",
      transport: "http",
      url: "https://my-mcp-server.example.com/mcp",
      headers: {
        Authorization: "Bearer my-token",
      },
    },
    {
      name: "legacy-server",
      transport: "sse",
      url: "https://sse-server.example.com/events",
    },
  ],
});
```

### MCPServerConfig

```typescript
interface MCPServerConfig {
  /** Display name for this MCP server */
  name: string;
  /** Transport type */
  transport: "stdio" | "sse" | "http";
  /** Command to run (stdio transport only) */
  command?: string;
  /** Command arguments (stdio transport only) */
  args?: string[];
  /** Environment variables (stdio transport only) */
  env?: Record<string, string>;
  /** Server URL (sse/http transport only) */
  url?: string;
  /** HTTP headers (sse/http transport only) */
  headers?: Record<string, string>;
}
```

When multiple MCP servers are connected, tool names are prefixed with the server name to avoid collisions (e.g., `filesystem_readFile`). If only one server is connected, tools use their original names.

MCP connection failures are logged but do not block the chat from loading.

---

## Persistence & Storage

By default, conversations are kept in memory and lost when the webview is disposed. Enable persistence to save conversations across sessions.

### Global State (VS Code Memento)

Best for small to medium conversations. Uses VS Code's built-in `globalState` storage.

```typescript
const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  persistence: {
    type: "globalState",
    globalState: context.globalState,
  },
});
```

### Filesystem

Best for large conversations. Stores each thread as a separate JSON file.

```typescript
const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  persistence: {
    type: "filesystem",
    storagePath: context.globalStorageUri.fsPath + "/chat-history",
  },
});
```

Files are stored as:
```
<storagePath>/
  threads.json          # Thread index (summaries)
  thread-<id>.json      # Individual thread data
```

### Custom Storage Adapter

Implement the `ThreadStorage` interface for custom backends (database, cloud, etc.):

```typescript
import type { ThreadStorage, ChatThread, ThreadSummary } from "@growthbeaker/ai-chat-core";

class MyCloudStorage implements ThreadStorage {
  async listThreads(): Promise<ThreadSummary[]> {
    // Fetch thread summaries from your backend
    return await fetch("/api/threads").then((r) => r.json());
  }

  async loadThread(threadId: string): Promise<ChatThread | undefined> {
    // Fetch a full thread by ID
    const res = await fetch(`/api/threads/${threadId}`);
    if (!res.ok) return undefined;
    return res.json();
  }

  async saveThread(thread: ChatThread): Promise<void> {
    // Save or update a thread
    await fetch(`/api/threads/${thread.id}`, {
      method: "PUT",
      body: JSON.stringify(thread),
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    // Delete a thread
    await fetch(`/api/threads/${threadId}`, { method: "DELETE" });
  }
}

const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  persistence: {
    type: "custom",
    storage: new MyCloudStorage(),
  },
});
```

---

## Multi-Thread Conversations

Enable the thread list sidebar for multi-thread support:

```typescript
const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  ui: {
    showThreadList: true,
    maxThreads: 50,
  },
  persistence: {
    type: "globalState",
    globalState: context.globalState,
  },
});
```

In the webview, pass `showThreadList` to `ChatPanel`:

```tsx
<ChatPanel showThreadList />
```

Users can:
- Create new threads
- Switch between threads
- Delete threads (cannot delete the last remaining thread)
- Threads are sorted by most recently updated

### Programmatic Thread Access

```typescript
// Get the current active thread
const thread = provider.getCurrentThread();

// Get all threads
const allThreads = provider.getAllThreads();

// Get lightweight summaries (for lists)
const summaries = provider.getThreadSummaries();
```

---

## Model Switching

Let users switch between models at runtime:

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";

const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  models: {
    "Claude Sonnet": () => anthropic("claude-sonnet-4-5"),
    "Claude Haiku": () => anthropic("claude-haiku-4-5-20251001"),
    "GPT-4o": () => openai("gpt-4o"),
    "GPT-4o Mini": () => openai("gpt-4o-mini"),
  },
  ui: {
    activeModel: "Claude Sonnet", // Initial selection
  },
});
```

In the webview, pass the model IDs:

```tsx
<ChatPanel models={["Claude Sonnet", "Claude Haiku", "GPT-4o", "GPT-4o Mini"]} />
```

The model selector dropdown appears when more than one model is provided. The `models` map uses factory functions (not instances) so models are only instantiated when selected.

### Programmatic Model Access

```typescript
// Get the current model
const model = provider.getActiveModel();

// Get available model IDs
const ids = provider.getAvailableModelIds(); // ["Claude Sonnet", "Claude Haiku", ...]
```

---

## Chat Templates

Pre-configured session templates with custom system prompts, tools, and model overrides. Users select a template to change the chat's behavior.

```typescript
const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  templates: [
    {
      id: "code-review",
      label: "Code Review",
      systemPrompt:
        "You are a code reviewer. Analyze code for bugs, security issues, performance problems, and adherence to best practices. Be specific and actionable.",
      tools: {
        readFile: tool({ /* ... */ }),
        getDiff: tool({ /* ... */ }),
      },
    },
    {
      id: "docs",
      label: "Documentation",
      systemPrompt: "You write clear technical documentation. Use examples.",
    },
    {
      id: "debug",
      label: "Debug Assistant",
      systemPrompt: "You are a debugging expert. Ask clarifying questions. Use tools to inspect code.",
      tools: {
        readFile: tool({ /* ... */ }),
        runTest: tool({ /* ... */ }),
        getStackTrace: tool({ /* ... */ }),
      },
      model: anthropic("claude-sonnet-4-5"), // Override the default model
    },
  ],
});
```

### Runtime Template Registration

Register templates dynamically after initialization:

```typescript
provider.registerTemplate({
  id: "custom-review",
  label: "Custom Review",
  systemPrompt: "Review code for our team's specific patterns...",
});

// Query templates
const templates = provider.getTemplates();
const active = provider.getActiveTemplate();
```

---

## Custom UI & Theming

### Custom CSS

Inject custom CSS into the webview:

```typescript
const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  ui: {
    customCss: `
      .aui-thread-message {
        border-radius: 12px;
        margin: 8px 0;
      }
      .aui-composer-input {
        font-size: 14px;
      }
    `,
  },
});
```

### VS Code Theme Integration

The `@growthbeaker/ai-chat-react` package includes a `vscode-theme.css` file that maps VS Code CSS variables to the chat UI. Your webview automatically inherits the user's VS Code theme (light, dark, or high contrast).

In your webview build, import the combined styles (includes both the base UI styles and VS Code theme):

```tsx
import "@growthbeaker/ai-chat-react/styles";
```

---

## Message Editing & Branching

Enable message editing and branching in the UI:

```typescript
const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  ui: {
    allowEditing: true,
    allowBranching: true,
  },
});
```

When a user edits a message:
1. The message content is updated
2. All subsequent messages are removed (history truncation)
3. If the edited message is a user message, a new assistant response is automatically generated

When a user reloads a message:
1. The assistant message (and everything after it) is removed
2. A new assistant response is generated from the remaining history

---

## Manual Mode (Custom Backend)

Omit `model` from the config to use **manual mode** — the chat UI becomes a "dumb pipe" that you control from your extension. This is ideal when your LLM calls go through a separate SDK (Claude Agent SDK, custom API, etc.) rather than Vercel AI SDK.

### Setting Up Manual Mode

```typescript
const provider = new ChatWebviewProvider(context.extensionUri, {
  // No model — manual mode
  ui: {
    title: "Agent Chat",
    placeholder: "Talk to the agent...",
  },
});
```

When the user sends a message, the provider adds it to the thread and persists it — but does **not** call any LLM. Your extension is responsible for generating responses.

### Streaming from Your Backend

Use the manual streaming API to push content to the chat UI:

```typescript
// Start a new assistant message stream
const messageId = provider.pushStreamStart();

// Push text chunks (convenience shorthand)
provider.pushText("Analyzing your code...");
provider.pushText(" Found 3 issues.");

// Or push structured content parts (tool-calls, images, data, etc.)
provider.pushStreamDelta({ type: "tool-call", toolCallId: "tc1", toolName: "lint", args: {} });

// End the stream (optionally include token usage)
provider.pushStreamEnd({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
```

For errors, use `pushStreamError()` with an optional classification code:

```typescript
// Simple error
provider.pushStreamError("Connection to agent lost. Please try again.");

// Classified error — lets the webview distinguish cancel from real errors
provider.pushStreamError("Request cancelled by user", "cancel");
provider.pushStreamError("Rate limited, try again later", "rate-limit");
```

### Input Hints

After a stream ends, signal what the user should do next with `setInputHint()`:

```typescript
provider.pushStreamEnd();
provider.setInputHint("Approve the changes above, or describe what to change…");

// Later, clear the hint
provider.setInputHint(null);
```

The hint text appears as the composer's placeholder, giving visual context that the extension is waiting for input.

### Tool Rendering in Manual Mode

When your backend executes tools, render the calls and results in the chat UI:

```typescript
// Show a tool call card
provider.pushToolCall("tc1", "readFile", { path: "/src/main.ts" });

// Later, show the result (removes the pending card)
provider.pushToolResult("tc1", { content: "import { app } from './app';" });
```

For human-in-the-loop approval, use `requestToolApproval()` which posts the tool call card and returns a Promise that resolves when the user approves or denies:

```typescript
const { approved, feedback } = await provider.requestToolApproval(
  "tc2", "writeFile", { path: "/src/main.ts", content: "..." }
);
if (approved) {
  await fs.writeFile(path, content);
  provider.pushToolResult("tc2", { status: "written" });
} else {
  provider.pushToolResult("tc2", { status: "denied", feedback });
}
```

### Example: SDK Bridge Integration

```typescript
// Subscribe to your SDK's message stream
sdkBridge.subscribe(async (event) => {
  if (event.type === "start") {
    provider.pushStreamStart();
  } else if (event.type === "text") {
    provider.pushText(event.text);
  } else if (event.type === "tool_use") {
    // Show tool call, optionally require approval
    if (event.requiresApproval) {
      const { approved } = await provider.requestToolApproval(event.id, event.name, event.args);
      if (!approved) return sdkBridge.denyTool(event.id);
    } else {
      provider.pushToolCall(event.id, event.name, event.args);
    }
  } else if (event.type === "tool_result") {
    provider.pushToolResult(event.toolCallId, event.result);
  } else if (event.type === "end") {
    provider.pushStreamEnd();
  } else if (event.type === "error") {
    provider.pushStreamError(event.message, event.cancelled ? "cancel" : "network");
  } else if (event.type === "waiting") {
    provider.setInputHint(event.prompt);
  }
});
```

---

## Message Interception (`onMessage`)

Intercept user messages before they reach the LLM. Useful for routing input to external systems, handling human-in-the-loop workflows, or implementing custom commands.

```typescript
const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  onMessage: async (message, thread) => {
    // Check if the SDK bridge is waiting for user input
    if (sdkBridge.hasPendingInput()) {
      sdkBridge.resolveInput(message);
      return { handled: true };  // Don't send to LLM
    }

    // Let everything else through to the LLM
    return "passthrough";
  },
});
```

The `onMessage` callback receives the user's text and the current thread. Return `"passthrough"` to let the message proceed to the LLM, or `{ handled: true }` to consume it.

> **Note:** `onMessage` is only called in managed mode (when `model` is set). In manual mode, all messages are always routed to the extension.

---

## Slash Commands

Register slash commands with a rich response context for streaming output:

```typescript
const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  slashCommands: [
    {
      name: "status",
      description: "Show workflow status",
      execute: async (args, ctx) => {
        // Show a transient progress indicator
        ctx.progress("Fetching status...");

        const status = await fetchWorkflowStatus();

        // Post a rich response
        ctx.respond(`**Status:** ${status.state}\n\n**Steps:** ${status.completedSteps}/${status.totalSteps}`);
      },
    },
    {
      name: "help",
      description: "Show available commands",
      execute: async () => {
        // Returning a string still works (posts as system message)
        return "Available commands:\n- /status — Show workflow status\n- /help — Show this message";
      },
    },
  ],
});
```

### Slash Command Context

The `execute` function receives a `SlashCommandContext` with these methods:

| Method | Description |
|---|---|
| `ctx.respond(text)` | Post a text response as a system message |
| `ctx.respondContent(parts)` | Post structured `ChatContentPart[]` as a system message |
| `ctx.progress(text)` | Show a transient progress indicator (doesn't persist) |
| `ctx.threadId` | The ID of the active thread |

You can also register slash commands at runtime:

```typescript
provider.registerSlashCommand({
  name: "deploy",
  description: "Deploy the current build",
  execute: async (args, ctx) => {
    ctx.progress("Deploying...");
    await deploy(args);
    ctx.respond("Deployment complete.");
  },
});
```

---

## Progress Indicators

Show transient status text during long operations. Progress text is not persisted in the thread history.

```typescript
// From the extension host
provider.pushProgress("Connecting to server...");

// From a slash command handler
ctx.progress("Building project...");
```

The React hook exposes `progressText` for rendering in the UI:

```tsx
const { progressText } = useVSCodeRuntime();

{progressText && <div className="progress">{progressText}</div>}
```

---

## Programmatic Control

Send user messages and execute slash commands from extension code — useful for play buttons, command palette actions, or other UI triggers.

```typescript
// Focus the chat view first
await vscode.commands.executeCommand("myExtension.chatView.focus");

// Send a message as if the user typed it
provider.sendUserMessage("Explain this error");

// Execute a slash command programmatically
provider.executeSlashCommand("status");
provider.executeSlashCommand("run", "my-workflow");
```

In managed mode, `sendUserMessage()` triggers LLM streaming. In manual mode, the message is added to the thread for your extension to handle.

### Waiting for the Webview

Use `waitForReady()` to ensure the webview has mounted before posting messages. This replaces arbitrary delays after showing the panel.

```typescript
await vscode.commands.executeCommand("myExtension.chatView.focus");
await provider.waitForReady();

// Now safe to post messages — the webview is listening
provider.sendUserMessage("Explain this error");
```

Resolves immediately if the webview is already ready. Resets automatically when the webview is recreated.

### Triggering Responses Without a User Message

Use `triggerAssistantResponse()` in manual mode to kick off an assistant response without showing a user message bubble. This is useful for conversation kickoffs, auto-advancing multi-step workflows, or any case where Claude should respond without a preceding user action.

```typescript
// Post welcome content, then trigger Claude's first response
provider.postAssistantMessage([{ type: "text", text: "Welcome to your risk assessment." }]);
provider.triggerAssistantResponse("Start with the first risk.");
// Claude's response streams in naturally — no fake user bubble
```

The prompt is passed to your `onMessage` hook, which routes it to your bridge for streaming. No user message is added to the thread. No-op if no `onMessage` hook is configured.

### Dynamic System Prompt

Update the system prompt at runtime without creating a template:

```typescript
// Change the system prompt based on user selection
provider.setSystemPrompt(`You are a code reviewer. Focus on: ${selectedRules.join(", ")}`);
```

Takes effect on the next LLM request. Template system prompts still take priority when a template is active.

### Pre-Populated Threads

Create threads with seed messages for onboarding or context setup:

```typescript
import { createThread } from "@growthbeaker/ai-chat-core";

const thread = createThread({
  title: "Code Review Session",
  messages: [
    {
      id: "welcome-1",
      role: "assistant",
      content: [{ type: "text", text: "I'll review your changes. Paste a diff or describe what you'd like me to look at." }],
      createdAt: new Date(),
    },
  ],
});
```

---

## System Messages & User Actions

Inject messages into the chat from external code — useful for workflow progress updates, approval requests, or result summaries.

### Posting System Messages

```typescript
// Post a text message
provider.postSystemMessage([
  { type: "text", text: "Build completed successfully. 0 errors, 2 warnings." },
]);

// Post a custom data card
provider.postSystemMessage([
  {
    type: "data",
    name: "build-result",
    data: {
      status: "success",
      duration: "12.4s",
      warnings: ["Unused import in file.ts", "Deprecated API usage"],
    },
  },
]);
```

### Waiting for User Actions

Wait for user interaction with a card (approve/reject/respond):

```typescript
// Post an approval card and wait for the user's response
provider.postSystemMessage([
  {
    type: "data",
    name: "deploy-approval",
    data: {
      environment: "production",
      changes: 14,
      actionId: "deploy-123",
    },
  },
]);

const result = await provider.waitForUserAction("deploy-123");
// result contains whatever the user sent back (e.g., { approved: true })
```

---

## Custom Data Parts & Tool UIs

### Custom Data Part Renderers

Render custom UI components for `data` content parts in the webview:

```tsx
import { ChatPanel } from "@growthbeaker/ai-chat-react";
import type { DataPartRenderers } from "@growthbeaker/ai-chat-react";

const dataParts: DataPartRenderers = {
  "build-result": ({ data }) => (
    <div className="build-card">
      <span className={data.status === "success" ? "green" : "red"}>
        {data.status}
      </span>
      <p>Duration: {data.duration}</p>
    </div>
  ),
  "deploy-approval": ({ data }) => (
    <div className="approval-card">
      <p>Deploy to {data.environment}?</p>
      <button onClick={() => /* send approval */}>Approve</button>
    </div>
  ),
};

createRoot(root).render(<ChatPanel dataParts={dataParts} />);
```

### Tool UI Components

Create custom UIs for tool calls:

```tsx
import { ChatPanel, makeAssistantToolUI } from "@growthbeaker/ai-chat-react";

const WeatherToolUI = makeAssistantToolUI({
  toolName: "getWeather",
  render: ({ args, result, status }) => {
    if (status === "running") return <p>Checking weather for {args.city}...</p>;
    if (result) {
      return (
        <div className="weather-card">
          <h4>{result.city}</h4>
          <p>{result.temperature}°F — {result.condition}</p>
        </div>
      );
    }
    return null;
  },
});

createRoot(root).render(
  <ChatPanel toolUIs={[WeatherToolUI]} />,
);
```

---

## Webview Setup & Build Configuration

The webview needs to be bundled separately from the extension host code.

### esbuild Configuration

```javascript
// esbuild.config.mjs
import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  sourcemap: true,
  minify: !isWatch,
  logLevel: "info",
};

// Build 1: Extension host (Node.js, CJS for VS Code)
const extensionBuild = esbuild.build({
  ...shared,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  format: "cjs",
  platform: "node",
  external: ["vscode"],
});

// Build 2: Webview (Browser, IIFE for injection)
const webviewBuild = esbuild.build({
  ...shared,
  entryPoints: ["src/webview/index.tsx"],
  outfile: "dist/webview.js",
  format: "iife",
  platform: "browser",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

// Build 3: VS Code theme CSS
const cssBuild = esbuild.build({
  ...shared,
  entryPoints: ["src/webview/styles.css"],
  outfile: "dist/vscode-theme.css",
  minify: !isWatch,
});

await Promise.all([extensionBuild, webviewBuild, cssBuild]);

// Merge CSS: assistant-ui styles + VS Code theme
import { readFileSync, writeFileSync, existsSync } from "fs";
const auiCss = existsSync("dist/webview.css")
  ? readFileSync("dist/webview.css", "utf-8")
  : "";
const themeCss = readFileSync("dist/vscode-theme.css", "utf-8");
writeFileSync("dist/webview.css", auiCss + "\n" + themeCss);
```

### Webview Styles Entry

Create `src/webview/styles.css` that imports the VS Code theme:

```css
@import "@growthbeaker/ai-chat-react/styles";
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Extension Manifest (package.json)

Your extension's `package.json` must declare the webview view, a view container, and the activation event:

```json
{
  "name": "my-ai-extension",
  "displayName": "My AI Extension",
  "version": "0.1.0",
  "engines": {
    "vscode": "^1.96.0"
  },
  "activationEvents": [
    "onView:myExtension.chatView"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "myAIChat",
          "title": "AI Chat",
          "icon": "$(comment-discussion)"
        }
      ]
    },
    "views": {
      "myAIChat": [
        {
          "type": "webview",
          "id": "myExtension.chatView",
          "name": "AI Chat"
        }
      ]
    }
  },
  "dependencies": {
    "@ai-sdk/anthropic": "^1.0.0",
    "@growthbeaker/ai-chat-core": "latest",
    "@growthbeaker/ai-chat-host": "latest",
    "@growthbeaker/ai-chat-react": "latest",
    "ai": "^4.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/vscode": "^1.96.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.7.0"
  },
  "scripts": {
    "build": "node esbuild.config.mjs",
    "build:watch": "node esbuild.config.mjs --watch",
    "typecheck": "tsc --noEmit"
  }
}
```

**View placement options**: Instead of a custom activity bar container, you can place the chat view in VS Code's built-in panels:

```json
{
  "contributes": {
    "views": {
      "explorer": [
        {
          "type": "webview",
          "id": "myExtension.chatView",
          "name": "AI Chat"
        }
      ]
    }
  }
}
```

Valid built-in containers: `explorer`, `scm`, `debug`, `test`, `panel`.

---

## API Reference

### `ChatWebviewProvider`

The primary class for extension developers. Implements VS Code's `WebviewViewProvider` interface.

#### Constructor

```typescript
new ChatWebviewProvider(extensionUri: vscode.Uri, config: ChatProviderConfig)
```

#### Methods

| Method | Returns | Description |
|---|---|---|
| `resolveWebviewView(view, context, token)` | `void` | Called by VS Code when the webview view is resolved. Do not call directly. |
| `postToWebview(event)` | `void` | Send a typed event to the webview |
| `getCurrentThread()` | `ChatThread` | Get the currently active thread |
| `getAllThreads()` | `ChatThread[]` | Get all threads |
| `getThreadSummaries()` | `ThreadSummary[]` | Get lightweight thread summaries |
| `postSystemMessage(content)` | `void` | Inject a system message into the current thread (with `metadata: { source: "system" }`) |
| `postAssistantMessage(content)` | `void` | Inject a regular assistant message into the current thread (no system metadata) |
| `waitForUserAction(actionId)` | `Promise<unknown>` | Wait for user interaction with an action card |
| `registerTemplate(template)` | `void` | Register a chat template at runtime |
| `getTemplates()` | `ChatTemplate[]` | Get all registered templates |
| `getActiveTemplate()` | `ChatTemplate \| null` | Get the currently active template |
| `getActiveModel()` | `LanguageModel \| undefined` | Get the currently active model (undefined in manual mode) |
| `getAvailableModelIds()` | `string[]` | Get available model IDs |
| `registerSlashCommand(handler)` | `void` | Register a slash command at runtime |
| `getSlashCommands()` | `SlashCommandHandler[]` | Get all registered slash commands |
| `pushStreamStart()` | `string` | Begin a manual assistant stream; returns the message ID |
| `pushText(text)` | `void` | Convenience shorthand for `pushStreamDelta({ type: "text", text })` |
| `pushStreamDelta(delta)` | `void` | Push a content delta to the current manual stream |
| `pushStreamEnd(usage?)` | `void` | End the current manual stream |
| `pushStreamError(error, code?)` | `void` | Signal an error in the current manual stream (optional classification code) |
| `setInputHint(hint)` | `void` | Set composer placeholder text (pass `null` to clear) |
| `pushToolCall(toolCallId, toolName, args)` | `void` | Post a tool call card to the webview (manual mode) |
| `pushToolResult(toolCallId, result)` | `void` | Post a tool result to the webview (manual mode) |
| `requestToolApproval(toolCallId, toolName, args)` | `Promise<{ approved, feedback? }>` | Post tool call + await user approval (manual mode) |
| `pushProgress(text)` | `void` | Post a transient progress indicator |
| `setSystemPrompt(prompt)` | `void` | Update the system prompt at runtime (takes effect on next request) |
| `sendUserMessage(text)` | `void` | Programmatically send a user message |
| `triggerAssistantResponse(prompt)` | `void` | Trigger an assistant response via `onMessage` without adding a user message to the thread |
| `waitForReady()` | `Promise<void>` | Wait for the webview to mount and send its ready event; resolves immediately if already ready |
| `executeSlashCommand(name, args?)` | `void` | Programmatically execute a slash command |
| `dispose()` | `void` | Clean up resources (cancel streaming, close MCP, dispose subscriptions) |

#### Properties

| Property | Type | Description |
|---|---|---|
| `isStreaming` | `boolean` | Whether the LLM is currently generating a response |
| `pendingApprovalCount` | `number` | Number of pending tool approval requests |
| `pendingUserActionCount` | `number` | Number of pending user action requests |

### `ChatPanel` (React Component)

The main webview UI component.

```typescript
interface ChatPanelProps {
  /** Tool UI components created via makeAssistantToolUI */
  toolUIs?: ComponentType[];
  /** Custom data-part renderers keyed by data part name */
  dataParts?: DataPartRenderers;
  /** Additional CSS class names */
  className?: string;
  /** Override VS Code API (for testing) */
  vscodeApi?: UseVSCodeRuntimeOptions["vscodeApi"];
  /** Whether to show the thread list sidebar */
  showThreadList?: boolean;
  /** Available model IDs for the model selector */
  models?: string[];
}
```

### Core Types

```typescript
// Message structure
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: ChatContentPart[];
  createdAt?: Date;
  metadata?: Record<string, unknown>;
}

// Content part types
type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool-result"; toolCallId: string; toolName: string; result: unknown }
  | { type: "data"; name: string; data: unknown };

// Thread structure
interface ChatThread {
  id: string;
  title?: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

// Thread summary (for lists)
interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: Date;
}

// Storage interface
interface ThreadStorage {
  listThreads(): Promise<ThreadSummary[]>;
  loadThread(threadId: string): Promise<ChatThread | undefined>;
  saveThread(thread: ChatThread): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
}
```

### Additional Exports

**From `@growthbeaker/ai-chat-host`:**

| Export | Description |
|---|---|
| `StreamingChatHandler` | Low-level streaming handler (used internally by `ChatWebviewProvider`) |
| `toCoreMessages(messages)` | Convert `ChatMessage[]` to Vercel AI SDK `CoreMessage[]` |
| `generateHtml(options)` | Generate the webview HTML shell with CSP |
| `generateNonce()` | Generate a CSP nonce |
| `GlobalStateStorage` | VS Code Memento storage adapter |
| `FileSystemStorage` | Filesystem storage adapter |
| `createStorage(config)` | Factory function for creating storage from config |
| `MCPManager` | MCP client connection manager |

**From `@growthbeaker/ai-chat-core`:**

| Export | Description |
|---|---|
| `generateId()` | Generate a unique message/thread ID |
| `createThread(idOrOptions?)` | Create a `ChatThread`, optionally pre-populated with messages, title, and metadata |
| `toThreadSummary(thread)` | Convert a `ChatThread` to a `ThreadSummary` |
| `createWebviewSender(postMessage)` | Create a typed sender for webview-to-host events |
| `createHostSender(postMessage)` | Create a typed sender for host-to-webview events |
| `parseEvent(data)` | Parse raw postMessage data into a typed event |
| `isPostMessageEvent(data)` | Type guard for any valid event |
| `isWebviewToHostEvent(data)` | Type guard for webview-to-host events |
| `isHostToWebviewEvent(data)` | Type guard for host-to-webview events |

**From `@growthbeaker/ai-chat-react`:**

| Export | Description |
|---|---|
| `useVSCodeRuntime(options)` | Hook returning `{ runtime, chatConfig, switchModel }` |
| `toThreadMessageLike(message)` | Convert `ChatMessage` to assistant-ui's `ThreadMessageLike` |
| `fromAppendContent(content)` | Convert assistant-ui append content to `ChatContentPart[]` |
| `createMessageConverter(dataParts?)` | Create a message converter with optional data part renderers |
| `ThreadList` | Thread list sidebar component |
| `ModelSelector` | Model selector dropdown component |

---

## Examples

A complete working example is available in [`examples/basic-chat/`](./examples/basic-chat/).

To run it:

```bash
# From the repository root
pnpm install
pnpm build

# Open the example in VS Code
code examples/basic-chat

# Press F5 to launch the Extension Development Host
```

Make sure `ANTHROPIC_API_KEY` is set in the terminal where VS Code is launched.

---

## Requirements

- **Node.js** >= 20.0.0
- **VS Code** >= 1.96.0
- **TypeScript** >= 5.7.0 (recommended)

---

## License

MIT
