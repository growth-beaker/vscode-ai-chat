# vscode-ai-chat — Implementation Plan

**Status**: Draft
**Date**: 2026-03-09
**Based on**: `docs/vscode-ai-chat-design.md`

---

## Overview

This plan implements the design document in three phases, with Phase 1 (Core Chat MVP) broken into granular tasks. Each task is independently testable and builds on the previous one.

**Tech Stack Summary**:

- **Monorepo**: pnpm workspaces + Turborepo
- **Build**: tsup (libraries), esbuild (webview bundle)
- **Test**: vitest + @testing-library/react
- **Packages**: `@growthbeaker/ai-chat-core`, `@growthbeaker/ai-chat-react`, `@growthbeaker/ai-chat-host`
- **Key deps**: `ai` (Vercel AI SDK), `@assistant-ui/react`, `streamdown`

---

## Phase 1: Core Chat MVP

Goal: A working streaming chat in a VS Code sidebar webview. Single thread, single model, no persistence. Publishable to npm.

### Task 1.1 — Monorepo Scaffolding

**What**: Set up the pnpm workspace, Turborepo, shared TypeScript config, and empty package shells.

**Files to create**:

```
pnpm-workspace.yaml
turbo.json
tsconfig.base.json
package.json                          # root (private, workspaces)
packages/core/package.json
packages/core/tsconfig.json
packages/core/tsup.config.ts
packages/core/src/index.ts
packages/react/package.json
packages/react/tsconfig.json
packages/react/tsup.config.ts
packages/react/src/index.ts
packages/host/package.json
packages/host/tsconfig.json
packages/host/tsup.config.ts
packages/host/src/index.ts
.gitignore
.npmrc
```

**Details**:

1. **Root `package.json`**: private, `"type": "module"`, scripts for `build`, `test`, `lint`, `typecheck`. devDependencies: `typescript`, `turbo`, `vitest`, `tsup`, `prettier`, `eslint`.

2. **`pnpm-workspace.yaml`**:

   ```yaml
   packages:
     - "packages/*"
     - "examples/*"
   ```

3. **`turbo.json`**: Build pipeline with `core` → `react` + `host` dependency order:

   ```json
   {
     "$schema": "https://turbo.build/schema.json",
     "tasks": {
       "build": {
         "dependsOn": ["^build"],
         "outputs": ["dist/**"]
       },
       "test": {
         "dependsOn": ["build"]
       },
       "typecheck": {
         "dependsOn": ["^build"]
       }
     }
   }
   ```

4. **`tsconfig.base.json`**: Strict mode, ES2022 target, module: "NodeNext", declaration: true. Each package extends this.

5. **Package `tsup.config.ts`** (each):
   - `core`: `format: ["esm", "cjs"]`, `dts: true`
   - `react`: `format: ["esm", "cjs"]`, `dts: true`, external: `react`, `react-dom`, `@assistant-ui/react`
   - `host`: `format: ["esm", "cjs"]`, `dts: true`, external: `vscode`, `ai`, `@ai-sdk/*`

6. **Package dependency graph** (in package.json files):
   - `core`: zero runtime deps
   - `react`: depends on `core`, peers: `react >=18`, `react-dom >=18`, `@assistant-ui/react`
   - `host`: depends on `core`, peers: `ai >=4`, `vscode`, `zod`

**Success criteria**:

- `pnpm install` succeeds
- `pnpm build` compiles all three packages to `dist/`
- `pnpm typecheck` passes
- Each package exports an empty `{}` from `dist/index.js`

---

### Task 1.2 — Core Types & Protocol (`@growthbeaker/ai-chat-core`)

**What**: Implement all shared types from design doc Section 3.1.

**Files**:

```
packages/core/src/index.ts            # re-exports
packages/core/src/types/messages.ts   # ChatMessage, ChatContentPart, MessageRole
packages/core/src/types/events.ts     # WebviewToHostEvent, HostToWebviewEvent, PostMessageEvent
packages/core/src/types/thread.ts     # ChatThread
packages/core/src/types/config.ts     # ChatConfig
packages/core/src/types/storage.ts    # ThreadStorage interface
packages/core/src/__tests__/types.test.ts
```

**Type definitions** (from design doc):

1. **`messages.ts`**: `MessageRole`, `ChatContentPart` (discriminated union with `text`, `tool-call`, `tool-result`, `data` variants), `ChatMessage` interface.

