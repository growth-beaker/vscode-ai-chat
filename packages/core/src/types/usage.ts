/** Token usage for a single LLM generation */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Aggregate usage stats for a thread */
export interface ThreadUsage {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  messageCount: number;
}

/** Compute aggregate usage from per-message metadata */
export function aggregateUsage(
  messages: Array<{ metadata?: Record<string, unknown> }>,
): ThreadUsage {
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let messageCount = 0;

  for (const msg of messages) {
    const usage = msg.metadata?.usage as TokenUsage | undefined;
    if (usage) {
      totalPromptTokens += usage.promptTokens;
      totalCompletionTokens += usage.completionTokens;
      totalTokens += usage.totalTokens;
      messageCount++;
    }
  }

  return { totalPromptTokens, totalCompletionTokens, totalTokens, messageCount };
}
