# vscode-ai-chat — Design Document

**Status**: Draft
**Date**: 2026-03-08
**License**: MIT
**Repository**: `vscode-ai-chat` (new, open-source from day one)

---

## 1. Vision & Goals

### The Problem

There is no reusable, production-quality library for VS Code extension developers who want to add AI chat to their extensions. Every team builds their own:

- Custom webview HTML/CSS/JS for chat UI
- Custom streaming protocol over `postMessage`
- Custom LLM integration (HTTP calls, SDK wrappers)
- Custom tool-calling plumbing
- Custom conversation persistence

This is months of duplicated effort, and the results are inconsistent, hard to maintain, and rarely match VS Code's native look and feel.

### The Solution

`vscode-ai-chat` is a library (not an extension) that gives VS Code extension developers a complete AI chat interface with:

- **Multi-LLM support** via Vercel AI SDK (Anthropic, OpenAI, Google, Mistral, local models, etc.)
- **Streaming** out of the box
- **Tool use** with human-in-the-loop approval patterns
- **MCP integration** (stdio, HTTP, SSE transports)
- **Custom interactive UI components** (approval cards, code diffs, file trees, anything)
- **VS Code-native theming** (dark, light, high-contrast — automatic)
- **Multi-thread conversation management** with persistence
- **10-20 lines to get started**

### Target Users

VS Code extension developers building AI-powered features. They know TypeScript, they know the VS Code API, but they do not want to build chat infrastructure from scratch.

### Key Principles

| Principle               | Meaning                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| **LLM-agnostic**        | No vendor lock-in. Swap providers with one line.                                                               |
| **Minimal config**      | Working chat in <20 lines of code.                                                                             |
| **Extensible**          | Custom tools, custom UI components, custom persistence — all via clean interfaces.                             |
| **VS Code-native**      | Looks and feels like it belongs in VS Code. Respects theme, CSP, activation model.                             |
| **Composable**          | Use the pieces you need. Don't want persistence? Don't configure it. Don't want MCP? Don't import it.          |
| **No opinions on HITL** | The library provides the hooks. Extension developers decide what approval UX looks like.                       |
| **Workflow-friendly**   | Not just for chat. Background processes can surface cards, request approval, and show progress in the chat UI. |

---

## 2. Architecture Overview

### System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         VS Code Extension                           │
│                                                                     │
│  ┌───────────────────────────┐    ┌──────────────────────────────┐  │
│  │       Webview (React)      │    │      Extension Host (Node)    │  │
│  │                            │    │                              │  │
│  │  ┌──────────────────────┐  │    │  ┌────────────────────────┐  │  │
│  │  │   @vscode-ai-chat/   │  │    │  │   @vscode-ai-chat/     │  │  │
│  │  │       react           │  │    │  │       host              │  │  │
│  │  │                      │  │    │  │                        │  │  │
│  │  │  ┌────────────────┐  │  │    │  │  ┌──────────────────┐  │  │  │
│  │  │  │  assistant-ui   │  │  │    │  │  │  Vercel AI SDK   │  │  │  │
│  │  │  │  + ExternalStore│  │  │    │  │  │  (streamText,    │  │  │  │
│  │  │  │  Runtime        │  │  │    │  │  │   tools, etc.)   │  │  │  │
│  │  │  └────────────────┘  │  │    │  │  └───────┬──────────┘  │  │  │
│  │  │  ┌────────────────┐  │  │    │  │          │             │  │  │
│  │  │  │  Custom Part    │  │  │    │  │  ┌───────▼──────────┐  │  │  │
│  │  │  │  Renderers      │  │  │    │  │  │  Provider Pkgs   │  │  │  │
│  │  │  └────────────────┘  │  │    │  │  │  @ai-sdk/anthropic│  │  │  │
│  │  └──────────┬───────────┘  │    │  │  │  @ai-sdk/openai   │  │  │  │
│  │             │               │    │  │  │  @ai-sdk/google   │  │  │  │
│  │             │ postMessage   │    │  │  └───────┬──────────┘  │  │  │
│  │             │ (typed)       │    │  │          │             │  │  │
│  └─────────────┼──────────────┘    │  │  ┌───────▼──────────┐  │  │  │
│                │                    │  │  │  MCP Clients     │  │  │  │
│                │                    │  │  │  (@ai-sdk/mcp)   │  │  │  │
│                ▼                    │  │  └──────────────────┘  │  │  │
│  ┌──────────────────────────────┐  │  │                        │  │  │
│  │    @vscode-ai-chat/core      │  │  │  ┌──────────────────┐  │  │  │
│  │    (shared types, protocol)  │  │  │  │  Persistence     │  │  │  │
│  └──────────────────────────────┘  │  │  │  (globalState /   │  │  │  │
│                                     │  │  │   filesystem)    │  │  │  │
│                                     │  │  └──────────────────┘  │  │  │
│                                     │  └────────────────────────┘  │  │
│                                     └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │   LLM Providers   │
                              │   (Anthropic,     │
                              │    OpenAI,        │
                              │    Google, etc.)  │
                              └──────────────────┘
                              ┌──────────────────┐
                              │   MCP Servers     │
                              │   (stdio, HTTP,   │
                              │    SSE)           │
                              └──────────────────┘
