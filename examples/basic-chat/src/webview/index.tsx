import { createRoot } from "react-dom/client";
import { ChatPanel } from "@growthbeaker/ai-chat-react";
import "@growthbeaker/ai-chat-react/styles";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <ChatPanel
      showExport
      showTokenUsage
      enableFileDrop
      enableSlashCommands
      enableMentions
    />,
  );
}
