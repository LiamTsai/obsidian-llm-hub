import { beforeEach, describe, expect, it, vi } from "vitest";
import * as common from "obsidian-llm-hub-common/core";
import {
  displayedTavilyRemaining,
  ESTIMATE_TTL_MS,
  noteTavilySearch,
  resetSearchQuotaEstimates,
  subscribeSearchQuota,
  tavilyRemaining,
} from "./searchQuotaTracker";

const usage = (remaining: number) => ({ fetchedAt: 0, plan: { used: 1000 - remaining, limit: 1000, remaining } });

describe("searchQuotaTracker", () => {
  beforeEach(() => {
    resetSearchQuotaEstimates();
    vi.restoreAllMocks();
  });

  it("counts searches down from the last official number", () => {
    vi.spyOn(common, "getTavilyUsage").mockReturnValue(usage(873));
    const listener = vi.fn();
    const unsubscribe = subscribeSearchQuota(listener);
    for (let i = 0; i < 4; i++) noteTavilySearch("key", 1000);
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(4);
    // Tavily still reports 873 (lagging): show the local estimate.
    expect(displayedTavilyRemaining("key", 873, 2000)).toBe(869);
  });

  it("switches back to the official number once it catches up or goes lower", () => {
    vi.spyOn(common, "getTavilyUsage").mockReturnValue(usage(873));
    noteTavilySearch("key", 1000);
    expect(displayedTavilyRemaining("key", 872, 2000)).toBe(872);
    // The estimate is gone, so a later official number is shown as is.
    expect(displayedTavilyRemaining("key", 870, 3000)).toBe(870);
  });

  it("forgets the estimate after the TTL (e.g. a monthly reset)", () => {
    vi.spyOn(common, "getTavilyUsage").mockReturnValue(usage(10));
    noteTavilySearch("key", 1000);
    expect(displayedTavilyRemaining("key", 1000, 1000 + ESTIMATE_TTL_MS + 1)).toBe(1000);
  });

  it("does nothing without a known official number", () => {
    vi.spyOn(common, "getTavilyUsage").mockReturnValue(undefined);
    noteTavilySearch("key", 1000);
    expect(displayedTavilyRemaining("key", 500, 2000)).toBe(500);
  });

  it("uses the tighter of plan and key limits", () => {
    expect(tavilyRemaining({ fetchedAt: 0, plan: { used: 0, limit: 1000, remaining: 1000 }, key: { used: 90, limit: 100, remaining: 10 } })).toBe(10);
    expect(tavilyRemaining({ fetchedAt: 0, plan: { used: 0, limit: null, remaining: null } })).toBeNull();
  });
});

describe("createExternalSearchSession counting", () => {
  beforeEach(() => {
    resetSearchQuotaEstimates();
    vi.restoreAllMocks();
  });

  it("notes each successful Tavily search, not failed ones", async () => {
    const { createExternalSearchSession } = await import("./externalWebSearch");
    vi.spyOn(common, "getTavilyUsage").mockReturnValue(usage(100));
    let ok = true;
    const transport = async () => ok
      ? { status: 200, json: { results: [{ title: "A", url: "https://a.example", content: "x" }] }, headers: {} }
      : { status: 500, json: null, headers: {} };
    const session = createExternalSearchSession(
      { settings: { provider: "tavily", tavilyApiKey: "key", braveApiKey: "", mode: "external" }, transport },
      [], "", undefined,
    );
    await session.execute("web_search", { query: "one" });
    await session.execute("web_search", { query: "two" });
    ok = false;
    await session.execute("web_search", { query: "fails" });
    expect(displayedTavilyRemaining("key", 100)).toBe(98);
  });
});
