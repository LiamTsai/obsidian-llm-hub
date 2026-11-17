import { describe, expect, it } from "vitest";
import { summarizeBraveUsage, summarizeTavilyUsage } from "./WebSearchQuota";

describe("summarizeTavilyUsage", () => {
  it("uses the tighter of plan and key limits", () => {
    const summary = summarizeTavilyUsage({
      fetchedAt: 0,
      plan: { used: 127, limit: 1000, remaining: 873 },
      key: { used: 450, limit: 500, remaining: 50 },
    });
    expect(summary.remaining).toBe(50);
    expect(summary.detail).toContain("Tavily");
  });

  it("reports an unlimited plan as null", () => {
    expect(summarizeTavilyUsage({ fetchedAt: 0, plan: { used: 5, limit: null, remaining: null } }).remaining).toBeNull();
  });
});

describe("summarizeBraveUsage", () => {
  it("shows the longest window and ignores per-second windows", () => {
    const summary = summarizeBraveUsage({
      fetchedAt: 0,
      windows: [
        { limit: 1, remaining: 1, windowSeconds: 1 },
        { limit: 2000, remaining: 1990, windowSeconds: 2592000 },
      ],
    });
    expect(summary?.remaining).toBe(1990);
  });

  it("returns null without a usable window", () => {
    expect(summarizeBraveUsage({ fetchedAt: 0, windows: [{ limit: 1, remaining: 1, windowSeconds: 1 }] })).toBeNull();
  });
});