2. **`events.ts`**: `WebviewToHostEvent` (discriminated union: `sendMessage`, `cancelGeneration`, `switchThread`, `createThread`, `deleteThread`, `toolApproval`, `editMessage`, `branchMessage`, `reloadMessage`, `ready`). `HostToWebviewEvent` (discriminated union: `streamStart`, `streamDelta`, `streamEnd`, `streamError`, `threadState`, `threadList`, `toolCall`, `toolResult`, `configUpdate`). Union type `PostMessageEvent`.

3. **`thread.ts`**: `ChatThread` interface.

4. **`config.ts`**: `ChatConfig` interface.

5. **`storage.ts`**: `ThreadStorage` interface with `listThreads`, `loadThread`, `saveThread`, `deleteThread`.

6. **Utility**: `generateId()` function (nanoid or crypto.randomUUID wrapper) for message/thread IDs.

**Tests**:

- Type discrimination works at runtime (type guards for event union)
- Serialization round-trip: `ChatMessage` → JSON → `ChatMessage`
- `generateId()` returns unique strings

**Success criteria**:

- Package builds with zero errors
- All types exported from `@growthbeaker/ai-chat-core`
- Type guards correctly narrow union types
- Tests pass

---

### Task 1.3 — PostMessage Bridge (`@growthbeaker/ai-chat-core`)

**What**: Type-safe postMessage helpers used by both `react` and `host` packages.

**Files**:

```
packages/core/src/bridge.ts
packages/core/src/__tests__/bridge.test.ts
```

**Details**:

1. **`createMessageSender(postMessage: (msg: unknown) => void)`**: Returns a typed object with methods for each event type. Prevents sending malformed events.

2. **`parseEvent(data: unknown): PostMessageEvent | null`**: Validates incoming postMessage data against the event union. Returns null for unknown/invalid events (logged, not thrown).

3. **Type guard functions**: `isWebviewToHostEvent()`, `isHostToWebviewEvent()` for runtime discrimination.

**Tests**:

- `createMessageSender` produces correctly shaped events
- `parseEvent` accepts valid events, rejects malformed ones
- Type guards discriminate correctly

---

### Task 1.4 — React Chat Panel (`@growthbeaker/ai-chat-react`)

**What**: The `ChatPanel` component — the main webview UI. Connects to `ExternalStoreRuntime` from assistant-ui, renders streaming messages with VS Code theming.

**Files**:

```
packages/react/src/index.ts                    # re-exports
packages/react/src/ChatPanel.tsx               # main component
packages/react/src/runtime/useVSCodeRuntime.ts # ExternalStoreRuntime bridge
packages/react/src/runtime/message-adapter.ts  # ChatMessage ↔ ThreadMessageLike conversion
packages/react/src/theme/vscode-theme.css      # VS Code → assistant-ui CSS var mapping
packages/react/src/__tests__/ChatPanel.test.tsx
packages/react/src/__tests__/message-adapter.test.ts
```

**Details**:

1. **`useVSCodeRuntime` hook**:
   - Uses `useExternalStoreRuntime()` hook from `@assistant-ui/react` (NOT the class directly)
   - Provides an adapter object with: `messages`, `onNew`, `setMessages`, `onEdit`, `onReload`, `isRunning`
   - Acquires `vscode` API via `acquireVsCodeApi()` (or injected mock)
   - Listens for `HostToWebviewEvent` messages and updates local state (messages array)
   - `onNew` callback: posts `sendMessage` event to host
   - On mount: posts `ready` event to host
   - Tracks `isRunning` state (true between `streamStart` and `streamEnd`/`streamError`)
   - `onCancel` callback: posts `cancelGeneration` to host

2. **`message-adapter.ts`**:
   - `toThreadMessageLike(msg: ChatMessage): ThreadMessageLike` — converts our `ChatMessage` to assistant-ui's expected format
   - `fromThreadMessageLike(msg: ThreadMessageLike): ChatMessage` — reverse conversion
   - Handles `data` content parts → assistant-ui data parts mapping

