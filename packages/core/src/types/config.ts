export interface ChatConfig {
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
