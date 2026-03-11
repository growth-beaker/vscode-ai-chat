import * as vscode from "vscode";
import { ChatWebviewProvider } from "@vscode-ai-chat/host";
import { anthropic } from "@ai-sdk/anthropic";

export function activate(context: vscode.ExtensionContext) {
  // ── Managed Mode (LLM handled by the library) ──────────────────

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[basic-chat] ANTHROPIC_API_KEY is not set in process.env. The chat will fail to connect to the API.");
    console.warn("[basic-chat] Launch VS Code from a terminal where the key is exported, or set it in your shell profile.");
  } else {
    console.log("[basic-chat] ANTHROPIC_API_KEY is set (length:", apiKey.length, ")");
  }

  const provider = new ChatWebviewProvider(context.extensionUri, {
    model: anthropic("claude-sonnet-4-5"),
    system: "You are a helpful coding assistant.",
    ui: {
      title: "AI Chat",
      placeholder: "Ask me anything... (try / for commands, @ for file mentions)",
    },
    slashCommands: [
      {
        name: "clear",
        description: "Clear the conversation",
        execute: async (_args, _context) => {
          return "Conversation cleared.";
        },
      },
      {
        name: "help",
        description: "Show available commands",
        execute: async () => {
          return "Available commands:\n- /clear — Clear the conversation\n- /help — Show this help message\n- /status — Show system status";
        },
      },
      {
        name: "status",
        description: "Show system status",
        execute: async (_args, ctx) => {
          // Use the response context for progressive output
          ctx.progress("Checking system status...");
          await new Promise((resolve) => setTimeout(resolve, 500));
          ctx.respond("**System Status**\n\n| Component | Status |\n|-----------|--------|\n| API | Online |\n| Database | Connected |");
        },
      },
    ],
    contextMentionProvider: {
      resolveFile: async (query) => {
        const pattern = query ? `**/*${query}*` : "**/*";
        const files = await vscode.workspace.findFiles(pattern, "**/node_modules/**", 10);
        return files.map((uri) => {
          const relative = vscode.workspace.asRelativePath(uri);
          return {
            label: uri.path.split("/").pop() ?? relative,
            description: relative,
            value: relative,
          };
        });
      },
      resolveWorkspace: async (_query) => {
        const folders = vscode.workspace.workspaceFolders ?? [];
        return folders.map((f) => ({
          label: f.name,
          description: f.uri.fsPath,
          value: f.name,
        }));
      },
      resolveSymbol: async (query) => {
        const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
          "vscode.executeWorkspaceSymbolProvider",
          query || "",
        );
        return (symbols ?? []).slice(0, 10).map((s) => ({
          label: s.name,
          description: `${vscode.SymbolKind[s.kind]} in ${vscode.workspace.asRelativePath(s.location.uri)}`,
          value: s.name,
        }));
      },
    },
    // Intercept messages before they reach the LLM
    onMessage: async (message, _thread) => {
      if (message.toLowerCase().startsWith("ping")) {
        provider.postSystemMessage([{ type: "text", text: "Pong!" }]);
        return { handled: true };
      }
      return "passthrough";
    },
    // Observe tool results (e.g. track which files were modified)
    onToolResult: (toolName, args, result) => {
      console.log(`[basic-chat] Tool ${toolName} completed:`, { args, result });
    },
    // Custom cancellation logic
    onCancel: () => {
      console.log("[basic-chat] Generation cancelled by user");
    },
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "basicChat.chatView",
      provider as unknown as vscode.WebviewViewProvider,
    ),
  );

  // ── Manual Mode Example (extension drives streaming) ────────────
  // Omit `model` to use the chat as a "dumb pipe" UI.
  // Useful when your LLM calls go through a separate SDK.

  const manualProvider = new ChatWebviewProvider(context.extensionUri, {
    // No model — manual mode
    ui: {
      title: "Custom Agent Chat",
      placeholder: "Talk to the agent...",
    },
    slashCommands: [
      {
        name: "run",
        description: "Run the agent workflow",
        execute: async (_args, ctx) => {
          ctx.progress("Starting workflow...");
        },
      },
    ],
  });

  // Example: manually stream a response from your own backend
  //
  //   const messageId = manualProvider.pushStreamStart();
  //   manualProvider.pushText("Working on it...");
  //   manualProvider.pushText(" Done!");
  //   manualProvider.pushStreamEnd();
  //
  // Signal what the user should do next:
  //   manualProvider.setInputHint("Describe what to change…");
  //   manualProvider.setInputHint(null); // clear
  //
  // Classified errors:
  //   manualProvider.pushStreamError("Request cancelled", "cancel");
  //
  // Update system prompt at runtime:
  //   manualProvider.setSystemPrompt("New instructions for the next request");
  //
  // Or inject a full message:
  //   manualProvider.postSystemMessage([{ type: "text", text: "Agent completed." }]);
  //
  // Programmatically send messages or execute commands:
  //   manualProvider.sendUserMessage("/run my-workflow");
  //   manualProvider.executeSlashCommand("run", "my-workflow");

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "basicChat.manualChatView",
      manualProvider as unknown as vscode.WebviewViewProvider,
    ),
  );
}

export function deactivate() {}