3. **`ChatPanel` component**:

   ```tsx
   function ChatPanel({ toolUIs, className }: ChatPanelProps) {
     const runtime = useVSCodeRuntime();
     return (
       <AssistantRuntimeProvider runtime={runtime}>
         {/* Tool UI components render inside the provider, not as Thread props */}
         {toolUIs && toolUIs.map((ToolUI, i) => <ToolUI key={i} />)}
         <Thread assistantMessage={{ components: { Text: MarkdownText } }} />
       </AssistantRuntimeProvider>
     );
   }
   ```

   - Tool UIs created via `makeAssistantToolUI` are rendered as sibling components inside `AssistantRuntimeProvider` (or passed to `Thread` via `tools` prop)
   - Uses `streamdown` for markdown rendering in `MarkdownText` component
   - Custom data parts can use `makeAssistantToolUI` pattern: map data to tool-call content parts and render via tool UI components

4. **`vscode-theme.css`**: The CSS variable mapping from design doc Section 3.2 / Section 7. Maps `--vscode-*` → `--aui-*` variables. Handles dark, light, and high-contrast automatically.

5. **Build**: tsup config outputs CSS file alongside JS.

**Tests**:

- `ChatPanel` renders without crashing (mock vscode API)
- `useVSCodeRuntime` sends `ready` event on mount
- `useVSCodeRuntime` posts `sendMessage` when user sends a message
- `useVSCodeRuntime` updates messages on `streamDelta` events
- `message-adapter` converts correctly in both directions
- Theme CSS file contains all expected variable mappings

**Success criteria**:

- Component renders in a test environment with mocked vscode API
- Streaming updates display correctly
- CSS variables map VS Code theme tokens to assistant-ui tokens

---

### Task 1.5 — Host Provider Core (`@growthbeaker/ai-chat-host`)

**What**: `ChatWebviewProvider` class — implements `vscode.WebviewViewProvider`, handles webview lifecycle, postMessage bridge, and HTML shell generation.

**Files**:

```
packages/host/src/index.ts
packages/host/src/ChatWebviewProvider.ts
packages/host/src/html.ts                     # HTML template generation
packages/host/src/types.ts                    # ChatProviderConfig
packages/host/src/__tests__/ChatWebviewProvider.test.ts
packages/host/src/__tests__/html.test.ts
```

**Details**:

1. **`ChatProviderConfig`** interface:

   ```typescript
   interface ChatProviderConfig {
     model: LanguageModel; // from 'ai' package
     system?: string;
     tools?: Record<string, CoreTool>;
     ui?: ChatConfig;
     extensionContext?: vscode.ExtensionContext;
   }
   ```

   (Phase 1 subset — no models map, no MCP, no persistence yet)

2. **`ChatWebviewProvider`** class:
   - Implements `vscode.WebviewViewProvider`
   - `resolveWebviewView()`: sets webview options, generates HTML, sets up message listener
   - `handleMessage(event: WebviewToHostEvent)`: dispatches to handlers based on event type
   - `postToWebview(event: HostToWebviewEvent)`: sends typed events to webview
   - Stores reference to `WebviewView` for posting messages
   - Implements `Disposable` for cleanup

3. **`html.ts`**:
   - `generateHtml(webview, extensionUri)`: Returns the HTML string with:
     - CSP meta tag (nonce-based, no unsafe-inline/eval)
     - Nonce generation (`crypto.randomBytes(16).toString('base64')`)
     - Script tag pointing to bundled webview.js
     - Style tag pointing to webview.css
     - `<div id="root">` mount point
   - Extension developers can override the webview JS/CSS paths

4. **Webview options**:
   ```typescript
   enableScripts: true;
   localResourceRoots: [extensionUri];
   ```

**Tests**:

- `resolveWebviewView` sets correct webview options
- `generateHtml` produces valid HTML with nonce, CSP, script/style tags
- `handleMessage` dispatches known events, ignores unknown ones
- `postToWebview` calls `webview.postMessage` with correct event shape

---

### Task 1.6 — LLM Streaming Integration (`@growthbeaker/ai-chat-host`)

**What**: Wire up Vercel AI SDK `streamText()` to handle `sendMessage` events and stream responses back to the webview.

**Files**:

```
packages/host/src/streaming.ts
packages/host/src/message-converter.ts   # ChatMessage[] → CoreMessage[]
packages/host/src/__tests__/streaming.test.ts
packages/host/src/__tests__/message-converter.test.ts
```

**Details**:

