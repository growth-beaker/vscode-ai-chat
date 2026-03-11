# @growthbeaker/ai-chat-react

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
