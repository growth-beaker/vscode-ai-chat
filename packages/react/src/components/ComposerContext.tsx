import { createContext, useContext, type ReactNode } from "react";

export interface ComposerConfig {
  showAttach?: boolean;
  models?: string[];
  activeModel?: string;
  onModelSwitch?: (modelId: string) => void;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  onExport?: (format: "json" | "markdown") => void;
}

const ComposerConfigContext = createContext<ComposerConfig>({});

export function ComposerConfigProvider({
  value,
  children,
}: {
  value: ComposerConfig;
  children: ReactNode;
}) {
  return (
    <ComposerConfigContext.Provider value={value}>
      {children}
    </ComposerConfigContext.Provider>
  );
}

export function useComposerConfig() {
  return useContext(ComposerConfigContext);
}