1. **`message-converter.ts`**:
   - `toCoreMessages(messages: ChatMessage[]): CoreMessage[]` — converts our message format to Vercel AI SDK's `CoreMessage` format
   - Handles `text`, `tool-call`, `tool-result` content parts
   - Maps roles correctly (`user`, `assistant`, `system`)

2. **`streaming.ts`** — `StreamingChatHandler` class (used internally by `ChatWebviewProvider`):

   ```typescript
   class StreamingChatHandler {
     private abortController: AbortController | null = null;

     async handleSendMessage(
       message: ChatMessage,
       history: ChatMessage[],
       config: { model; system; tools },
       postToWebview: (event: HostToWebviewEvent) => void,
     ): Promise<ChatMessage>; // returns the complete assistant message
   }
   ```

   - Creates a new `AbortController` for each generation
   - Calls `streamText()` with model, system prompt, converted messages, tools
   - On each chunk: posts `streamDelta` event to webview
   - On completion: posts `streamEnd`, returns the full assistant message
   - On error: posts `streamError` with error message
   - `cancel()`: aborts the current stream

3. **Chunk → ContentPart mapping**:
   - Text delta → `{ type: "text", text: deltaText }`
   - Tool call → `{ type: "tool-call", toolCallId, toolName, args }`
   - Tool result → `{ type: "tool-result", toolCallId, toolName, result }`

4. **Integration into `ChatWebviewProvider`**:
   - On `sendMessage`: append user message to in-memory thread, call `StreamingChatHandler.handleSendMessage()`, append assistant message
   - On `cancelGeneration`: call `StreamingChatHandler.cancel()`
   - In-memory thread storage (just an array of messages — no persistence in Phase 1)

**Tests**:

- `toCoreMessages` converts all content part types correctly
- `StreamingChatHandler` calls `streamText` with correct parameters (mock AI SDK)
- Delta events are posted to webview in order
- `streamEnd` is posted after completion
- `streamError` is posted on LLM errors
- `cancel()` triggers abort and posts `streamEnd`

**Success criteria**:

- User can send a message and receive a streamed response
- Cancellation works
- Errors are surfaced to the webview

---

### Task 1.7 — Tool Execution (`@growthbeaker/ai-chat-host`)

**What**: Support tool definitions that the LLM can call. Phase 1 covers synchronous (auto-execute) tools only — no HITL approval yet.

**Files**:

```
packages/host/src/tools.ts
packages/host/src/__tests__/tools.test.ts
```

**Details**:

1. **Tool registry**:
   - Accept tools in `ChatProviderConfig.tools` as `Record<string, CoreTool>` (Vercel AI SDK tool type)
   - Pass tools directly to `streamText()` call
   - AI SDK handles tool execution via the `execute` function on each tool

2. **Tool call/result flow**:
   - When `streamText` encounters a tool call, it executes the tool's `execute` function
   - The result is automatically fed back to the LLM for the next step (via `maxSteps`)
   - Tool call and result content parts are streamed to the webview as `streamDelta` events
   - Webview renders tool calls/results in the message stream

3. **`maxSteps` / `stopWhen` configuration**:
   - AI SDK v4+ uses `maxSteps` (not `maxToolRoundtrips`)
   - AI SDK v5+ also supports `stopWhen: stepCountIs(n)` as an alternative
   - Default: `maxSteps: 5` (allow multi-step tool use)
   - Configurable via `ChatProviderConfig.maxSteps`

**Tests**:

- Tools are passed to `streamText` correctly
- Tool execution results are included in streamed response
- Multi-step tool use works (tool call → result → LLM continues)

---

### Task 1.8 — Example Extension

**What**: A minimal working VS Code extension demonstrating the library.

**Files**:

```
examples/basic-chat/
├── src/
│   ├── extension.ts          # activate(), registers provider
│   └── webview/
│       └── index.tsx          # React entry point
├── package.json               # VS Code extension manifest
├── tsconfig.json
├── esbuild.config.mjs         # Builds extension + webview
├── .vscodeignore
└── .vscode/
    └── launch.json            # F5 debugging config
```

**Details**:

1. **`extension.ts`** (~15 lines, matching design doc Section 4):

   ```typescript
   import * as vscode from "vscode";
   import { ChatWebviewProvider } from "@growthbeaker/ai-chat-host";
   import { anthropic } from "@ai-sdk/anthropic";

   export function activate(context: vscode.ExtensionContext) {
     const provider = new ChatWebviewProvider(context.extensionUri, {
       model: anthropic("claude-sonnet-4-5"),
       system: "You are a helpful coding assistant.",
       extensionContext: context,
     });
     context.subscriptions.push(
       vscode.window.registerWebviewViewProvider("basicChat.chatView", provider),
     );
   }
   ```

