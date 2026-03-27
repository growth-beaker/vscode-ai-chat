# @growthbeaker/ai-chat-host

## 1.0.5

### Patch Changes

- Fix threadState handler killing active streams and add waitForReady() method
  - Fixed regression in React threadState handler where receiving a threadState event during an active stream would reset streaming state, causing the stream to be lost. The handler now preserves the active streaming message when the thread ID matches and only resets streaming state on thread switches.
  - Added `waitForReady()` method to ChatWebviewProvider that returns a Promise resolving when the webview sends its ready event. Resolves immediately if already ready. Resets on webview recreation.

## 1.0.4

### Patch Changes

- Fix thread state sync after onMessage returns handled and add postAssistantMessage method
  - Fixed: when `onMessage` returns `{ handled: true }`, the library now posts `threadState` to the webview so the user message renders immediately. Previously only the thread list was synced, causing the conversation to appear broken in manual mode.
  - Added: `postAssistantMessage(content)` method to inject a regular assistant message into the thread without system metadata, rendering it like a normal Claude response.

## 1.0.3

### Patch Changes

- Fix GlobalStateStorage.loadThread() not converting date strings back to Date objects

## 1.0.1

### Patch Changes

- Fix onMessage unreachable in manual mode, persist manual-mode streaming messages, add error handling for onMessage failures, and tighten chat line-height/paragraph spacing

## 1.0.0

### Major Changes

- Initial release

### Minor Changes

- Add manual-mode tool rendering, input hints, error classification, dynamic system prompts, tool result hooks, and pre-populated threads.
  - `pushText()` shorthand for text stream deltas
  - `pushToolCall()` / `pushToolResult()` for rendering tool execution in manual mode
  - `requestToolApproval()` for human-in-the-loop tool approval from external backends
  - `setInputHint()` to set composer placeholder text after stream ends
  - `pushStreamError(error, code?)` with optional error classification
  - `setSystemPrompt()` for runtime system prompt updates
  - `onToolResult` config callback fired after each tool execution
  - `createThread()` accepts options object with seed messages, title, and metadata
  - `InputHintEvent` added to host-to-webview event protocol

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @growthbeaker/ai-chat-core@1.0.0
