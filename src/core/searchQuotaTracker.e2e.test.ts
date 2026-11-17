import { describe, expect, it } from "vitest";
import { fetchTavilyUsage, getTavilyUsage } from "obsidian-llm-hub-common/core";
import { createExternalSearchSession } from "./externalWebSearch";
import { displayedTavilyRemaining, tavilyRemaining } from "./searchQuotaTracker";

// No mocks of the shared module: the real usage cache, search session, and tracker.
describe("Tavily quota end to end", () => {
  it("drops the shown count after real searches while Tavily's number lags", async () => {
    const key = "e2e-key";
    await fetchTavilyUsage(key, async () => ({
      status: 200, headers: {},
      json: { account: { plan_usage: 127, plan_limit: 1000 }, key: { usage: 127, limit: null } },
    }));
    const official = tavilyRemaining(getTavilyUsage(key)!);
    expect(official).toBe(873);

    const session = createExternalSearchSession(
      { settings: { provider: "tavily", tavilyApiKey: key, braveApiKey: "", mode: "external" },
        transport: async () => ({ status: 200, headers: {}, json: { results: [{ title: "A", url: "https://a.example", content: "x" }] } }) },
      [], "", undefined,
    );
    for (let i = 0; i < 4; i++) {
      const result = await session.execute("web_search", { query: `q${i}` });
      expect(result).toHaveProperty("results");
    }
    expect(displayedTavilyRemaining(key, official)).toBe(869);
  });
});
