import { describe, it, expect } from "vitest";
import { aggregateUsage } from "../types/usage.js";
import type { TokenUsage, ThreadUsage } from "../types/usage.js";

describe("aggregateUsage", () => {
  it("returns zeros for empty messages array", () => {
    const result = aggregateUsage([]);
    expect(result).toEqual({
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      messageCount: 0,
    });
  });

  it("returns zeros when no messages have usage metadata", () => {
    const messages = [
      { metadata: { model: "claude-sonnet" } },
      { metadata: {} },
      {},
    ];
    const result = aggregateUsage(messages);
    expect(result).toEqual({
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      messageCount: 0,
    });
  });

  it("aggregates usage from a single message", () => {
    const usage: TokenUsage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };
    const messages = [{ metadata: { usage } }];
    const result = aggregateUsage(messages);
    expect(result).toEqual({
      totalPromptTokens: 100,
      totalCompletionTokens: 50,
      totalTokens: 150,
      messageCount: 1,
    });
  });

  it("aggregates usage from multiple messages", () => {
    const messages = [
      { metadata: { usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } } },
      { metadata: { usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280 } } },
      { metadata: { usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 } } },
    ];
    const result = aggregateUsage(messages);
    expect(result).toEqual({
      totalPromptTokens: 350,
      totalCompletionTokens: 150,
      totalTokens: 500,
      messageCount: 3,
    });
  });

  it("only counts messages that have usage metadata", () => {
    const messages = [
      { metadata: { usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } } },
      { metadata: { model: "gpt-4" } }, // no usage
      {}, // no metadata at all
      { metadata: { usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 } } },
    ];
    const result = aggregateUsage(messages);
    expect(result.messageCount).toBe(2);
    expect(result.totalPromptTokens).toBe(300);
    expect(result.totalCompletionTokens).toBe(150);
    expect(result.totalTokens).toBe(450);
  });

  it("handles messages with undefined metadata", () => {
    const messages = [
      { metadata: undefined },
      {},
    ];
    const result = aggregateUsage(messages);
    expect(result.messageCount).toBe(0);
    expect(result.totalTokens).toBe(0);
  });

  it("returns correct ThreadUsage type shape", () => {
    const result: ThreadUsage = aggregateUsage([]);
    expect(result).toHaveProperty("totalPromptTokens");
    expect(result).toHaveProperty("totalCompletionTokens");
    expect(result).toHaveProperty("totalTokens");
    expect(result).toHaveProperty("messageCount");
  });
});
