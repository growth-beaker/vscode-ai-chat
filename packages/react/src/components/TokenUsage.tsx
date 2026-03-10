export interface TokenUsageProps {
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

export function TokenUsage({ usage }: TokenUsageProps) {
  if (!usage) return null;

  return (
    <div className="aui-token-usage" title="Token usage for last response">
      <span className="aui-token-usage-item">
        <span className="aui-token-usage-label">In:</span>{" "}
        {formatTokenCount(usage.promptTokens)}
      </span>
      <span className="aui-token-usage-separator">/</span>
      <span className="aui-token-usage-item">
        <span className="aui-token-usage-label">Out:</span>{" "}
        {formatTokenCount(usage.completionTokens)}
      </span>
      <span className="aui-token-usage-separator">/</span>
      <span className="aui-token-usage-item">
        <span className="aui-token-usage-label">Total:</span>{" "}
        {formatTokenCount(usage.totalTokens)}
      </span>
    </div>
  );
}