2. **`webview/index.tsx`** (~5 lines):

   ```tsx
   import { createRoot } from "react-dom/client";
   import { ChatPanel } from "@growthbeaker/ai-chat-react";
   createRoot(document.getElementById("root")!).render(<ChatPanel />);
   ```

3. **`package.json`** contributes:
   - `views.explorer`: webview view `basicChat.chatView`
   - `activationEvents`: `onView:basicChat.chatView`

4. **`esbuild.config.mjs`**: Two builds:
   - Extension host: `src/extension.ts` → `dist/extension.js` (CJS, external: vscode)
   - Webview: `src/webview/index.tsx` → `dist/webview.js` (IIFE, bundled)

5. **`.vscode/launch.json`**: Extension Development Host config for F5 debugging.

**Success criteria**:

- `pnpm build` in the example compiles both extension and webview
- F5 launches Extension Development Host
- Chat sidebar appears and renders
- User can type a message and receive a streamed response (requires API key)

---

### Task 1.9 — CI & Quality

**What**: GitHub Actions workflow, linting, formatting.

**Files**:

```
.github/workflows/ci.yml
.eslintrc.cjs (or eslint.config.mjs)
.prettierrc
```

**Details**:

1. **CI workflow** (`ci.yml`):
   - Trigger: push to `main`, all PRs
   - Steps: checkout → pnpm install → `turbo build` → `turbo typecheck` → `turbo test`
   - Node 20.x, pnpm 9.x

2. **ESLint**: TypeScript-aware rules, React rules for the `react` package.

3. **Prettier**: Consistent formatting across all packages.

4. **Changesets**: `@changesets/cli` for version management. `.changeset/config.json` with linked versioning (all packages share a version).

**Success criteria**:

- CI passes on a clean clone
- `pnpm lint` and `pnpm format:check` pass

---

### Task 1.10 — npm Publish Setup

**What**: Package metadata, publish config, changesets workflow.

**Files**:

```
.changeset/config.json
packages/*/package.json (update: repository, license, files, main, module, types, exports)
.github/workflows/release.yml
```

**Details**:

1. **Package exports** (each package):

   ```json
   {
     "main": "./dist/index.cjs",
     "module": "./dist/index.js",
     "types": "./dist/index.d.ts",
     "exports": {
       ".": {
         "import": "./dist/index.js",
         "require": "./dist/index.cjs",
         "types": "./dist/index.d.ts"
       }
     },
     "files": ["dist", "README.md", "LICENSE"]
   }
   ```

   (`react` package also exports `./styles` → CSS file)

2. **Release workflow**: On push to `main`, changesets bot creates a "Version Packages" PR. On merge, publishes to npm.

3. **LICENSE**: MIT license file at root and in each package.

**Success criteria**:

- `pnpm pack` in each package produces a valid tarball
- Package exports resolve correctly

---

## Phase 2: Multi-Thread, Persistence, MCP

Goal: Production-ready features for real extensions. Each task builds on Phase 1.

### Task 2.1 — Thread Management

**What**: Multi-thread support — create, switch, delete threads. Thread list UI.

**Changes**:

- **`core`**: Thread list event types already defined (Phase 1 types). Add thread metadata helpers.
- **`host`**: `ChatWebviewProvider` manages multiple threads in memory. Handles `createThread`, `switchThread`, `deleteThread` events. Sends `threadList` and `threadState` events on changes.
- **`react`**: Add `ThreadList` component (from assistant-ui) to `ChatPanel`. Connect to `ExternalStoreThreadListAdapter`. Show/hide based on `showThreadList` config.

- User can create new threads, switch between them, delete threads
- Thread list displays in sidebar
- Each thread has independent message history

---

### Task 2.2 — Persistence Adapters

**What**: Save/load threads across sessions.

**Changes**:

- **`host`**: Implement `GlobalStateStorage` and `FileSystemStorage` adapters (from design doc Section 3.3).
- **`host`**: `ChatWebviewProvider` calls `storage.saveThread()` after each completed exchange.
- **`host`**: On `ready` event from webview, load thread list from storage and send to webview.
- **Config**: `persistence: "globalState" | "filesystem" | ThreadStorage` option.

