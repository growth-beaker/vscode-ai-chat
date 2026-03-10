import * as vscode from "vscode";
import { ChatWebviewProvider } from "@vscode-ai-chat/host";
import { anthropic } from "@ai-sdk/anthropic";

export function activate(context: vscode.ExtensionContext) {
  // Check API key availability early
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
      placeholder: "Ask me anything...",
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
          return "Available commands:\n- /clear — Clear the conversation\n- /help — Show this help message";
        },
      },
    ],
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "basicChat.chatView",
      provider as unknown as vscode.WebviewViewProvider,
    ),
  );
}

export function deactivate() {}