```

### Package Dependency Graph

```
@vscode-ai-chat/react ──────► @vscode-ai-chat/core ◄────── @vscode-ai-chat/host
        │                              ▲                            │
        │                              │                            │
        ▼                              │                            ▼
  @assistant-ui/react            (zero deps beyond TS)         ai (Vercel AI SDK)
  streamdown                                                   @ai-sdk/mcp
                                                               vscode (API)
```

Provider packages (`@ai-sdk/anthropic`, `@ai-sdk/openai`, etc.) are **peer dependencies** of `@vscode-ai-chat/host` — consumers install only what they need.

### Data Flow: User Sends a Message

```
1. User types message in webview
2. assistant-ui calls ExternalStoreRuntime.onNew()
3. React layer sends typed postMessage → extension host
4. Host receives message, appends to thread history
5. Host calls AI SDK streamText() with:
   - provider model (e.g., anthropic("claude-sonnet-4-5"))
   - conversation messages
   - registered tools (local + MCP-discovered)
6. AI SDK streams response chunks
7. Host forwards each chunk as postMessage → webview
8. React layer feeds chunks to ExternalStoreRuntime
9. assistant-ui renders streaming markdown via streamdown
10. On completion, host persists updated thread to storage
```

---

## 3. Package Details

### 3.1 @vscode-ai-chat/core

**Purpose**: Shared types and protocol definitions. Zero runtime dependencies.

#### Message Protocol Types

Based on assistant-ui's `ThreadMessageLike`, which is the contract for `ExternalStoreRuntime`:

```typescript
/** Role enum matching assistant-ui expectations */
type MessageRole = "user" | "assistant" | "system";

/** A single content part within a message */
type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool-result"; toolCallId: string; toolName: string; result: unknown }
  | { type: "data"; name: string; data: unknown }; // custom parts

/** A complete message in the thread, compatible with ThreadMessageLike */
interface ChatMessage {
  id: string;
  role: MessageRole;
  content: ChatContentPart[];
  createdAt?: Date;
  metadata?: Record<string, unknown>;
}

/** Thread metadata */
interface ChatThread {
  id: string;
  title?: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}
```

#### PostMessage Event Types

Typed union for all messages crossing the webview ↔ host boundary:

```typescript
/** Webview → Host events */
type WebviewToHostEvent =
  | { type: "sendMessage"; threadId: string; message: ChatMessage }
  | { type: "cancelGeneration"; threadId: string }
  | { type: "switchThread"; threadId: string }
  | { type: "createThread" }
  | { type: "deleteThread"; threadId: string }
  | { type: "toolApproval"; toolCallId: string; approved: boolean; feedback?: string }
  | { type: "editMessage"; threadId: string; messageId: string; content: ChatContentPart[] }
  | { type: "branchMessage"; threadId: string; messageId: string }
  | { type: "reloadMessage"; threadId: string; messageId: string }
  | { type: "ready" }; // webview mounted, request initial state

/** Host → Webview events */
type HostToWebviewEvent =
  | { type: "streamStart"; threadId: string; messageId: string }
  | { type: "streamDelta"; threadId: string; messageId: string; delta: ChatContentPart }
  | { type: "streamEnd"; threadId: string; messageId: string }
  | { type: "streamError"; threadId: string; error: string }
  | { type: "threadState"; thread: ChatThread } // full thread sync
  | { type: "threadList"; threads: Array<{ id: string; title: string; updatedAt: Date }> }
  | { type: "toolCall"; threadId: string; toolCallId: string; toolName: string; args: unknown }
  | { type: "toolResult"; threadId: string; toolCallId: string; result: unknown }
  | { type: "configUpdate"; config: Partial<ChatConfig> };

/** Union of all postMessage events */
type PostMessageEvent = WebviewToHostEvent | HostToWebviewEvent;
```

#### Persistence Interface

```typescript
interface ThreadStorage {
  listThreads(): Promise<Array<{ id: string; title: string; updatedAt: Date }>>;
  loadThread(threadId: string): Promise<ChatThread | undefined>;
  saveThread(thread: ChatThread): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
}
```

#### Configuration Types

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
}
```

---

### 3.2 @vscode-ai-chat/react

**Purpose**: Pre-configured React components for the webview. This is what renders inside the VS Code webview iframe.

#### Dependencies

- `@vscode-ai-chat/core` — shared types
- `@assistant-ui/react` — chat UI primitives and runtime
- `streamdown` — streaming markdown renderer

#### ChatPanel Component (Main Entry Point)

```typescript
interface ChatPanelProps {
  /** Custom part renderers registered via makeAssistantDataUI */
  dataParts?: Record<string, React.ComponentType<{ data: unknown }>>;
  /** Custom tool UIs registered via makeAssistantToolUI */
  toolUIs?: Record<string, React.ComponentType<ToolUIProps>>;
  /** Override default markdown renderer */
  markdownRenderer?: React.ComponentType<{ content: string }>;
  /** Additional CSS class names */
  className?: string;
}

function ChatPanel(props: ChatPanelProps): React.ReactElement;
```

Internally, `ChatPanel`:

1. Creates an `ExternalStoreRuntime` that reads from and writes to the postMessage bridge
2. Wraps everything in `AssistantRuntimeProvider`
3. Renders `ThreadList` (if enabled) + `Thread` with configured message renderers
4. Registers custom data-part renderers and tool-UI renderers

#### VS Code Theme Integration

CSS variable mapping from VS Code's built-in custom properties to assistant-ui's theming tokens:

```css
:root {
  /* Map VS Code → assistant-ui */
  --aui-foreground: var(--vscode-foreground);
  --aui-background: var(--vscode-editor-background);
  --aui-card: var(--vscode-editorWidget-background);
  --aui-card-foreground: var(--vscode-editorWidget-foreground);
  --aui-border: var(--vscode-editorWidget-border);
  --aui-input: var(--vscode-input-background);
  --aui-input-foreground: var(--vscode-input-foreground);
  --aui-input-border: var(--vscode-input-border);
  --aui-primary: var(--vscode-button-background);
  --aui-primary-foreground: var(--vscode-button-foreground);
  --aui-muted: var(--vscode-textBlockQuote-background);
  --aui-muted-foreground: var(--vscode-descriptionForeground);
  --aui-accent: var(--vscode-focusBorder);
  --aui-ring: var(--vscode-focusBorder);
  --aui-code-background: var(--vscode-textCodeBlock-background);

  /* Typography — match VS Code */
  --aui-font-family: var(--vscode-font-family);
  --aui-font-size: var(--vscode-font-size);
  --aui-code-font-family: var(--vscode-editor-font-family);
  --aui-code-font-size: var(--vscode-editor-font-size);
}
```

Dark, light, and high-contrast themes work automatically because the underlying CSS variables change with the VS Code theme. No JS-level theme detection is needed.

#### Default Markdown Rendering

Uses `streamdown` for streaming-aware markdown rendering. Benefits:

- Handles partial markdown gracefully during streaming (no flicker from incomplete code fences, etc.)
- Syntax highlighting for code blocks
- Compatible with CSP restrictions (no inline eval)

#### Custom Part Renderer Registration

Extension developers register custom renderers for `data` parts using assistant-ui's `makeAssistantDataUI`:

```typescript
// In the extension's webview entry point
import { ChatPanel } from "@vscode-ai-chat/react";
import { makeAssistantDataUI } from "@assistant-ui/react";

const CodeDiffCard = makeAssistantDataUI({
  name: "code-diff",      // matches data.name in ChatContentPart
  render: ({ data }) => <MyDiffViewer diff={data} />,
});

const FileTreeCard = makeAssistantDataUI({
  name: "file-tree",
  render: ({ data }) => <MyFileTree files={data} />,
});

// Pass to ChatPanel
<ChatPanel dataParts={{ "code-diff": CodeDiffCard, "file-tree": FileTreeCard }} />
```

#### ThreadList Integration

When `showThreadList` is enabled, renders assistant-ui's `ThreadList` component in a collapsible sidebar. Thread list state is synchronized via the `ExternalStoreThreadListAdapter`, which communicates with the host over postMessage.

#### esbuild Bundling

The React webview code must be bundled into a single IIFE script for injection into the webview. Guidance for consumers:

```javascript
// esbuild.config.mjs
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/webview/index.tsx"],
  bundle: true,
  format: "iife",
  outfile: "dist/webview.js",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".css": "text" }, // inline CSS
  minify: true,
});
```