**Success criteria**:

- Threads survive VS Code restart
- Thread list loads from storage on activation
- Custom `ThreadStorage` implementations work

---

### Task 2.3 — MCP Client Integration

**What**: Connect to MCP servers, discover tools, merge into tool registry.

**Changes**:

- **`host`**: MCP configuration in `ChatProviderConfig.mcpServers`. On init, create MCP clients via `@ai-sdk/mcp`. Discover tools and merge with local tools. Cleanup on dispose.
- **`core`**: Add MCP server config types (`MCPServerConfig` with transport, command, args, url, headers).

**Success criteria**:

- MCP tools appear in `streamText` tool list
- LLM can call MCP tools, results flow back correctly
- MCP clients are cleaned up on extension deactivation
- All three transports work (stdio, HTTP, SSE)

---

### Task 2.4 — Multi-Model Runtime Switching

**What**: Configure multiple models, switch at runtime from the UI.

**Changes**:

- **`core`**: Add `switchModel` event to `WebviewToHostEvent`. Add `activeModel` to `ChatConfig`.
- **`host`**: `ChatProviderConfig.models` map. `handleModelSwitch()` method. Send `configUpdate` on switch.
- **`react`**: Model selector dropdown in chat header. Sends `switchModel` event.

**Success criteria**:

- User can switch models mid-conversation
- Model selector shows available models
- New messages use the selected model

---

### Task 2.5 — Tool Approval (HITL)

**What**: Human-in-the-loop tool approval flow.

**Changes**:

- **`core`**: Tools can be marked as `requiresApproval: true`.
- **`host`**: When a tool requires approval, post `toolCall` event to webview instead of executing immediately. Wait for `toolApproval` response. Execute or skip based on approval.
- **`react`**: Extension developers register tool UIs via `makeAssistantToolUI` and pass to `ChatPanel.toolUIs`. Default fallback UI for tools without a custom renderer.

**Success criteria**:

- Approval-required tools pause execution until user responds
- Approved tools execute and return results to LLM
- Denied tools return a "denied" result to LLM
- Custom tool UIs render correctly

---

### Task 2.6 — Custom Data-Part Renderers

**What**: Extensions can inject custom UI cards into the chat stream.

**Changes**:

- **`host`**: Tool `execute` functions can return structured data. Host wraps as `data` content parts.
- **`react`**: Extension developers register renderers via `makeAssistantDataUI` and pass to `ChatPanel.dataParts`. Default fallback: JSON display.

**Success criteria**:

- Custom data parts render with registered component
- Unregistered data parts show fallback JSON view
- Multiple data part types can coexist

---

### Task 2.7 — Chat Session Templates

**What**: Pre-configured chat sessions with specific system prompts and tools.

**Changes**:

- **`host`**: `registerTemplate()` method on `ChatWebviewProvider`. Templates specify: id, label, systemPrompt, tools, model (optional).
- **`core`**: Template types, `selectTemplate` event.
- **`react`**: Template picker UI (dropdown or command palette integration).

**Success criteria**:

- Extension can register templates from external prompt files
- User can select a template to start a new session
- Template's system prompt and tools are active for that session

---

### Task 2.8 — Workflow HITL Bridge

**What**: Background workflows can post messages to chat and wait for user actions.

**Changes**:

- **`host`**: `chatHost.postSystemMessage(data)` — inject a data-part message into the chat from outside a chat session.
- **`host`**: `chatHost.waitForUserAction(actionId)` — returns a Promise that resolves when user interacts with a card.
- **`core`**: `userAction` event type for webview → host communication from custom card buttons.

**Success criteria**:

- Background workflow can post a card to the chat
- Workflow suspends on `waitForUserAction`
- User clicking a button in the card resolves the promise
- Workflow continues after user action

---

### Task 2.9 — Message Editing & Branching

**What**: Users can edit previous messages and branch conversations.

**Changes**:

- **`host`**: Handle `editMessage` and `branchMessage` events. Editing a message creates a branch — the thread forks from that point. Re-run the LLM from the edited message.
- **`react`**: Edit button on user messages. Branch indicator UI. Navigation between branches.
- **`core`**: Branch metadata in `ChatThread` (parent message ID, branch index).

**Success criteria**:

- User can edit a previous message
- Editing re-runs the conversation from that point
- Previous branches are preserved and navigable

---

## Phase 3: Advanced Features

Goal: Polish and power-user features. Lower priority, can be done in any order.

### Task 3.1 — File Attachments

- Support attaching images, PDFs, code files to messages
- Render file previews in chat
- Send file content to LLM (for vision models: base64 images; for text: inline content)

### Task 3.2 — WebviewPanel Support

- `openChatPanel()` helper for editor-area chat (not just sidebar)
- Same `ChatWebviewProvider` config, different webview container
- `ViewColumn` configuration

### Task 3.3 — Context Mentions

- `@file`, `@workspace`, `@symbol` mentions in the input box
- VS Code symbol/file picker integration
- Mentioned content injected into the message context

### Task 3.4 — Token Usage & Cost Tracking

- Display token counts per message (from AI SDK usage metadata)
- Running cost estimate (configurable per-model pricing)
- Session total display

### Task 3.5 — Export Conversations

- Export thread as JSON (full fidelity)
- Export thread as Markdown (human-readable)
- Copy-to-clipboard option

### Task 3.6 — Voice Input

- VS Code Speech API integration
- Push-to-talk or continuous listening modes
- Transcribed text sent as regular messages

### Task 3.7 — Prompt Templates / Slash Commands

- `/` command palette in the input box
- Predefined prompts (e.g., `/explain`, `/refactor`, `/test`)
- Extension developers register custom commands

### Task 3.8 — Drag-and-Drop

- Drag files from explorer into chat
- Drag code selections into chat
- Drop zone UI with visual feedback

---

## Implementation Order & Dependencies

```
Phase 1 (linear, ~2-3 weeks):
  1.1 Scaffolding
   └─► 1.2 Core Types
        └─► 1.3 PostMessage Bridge
             ├─► 1.4 React Chat Panel
             │    └──────────────────┐
             └─► 1.5 Host Provider   │
                  └─► 1.6 Streaming  │
                       └─► 1.7 Tools │
                            └────────┤
                                     └─► 1.8 Example Extension
                                          └─► 1.9 CI & Quality
                                               └─► 1.10 Publish Setup

Phase 2 (parallel where noted, ~3-4 weeks):
  2.1 Thread Management ─► 2.2 Persistence (sequential)
  2.3 MCP Integration (independent)
  2.4 Multi-Model (independent)
  2.5 Tool Approval (after 2.3 if MCP tools need approval)
  2.6 Data-Part Renderers (independent)
  2.7 Session Templates (after 2.1)
  2.8 Workflow HITL Bridge (after 2.6)
  2.9 Message Editing & Branching (after 2.1)

Phase 3 (all independent, priority order):
  3.2 WebviewPanel → 3.1 Attachments → 3.3 Context Mentions → 3.4-3.8
```

---

## Open Questions to Resolve Before Starting

From design doc Section 11, decisions needed:

| #   | Question                   | Recommended Answer                                                                                                                                                      |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | React version              | Peer dep `>=18.0.0 <20`. Support 18 and 19.                                                                                                                             |
| 2   | Webview state on hide/show | Default to `retainContextWhenHidden: false`. Document the trade-off. Let consumers override.                                                                            |
| 3   | Streaming granularity      | Buffer with 50ms debounce by default. Make configurable via `ChatProviderConfig.streamBufferMs`.                                                                        |
| 4   | AbortController / cancel   | Show "cancelled" status in webview. Persist partial response with `status: "cancelled"` metadata.                                                                       |
| 5   | Error taxonomy             | Surface auth, rate-limit, network errors to user via `streamError`. Transient retries handled silently (1 retry). Provide default error UI in `ChatPanel`, overridable. |

---

## Risk Mitigation

| Risk                          | Mitigation                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| assistant-ui breaking changes | Pin to a specific minor version range. Test upgrades in CI.                                      |
| Vercel AI SDK API changes     | Same — pin minor version. The SDK is relatively stable post-v4.                                  |
| Webview CSP issues            | Test CSP compliance in CI (no eval, no unsafe-inline). Example extension is the canary.          |
| Large thread serialization    | Phase 2 filesystem adapter handles large threads. Add configurable message limit per thread.     |
| MCP server crashes            | Wrap MCP client calls in try/catch. Auto-reconnect with backoff. Surface errors as tool results. |