CSP compliance: no `eval()`, no inline scripts (use nonce), no `unsafe-inline` styles (all styles injected via `<link>` or nonce'd `<style>`).

---

### 3.3 @vscode-ai-chat/host

**Purpose**: Extension-host SDK. Runs in Node.js. Manages LLM calls, tool execution, MCP, persistence, and the postMessage bridge to the webview.

#### Dependencies

- `@vscode-ai-chat/core` — shared types
- `ai` (Vercel AI SDK) — `streamText`, `tool`, `generateText`
- `@ai-sdk/mcp` — `createMCPClient`
- `vscode` (peer) — VS Code extension API

#### ChatWebviewProvider Class

The primary entry point for extension developers:

```typescript
import { ChatWebviewProvider, type ChatProviderConfig } from "@vscode-ai-chat/host";

class MyChatProvider extends ChatWebviewProvider {
  constructor(extensionUri: vscode.Uri) {
    super(extensionUri, {
      // Required: at least one model
      model: anthropic("claude-sonnet-4-5"),

      // Optional: additional models for runtime switching
      models: {
        "claude-sonnet": () => anthropic("claude-sonnet-4-5"),
        "gpt-4o": () => openai("gpt-4o"),
        "gemini-pro": () => google("gemini-2.0-pro"),
      },

      // Optional: system prompt
      system: "You are a helpful coding assistant.",

      // Optional: tools
      tools: {
        readFile: tool({
          description: "Read a file from the workspace",
          parameters: z.object({ path: z.string() }),
          execute: async ({ path }) => {
            const uri = vscode.Uri.file(path);
            const bytes = await vscode.workspace.fs.readFile(uri);
            return new TextDecoder().decode(bytes);
          },
        }),
      },

      // Optional: MCP servers
      mcpServers: [
        {
          name: "filesystem",
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
        },
      ],

      // Optional: persistence
      persistence: "globalState", // or "filesystem" or a custom ThreadStorage

      // Optional: UI config
      ui: {
        title: "My AI Chat",
        showThreadList: true,
        placeholder: "Ask me anything...",
      },
    });
  }
}
```

Registration in `activate()`:

```typescript
export function activate(context: vscode.ExtensionContext) {
  const provider = new MyChatProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("myExtension.chatView", provider),
  );
}
```

#### ChatWebviewProvider Internals

`ChatWebviewProvider` implements `vscode.WebviewViewProvider` and orchestrates:

1. **Webview lifecycle**: `resolveWebviewView()` creates the HTML shell, injects the bundled React script (with nonce), sets CSP headers
2. **PostMessage bridge**: Typed event handling — deserializes `WebviewToHostEvent`, dispatches to handlers, serializes `HostToWebviewEvent` back
3. **LLM streaming**: On `sendMessage`, calls `streamText()` from the AI SDK, pipes chunks to the webview as `streamDelta` events
4. **Tool execution**: When `streamText` yields a `tool-call`, checks if the tool is synchronous (execute immediately) or requires approval (forward to webview as `toolCall` event, wait for `toolApproval` response)
5. **MCP management**: On initialization, creates MCP clients for configured servers, discovers tools, merges into the tool registry
6. **Persistence**: After each completed exchange, persists the thread via the configured `ThreadStorage` adapter
7. **Thread management**: Creates, switches, deletes threads; sends `threadList` and `threadState` events to keep the webview in sync

#### AI SDK Integration

```typescript
// Inside ChatWebviewProvider (simplified)
private async handleSendMessage(event: SendMessageEvent) {
  const thread = await this.storage.loadThread(event.threadId);
  thread.messages.push(event.message);

  const result = streamText({
    model: this.activeModel,
    system: this.config.system,
    messages: this.toAIMessages(thread.messages), // convert ChatMessage[] → CoreMessage[]
    tools: { ...this.localTools, ...this.mcpTools },
    maxSteps: 10, // allow multi-step tool use
    onChunk: (chunk) => {
      this.postToWebview({
        type: "streamDelta",
        threadId: thread.id,
        messageId: assistantMsgId,
        delta: this.chunkToContentPart(chunk),
      });
    },
  });

  // Await final result for persistence
  const finalResponse = await result;
  thread.messages.push(this.toAssistantMessage(finalResponse));
  await this.storage.saveThread(thread);

  this.postToWebview({ type: "streamEnd", threadId: thread.id, messageId: assistantMsgId });
}
```

#### MCP Client Management

```typescript
import { createMCPClient } from "@ai-sdk/mcp";

// During initialization
for (const server of config.mcpServers) {
  const client = await createMCPClient({
    transport: this.createTransport(server), // stdio | http | sse
  });
  const tools = await client.tools(); // discovers available tools
  Object.assign(this.mcpTools, tools);
  this.mcpClients.push(client);
}

// Cleanup on deactivate
async dispose() {
  for (const client of this.mcpClients) {
    await client.close();
  }
}
```

MCP tools appear alongside local tools in the `streamText` call — the AI SDK handles them uniformly.

#### Conversation Persistence

Two built-in adapters, plus the `ThreadStorage` interface for custom implementations:

**GlobalState adapter** — uses `vscode.ExtensionContext.globalState`:

```typescript
class GlobalStateStorage implements ThreadStorage {
  constructor(private globalState: vscode.Memento) {}

  async listThreads() {
    const index = this.globalState.get<ThreadIndex[]>("chat:threads", []);
    return index;
  }

  async loadThread(id: string) {
    return this.globalState.get<ChatThread>(`chat:thread:${id}`);
  }

  async saveThread(thread: ChatThread) {
    await this.globalState.update(`chat:thread:${thread.id}`, thread);
    // Update index
    const index = this.globalState.get<ThreadIndex[]>("chat:threads", []);
    const existing = index.findIndex((t) => t.id === thread.id);
    const entry = { id: thread.id, title: thread.title ?? "Untitled", updatedAt: new Date() };
    if (existing >= 0) index[existing] = entry;
    else index.unshift(entry);
    await this.globalState.update("chat:threads", index);
  }

  async deleteThread(id: string) {
    await this.globalState.update(`chat:thread:${id}`, undefined);
    const index = this.globalState.get<ThreadIndex[]>("chat:threads", []);
    await this.globalState.update(
      "chat:threads",
      index.filter((t) => t.id !== id),
    );
  }
}
```

**Filesystem adapter** — stores threads as JSON files in the extension's global storage directory. Better for large conversations that could exceed `globalState` size limits (~100KB per key).

#### Multi-Provider Runtime Switching

Extension developers configure multiple models. Users can switch at runtime:

```typescript
// In the host, handle a model-switch event
private handleModelSwitch(modelId: string) {
  const factory = this.config.models?.[modelId];
  if (!factory) throw new Error(`Unknown model: ${modelId}`);
  this.activeModel = factory();
  this.postToWebview({ type: "configUpdate", config: { activeModel: modelId } });
}
```

The webview can render a model selector dropdown that sends a `switchModel` event.

---

## 4. Extension Developer Experience

### Minimal Setup (Working Chat in ~15 Lines)

```typescript
// extension.ts
import * as vscode from "vscode";
import { ChatWebviewProvider } from "@vscode-ai-chat/host";
import { anthropic } from "@ai-sdk/anthropic";

export function activate(context: vscode.ExtensionContext) {
  const provider = new ChatWebviewProvider(context.extensionUri, {
    model: anthropic("claude-sonnet-4-5"),
    system: "You are a helpful coding assistant.",
    persistence: "globalState",
    extensionContext: context,
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("myExtension.chatView", provider),
  );
}
```

```jsonc
// package.json (contributes section)
{
  "contributes": {
    "views": {
      "explorer": [{ "type": "webview", "id": "myExtension.chatView", "name": "AI Chat" }],
    },
  },
}
```

The webview entry point:

```tsx
// webview/index.tsx
import { createRoot } from "react-dom/client";
import { ChatPanel } from "@vscode-ai-chat/react";

createRoot(document.getElementById("root")!).render(<ChatPanel />);
```

That is it. Streaming chat with markdown rendering, VS Code theming, and conversation persistence — working.

### Adding a Custom LLM Provider

```typescript
import { openai } from "@ai-sdk/openai";

const provider = new ChatWebviewProvider(context.extensionUri, {
  model: openai("gpt-4o"), // just swap the model
  // ...
});
```

Or offer multiple models:

```typescript
const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"), // default
  models: {
    "claude-sonnet": () => anthropic("claude-sonnet-4-5"),
    "claude-opus": () => anthropic("claude-opus-4-6"),
    "gpt-4o": () => openai("gpt-4o"),
    "local-ollama": () => ollama("llama3"), // via @ai-sdk/ollama or custom provider
  },
});
```

### Registering Custom Card Renderers

On the host side, emit `data` parts in tool results or system messages:

```typescript
tools: {
  analyzeCode: tool({
    description: "Analyze code and produce a diff",
    parameters: z.object({ file: z.string() }),
    execute: async ({ file }) => {
      const diff = await computeDiff(file);
      // Return structured data that the webview can render as a custom card
      return { type: "code-diff", original: diff.before, modified: diff.after };
    },
  }),
}
```

On the webview side, register a renderer:

```tsx
import { ChatPanel } from "@vscode-ai-chat/react";

function CodeDiffCard({ data }: { data: { original: string; modified: string } }) {
  return (
    <div className="diff-card">
      <DiffEditor original={data.original} modified={data.modified} />
    </div>
  );
}

<ChatPanel dataParts={{ "code-diff": CodeDiffCard }} />;
```

### Adding Tool Approval UX (Human-in-the-Loop)

The library does NOT force a specific approval UX. Instead, extension developers use assistant-ui's `makeAssistantToolUI` to create their own:

```tsx
import { makeAssistantToolUI } from "@assistant-ui/react";

const DeleteFileToolUI = makeAssistantToolUI({
  toolName: "deleteFile",
  render: ({ args, status, addResult }) => {
    if (status.type === "running") {
      return (
        <div className="approval-card">
          <p>
            Delete <code>{args.path}</code>?
          </p>
          <button onClick={() => addResult({ approved: true })}>Approve</button>
          <button onClick={() => addResult({ approved: false })}>Deny</button>
        </div>
      );
    }
    return <p>File deletion {status.result?.approved ? "approved" : "denied"}.</p>;
  },
});

<ChatPanel toolUIs={{ deleteFile: DeleteFileToolUI }} />;
```

On the host side, the tool's `execute` function receives the approval result and acts accordingly.

### Adding MCP Servers

```typescript
const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  mcpServers: [
    {
      name: "filesystem",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", workspaceRoot],
    },
    {
      name: "github",
      transport: "sse",
      url: "https://mcp.github.com/sse",
      headers: { Authorization: `Bearer ${githubToken}` },
    },
  ],
});
```

MCP tools are automatically discovered and made available to the LLM alongside local tools.

### Customizing Chat Appearance

```typescript
const provider = new ChatWebviewProvider(context.extensionUri, {
  model: anthropic("claude-sonnet-4-5"),
  ui: {
    title: "Code Buddy",
    placeholder: "Describe what you'd like to build...",
    showThreadList: true,
    customCss: `
      .aui-thread { max-width: 800px; }
      .aui-message-assistant { border-left: 2px solid var(--vscode-terminal-ansiBlue); }
    `,
  },
});
```

### Chat Session Templates

The library supports **chat session templates** — pre-configured system prompts and tool sets that extensions can register. This enables workflows where external agent prompt files (installed on disk) are loaded at runtime as system prompts for specific chat sessions.

```typescript
// Load an external agent prompt file as a chat template
const bmadPrompt = await fs.readFile(
  path.join(workspaceRoot, "_bmad/agents/bmm-create-prd.md"),
  "utf-8",
);

chatHost.registerTemplate({
  id: "create-prd",
  label: "Create PRD",
  systemPrompt: bmadPrompt,
  tools: { Read: readTool, Write: writeTool },
  model: anthropic("claude-sonnet-4-6"),
});
```

User selects a template from a picker, and a chat session starts with that system prompt and tools pre-configured. This lets extensions integrate with external agent frameworks (BMAD, custom agents) without replicating their prompts.

### LLM-Agnostic Workflow Integration

The AI SDK's unified interface can be used not just for chat, but for background workflows too. Extensions that currently have custom LLM runners can optionally migrate to using the AI SDK through the host package:

```typescript
import { streamText, generateText } from "ai";

// Same unified interface for chat AND background workflows
const chatResult = streamText({
  model: anthropic("claude-sonnet-4-6"),
  messages: chatHistory,
});

const workflowResult = await generateText({
  model: anthropic("claude-opus-4-6"),
  system: agentPrompt,
  messages: [{ role: "user", content: taskDescription }],
  tools: { Write: writeTool },
  maxSteps: 4,
  providerOptions: {
    anthropic: { cacheControl: true },
  },
});
```

The library does not force this — extensions can keep their own LLM runners for workflows — but the AI SDK is available as a unified alternative.

---

## 5. Message Flow

### Standard Message Flow

```
User                 Webview (React)              Host (Node)              LLM
 │                        │                           │                     │
 │ types message          │                           │                     │
 │───────────────────────►│                           │                     │
 │                        │ sendMessage               │                     │
 │                        │──────postMessage──────────►│                     │
 │                        │                           │ append to thread    │
 │                        │                           │ streamText()        │
 │                        │                           │────────────────────►│
 │                        │                           │                     │
 │                        │                           │◄─── stream chunk ───│
 │                        │       streamDelta         │                     │
 │                        │◄─────postMessage──────────│                     │
 │ sees streaming text    │                           │                     │
 │◄───────────────────────│                           │◄─── stream chunk ───│
 │                        │       streamDelta         │                     │
 │                        │◄─────postMessage──────────│                     │
 │                        │                           │                     │
 │                        │                           │◄─── stream end ─────│
 │                        │       streamEnd           │ persist thread      │
 │                        │◄─────postMessage──────────│                     │
 │ sees complete response │                           │                     │
 │◄───────────────────────│                           │                     │
```

### Tool Call Flow (with Approval)

```
Host                    LLM                     Host                  Webview
 │                       │                        │                      │
 │ streamText()          │                        │                      │
 │──────────────────────►│                        │                      │
 │                       │                        │                      │
 │◄── tool_use: delete ──│                        │                      │
 │                        │                       │                      │
 │ (requires approval)───────────────────────────►│ toolCall event       │
 │                        │                       │─────postMessage─────►│
 │                        │                       │                      │
 │                        │                       │                      │ user clicks Approve
 │                        │                       │◄────postMessage──────│ toolApproval
 │                        │                       │                      │
 │ execute tool with approval result              │                      │
 │ return tool_result ───►│                       │                      │
 │                        │                       │                      │
 │◄── continued response──│                       │                      │
```

### MCP Tool Flow

MCP tools follow the same path as local tools from the LLM's perspective. The only difference is execution:

```
Host receives tool_use for MCP tool
  → Host calls mcpClient.callTool(name, args)
  → MCP client sends request to MCP server (stdio/HTTP/SSE)
  → MCP server returns result
  → Host returns tool_result to streamText loop
  → LLM continues with result
```

### Workflow HITL Checkpoints

Background workflows (not chat-based) can pause and surface approval requests in the chat. This enables agentic workflows to incorporate human-in-the-loop steps through the chat without being chat-driven themselves.

```
Workflow Engine                    Chat UI
     │                               │
     ├─ Phase 1: Execute ──────────► progress card
     ├─ Phase 2: Execute ──────────► progress card
     │                               │
     ├─ HITL Checkpoint ───────────► approval card rendered
     │   (workflow suspends)          │
     │                          user clicks "Approve" / "Reject"
     │                               │
     │◄── resume signal ─────────────┤
     │                               │
     ├─ Phase 3: Continue ─────────► progress card
     └─ Done ──────────────────────► result card
```

The library provides:

- **`chatHost.postSystemMessage(data)`** — inject a message into the chat from outside a chat session. Workflows use this to post progress cards, approval requests, or result summaries without an active LLM conversation.
- **`chatHost.waitForUserAction(actionId)`** — returns a Promise that resolves when the user interacts with a card (e.g., clicks "Approve" or "Reject"). The workflow suspends on this Promise and resumes when the user acts.
- **Custom approval card UI** — extensions define the approval card rendering via `makeAssistantDataUI`, so the look and feel is fully controlled by the extension developer.

---

## 6. VS Code Integration Details

### WebviewViewProvider (Sidebar)

The primary integration point. `ChatWebviewProvider` implements `vscode.WebviewViewProvider`:

```typescript
resolveWebviewView(
  webviewView: vscode.WebviewView,
  _context: vscode.WebviewViewResolveContext,
  _token: vscode.CancellationToken
): void {
  this.view = webviewView;
  webviewView.webview.options = {
    enableScripts: true,
    localResourceRoots: [this.extensionUri],
  };
  webviewView.webview.html = this.getHtmlContent(webviewView.webview);
  webviewView.webview.onDidReceiveMessage(this.handleMessage.bind(this));
}
```

### WebviewPanel (Editor Area)

For a larger chat panel in the editor area, the library provides a helper:

```typescript
import { openChatPanel } from "@vscode-ai-chat/host";

// Opens a full WebviewPanel in the editor area
const panel = openChatPanel(context, {
  model: anthropic("claude-sonnet-4-5"),
  viewColumn: vscode.ViewColumn.Beside,
  // ... same config as ChatWebviewProvider
});
```

### Content Security Policy

The library generates strict CSP headers automatically:

```html
<meta
  http-equiv="Content-Security-Policy"
  content="
  default-src 'none';
  script-src 'nonce-${nonce}';
  style-src ${webview.cspSource} 'nonce-${nonce}';
  font-src ${webview.cspSource};
  img-src ${webview.cspSource} data: https:;
"
/>
```

- **No `unsafe-inline`** for scripts — nonce-based only
- **No `unsafe-eval`** — the bundled React code must not use `eval()`
- Styles loaded via nonce'd `<style>` tags or `webview.cspSource` links
- Images allowed from extension resources, data URIs, and HTTPS

### Nonce-Based Script Loading

```typescript
private getHtmlContent(webview: vscode.Webview): string {
  const nonce = this.generateNonce();
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js")
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css")
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="...nonce-${nonce}...">
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
```

### PostMessage Security

The webview's `postMessage` is scoped to the specific webview instance by VS Code's framework. Additional validation:

- All incoming messages are validated against `WebviewToHostEvent` discriminated union before processing
- Unknown event types are logged and dropped
- No `eval()` or dynamic code execution from message payloads

### Extension Activation Events

Extensions using this library should activate on their view:

```jsonc
{
  "activationEvents": ["onView:myExtension.chatView"],
}
```

---

## 7. Theming

### CSS Variable Mapping

The `@vscode-ai-chat/react` package ships a base stylesheet that maps VS Code's CSS custom properties to assistant-ui's expected tokens. This mapping is applied automatically when `ChatPanel` mounts.

Key categories:

| Category    | VS Code Property                      | assistant-ui Token      |
| ----------- | ------------------------------------- | ----------------------- |
| Background  | `--vscode-editor-background`          | `--aui-background`      |
| Foreground  | `--vscode-foreground`                 | `--aui-foreground`      |
| Input       | `--vscode-input-background`           | `--aui-input`           |
| Buttons     | `--vscode-button-background`          | `--aui-primary`         |
| Borders     | `--vscode-editorWidget-border`        | `--aui-border`          |
| Code blocks | `--vscode-textCodeBlock-background`   | `--aui-code-background` |
| Selection   | `--vscode-editor-selectionBackground` | `--aui-selection`       |
| Links       | `--vscode-textLink-foreground`        | `--aui-link`            |
| Errors      | `--vscode-errorForeground`            | `--aui-destructive`     |

### Dark / Light / High-Contrast

No conditional logic needed. VS Code updates its CSS custom properties when the theme changes; the mapped assistant-ui tokens update automatically. The webview re-renders naturally.

High-contrast themes work because:

- All colors derive from VS Code variables (no hardcoded hex values)
- Focus indicators use `--vscode-focusBorder` which is prominent in HC themes
- Borders use `--vscode-contrastBorder` when defined (HC only)

### Extending with Custom Theme Tokens

Extension developers can add their own tokens via `customCss`:

```typescript
ui: {
  customCss: `
    :root {
      --my-ext-accent: var(--vscode-terminal-ansiCyan);
      --my-ext-card-bg: var(--vscode-editorHoverWidget-background);
    }
    .my-custom-card {
      background: var(--my-ext-card-bg);
      border-left: 3px solid var(--my-ext-accent);
    }
  `,
}
```

---

## 8. Build & Distribution

### Monorepo Setup

```
vscode-ai-chat/
├── packages/
│   ├── core/              # @vscode-ai-chat/core
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── react/             # @vscode-ai-chat/react
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── host/              # @vscode-ai-chat/host
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── examples/
│   └── basic-chat/        # Example extension
│       ├── src/
│       ├── package.json
│       └── .vscodeignore
├── pnpm-workspace.yaml
├── turbo.json             # Build orchestration
├── tsconfig.base.json
└── package.json
```

**pnpm workspaces** for dependency management. **Turborepo** for build orchestration (`turbo run build` builds packages in dependency order).

### Build Configuration

Each package uses `tsup` (esbuild wrapper) for library builds:

```typescript
// packages/core/tsup.config.ts
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
});
```

The `react` package additionally builds a CSS file from the theme mapping stylesheet.

The `host` package marks `vscode` as external (it is provided at runtime by VS Code).

### npm Publishing Strategy

| Package                 | Published As              | Format  |
| ----------------------- | ------------------------- | ------- |
| `@vscode-ai-chat/core`  | ESM + CJS + `.d.ts`       | Library |
| `@vscode-ai-chat/react` | ESM + CJS + `.d.ts` + CSS | Library |
| `@vscode-ai-chat/host`  | ESM + CJS + `.d.ts`       | Library |

Version management via changesets (`@changesets/cli`). All packages share a version.

### Dependency Strategy

| Dependency            | Strategy                   | Reason                                        |
| --------------------- | -------------------------- | --------------------------------------------- |
| `@assistant-ui/react` | Peer dependency of `react` | Consumer controls version, avoids duplication |
| `react`, `react-dom`  | Peer dependency of `react` | Must match consumer's React                   |
| `ai` (Vercel AI SDK)  | Peer dependency of `host`  | Consumer controls version                     |
| `@ai-sdk/*` providers | Peer dependency of `host`  | Consumer installs only what they need         |
| `vscode`              | Peer dependency of `host`  | Provided by VS Code runtime                   |
| `streamdown`          | Bundled in `react`         | Internal implementation detail                |
| `zod`                 | Peer dependency of `host`  | Used for tool parameter schemas               |

---

## 9. Testing Strategy

### Unit Tests (vitest)

Each package has unit tests covering:

- **core**: Message type validation, event type discrimination, serialization/deserialization round-trips
- **react**: Component rendering (using `@testing-library/react`), theme CSS variable mapping, postMessage bridge mock
- **host**: `ChatWebviewProvider` message handling, persistence adapter behavior, tool registry management

```
packages/core/src/__tests__/
packages/react/src/__tests__/
packages/host/src/__tests__/
```

### Webview Integration Testing

Webview testing in VS Code is inherently difficult. The strategy:

1. **Mock postMessage layer**: Unit tests for React components use a mock `vscode.postMessage` that simulates host responses
2. **`@vscode/test-electron`**: Integration tests that launch a VS Code instance, activate the example extension, and verify the webview loads
3. **Playwright (optional)**: For more complex UI interaction tests, extract the React components into a standalone page that can be tested with Playwright

### Example Extension

`examples/basic-chat/` is a working VS Code extension that uses all three packages. It serves as:

- Manual testing ground during development
- Living documentation of how to integrate the library
- CI test target (launch via `@vscode/test-electron` and verify basic functionality)

---

## 10. Roadmap

### Phase 1: Core Chat (MVP)

Deliver a working chat experience with the minimum viable feature set.

- `@vscode-ai-chat/core` — all types and interfaces
- `@vscode-ai-chat/react` — `ChatPanel` with streaming markdown, VS Code theming
- `@vscode-ai-chat/host` — `ChatWebviewProvider` with `streamText`, postMessage bridge
- Single-thread conversations (no persistence yet)
- Single-model configuration
- Example extension
- npm publish

### Phase 2: Multi-Thread, Persistence, MCP

Add the features needed for production use.

- Multi-thread support via `ThreadList`
- `globalState` and filesystem persistence adapters
- MCP client integration (`createMCPClient`)
- Multi-model runtime switching
- Tool approval (HITL) support via `makeAssistantToolUI`
- Custom data-part renderers via `makeAssistantDataUI`
- Chat session templates (pre-configured system prompts from external files)
- Workflow HITL bridge (`postSystemMessage`, `waitForUserAction`)
- Message editing and branching

### Phase 3: Advanced Features

Polish and expand.

- File attachments (images, PDFs, code files) — render in chat and send to LLM
- Voice input (VS Code Speech API integration)
- Image rendering in assistant responses (for vision model outputs)
- Token usage display / cost tracking
- Export conversations (JSON, Markdown)
- Drag-and-drop files into chat
- Context mentions (@file, @workspace, @symbol) with VS Code symbol/file pickers
- Prompt templates / slash commands

---

## 11. Open Questions

### To Resolve Before Phase 1

1. **React version requirement**: assistant-ui requires React 18+. Should we specify `>=18.0.0` as a peer dep, or support 19 as well? React 19 has breaking changes in some type signatures.

2. **Webview state on hide/show**: When a webview sidebar is hidden and re-shown, VS Code may destroy and re-create the webview. Should the library handle webview state restoration automatically (via `webviewView.webview.options.retainContextWhenHidden`), or let consumers decide? `retainContextWhenHidden` uses more memory but avoids re-render.

3. **Streaming protocol granularity**: Should `streamDelta` events carry individual tokens, or buffer into sentence-level chunks? Token-level gives the smoothest UX but generates a lot of postMessage traffic. A configurable buffer (e.g., 50ms debounce) may be the right default.

4. **AbortController propagation**: When the user cancels a generation, the host calls `abort()` on the AI SDK stream. Should the webview show a "cancelled" state, or silently stop? How should partial responses be persisted?

5. **Error taxonomy**: What errors should be surfaced to the user (rate limits, auth failures, network errors) vs. logged silently (transient retries)? Should the library provide default error UI, or leave it entirely to the consumer?

### To Explore Later

6. **Webview panel vs. sidebar**: Should the library support both `WebviewView` (sidebar) and `WebviewPanel` (editor tab) from Phase 1, or start with sidebar only?

7. **Extension-to-extension API**: Should the library expose a VS Code API that other extensions can call to send messages to the chat programmatically? This would enable "send selection to chat" commands from other extensions.

8. **Offline / local model support**: Vercel AI SDK supports Ollama and other local providers. Any special handling needed (no API key config, different error patterns)?

9. **Telemetry**: Should the library provide opt-in telemetry hooks for extension developers to track usage metrics? (The library itself should NOT collect telemetry.)

10. **Accessibility**: assistant-ui provides baseline a11y. Are there VS Code-specific accessibility requirements (screen reader announcements, keyboard navigation patterns) that need additional work?
