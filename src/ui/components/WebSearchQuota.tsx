import { useEffect, useReducer, useRef, useState } from "react";
import {
  fetchTavilyUsage,
  getBraveUsage,
  getTavilyUsage,
  subscribeWebSearchUsage,
  type BraveUsage,
  type TavilyUsage,
} from "obsidian-llm-hub-common/core";
import type { WebSearchSettings } from "src/core/webSearchMode";
import { displayedTavilyRemaining, subscribeSearchQuota, tavilyRemaining } from "src/core/searchQuotaTracker";
import { getLocale, t } from "src/i18n";

/** Outside of replies (opening a chat, switching models), re-check Tavily at most this often. */
const TAVILY_REFRESH_MS = 30_000;
/** Wait briefly after a reply so Tavily has counted its searches. */
const REPLY_SETTLE_MS = 2_000;

/**
 * Always re-check after a reply finishes (it may have searched); otherwise only
 * when the last check is older than TAVILY_REFRESH_MS. Checking usage is free.
 */
export function shouldRefreshTavily(replyFinished: boolean, lastCheckedAt: number, now: number): boolean {
  return replyFinished || now - lastCheckedAt >= TAVILY_REFRESH_MS;
}

export interface QuotaSummary {
  /** Remaining searches, or null when the plan is unlimited. */
  remaining: number | null;
  /** Full breakdown for the tooltip. */
  detail: string;
}

const formatNumber = (value: number) => value.toLocaleString(getLocale());
const asOf = (fetchedAt: number) => t("settings.webSearch.usage.asOf", { date: new Date(fetchedAt).toLocaleString(getLocale()) });

export function summarizeTavilyUsage(usage: TavilyUsage): QuotaSummary {
  // A basic search costs one credit; the per-key limit applies when it is tighter than the plan.
  const remaining = tavilyRemaining(usage);
  const parts = [`Tavily ${t("settings.webSearch.usage.plan")}: ${usage.plan.remaining === null
    ? t("settings.webSearch.usage.unlimited")
    : t("settings.webSearch.usage.credits", { remaining: formatNumber(usage.plan.remaining), limit: formatNumber(usage.plan.limit ?? 0) })}`];
  if (usage.key?.remaining != null) {
    parts.push(`${t("settings.webSearch.usage.key")}: ${t("settings.webSearch.usage.credits", {
      remaining: formatNumber(usage.key.remaining), limit: formatNumber(usage.key.limit ?? 0) })}`);
  }
  parts.push(asOf(usage.fetchedAt));
  return { remaining, detail: parts.join("\n") };
}

export function summarizeBraveUsage(usage: BraveUsage): QuotaSummary | null {
  // Show the longest window (usually monthly); short per-second windows refill constantly.
  const windows = usage.windows.filter(w => w.windowSeconds > 1).sort((a, b) => b.windowSeconds - a.windowSeconds);
  if (windows.length === 0) return null;
  const main = windows[0];
  const lines = windows.map(w => {
    const period = w.windowSeconds % 86400 === 0
      ? t("settings.webSearch.usage.days", { count: w.windowSeconds / 86400 })
      : t("settings.webSearch.usage.seconds", { count: w.windowSeconds });
    const amount = w.remaining === null ? t("settings.webSearch.usage.unlimited")
      : t("settings.webSearch.usage.requests", { remaining: formatNumber(w.remaining), limit: formatNumber(w.limit) });
    return `Brave ${period}: ${amount}`;
  });
  lines.push(asOf(usage.fetchedAt));
  return { remaining: main.remaining, detail: lines.join("\n") };
}

interface WebSearchQuotaProps {
  settings: WebSearchSettings;
  /** Re-check after each reply finishes. */
  isLoading: boolean;
}

/** Remaining Tavily / Brave searches, shown next to the Web search selector. */
export function WebSearchQuota({ settings, isLoading }: WebSearchQuotaProps) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [error, setError] = useState<string | null>(null);
  const lastFetch = useRef(0);
  const provider = settings.provider === "tavily" || settings.provider === "brave" ? settings.provider : null;
  const apiKey = (provider === "tavily" ? settings.tavilyApiKey : provider === "brave" ? settings.braveApiKey : "").trim();

  const wasLoading = useRef(isLoading);

  useEffect(() => subscribeWebSearchUsage(rerender), []);
  useEffect(() => subscribeSearchQuota(rerender), []);

  // Tavily has a free usage endpoint (no credits spent). Brave reports quota in the
  // headers of real searches, which the shared search code records automatically.
  useEffect(() => {
    const replyFinished = wasLoading.current && !isLoading;
    wasLoading.current = isLoading;
    if (provider !== "tavily" || !apiKey || isLoading) return;
    const cached = getTavilyUsage(apiKey);
    const lastCheckedAt = Math.max(cached?.fetchedAt ?? 0, lastFetch.current);
    if (!shouldRefreshTavily(replyFinished, lastCheckedAt, Date.now())) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      lastFetch.current = Date.now();
      fetchTavilyUsage(apiKey)
        .then(() => { if (!cancelled) setError(null); })
        .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    }, replyFinished ? REPLY_SETTLE_MS : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [provider, apiKey, isLoading]);

  if (!provider || !apiKey) return null;

  const tavily = provider === "tavily" ? getTavilyUsage(apiKey) : undefined;
  const brave = provider === "brave" ? getBraveUsage(apiKey) : undefined;
  let summary = tavily ? summarizeTavilyUsage(tavily) : brave ? summarizeBraveUsage(brave) : null;
  if (tavily && summary) {
    // Tavily's own count can lag; show the local estimate until it catches up.
    const shown = displayedTavilyRemaining(apiKey, summary.remaining);
    if (shown !== summary.remaining) {
      summary = { remaining: shown, detail: `${summary.detail}\n${t("input.webSearchQuotaEstimated")}` };
    }
  }

  let label: string;
  let title: string;
  if (summary) {
    label = summary.remaining === null ? "∞" : t("input.webSearchQuota", { remaining: formatNumber(summary.remaining) });
    title = summary.detail;
  } else if (error) {
    label = "?";
    title = t("settings.webSearch.usage.error", { error });
  } else {
    label = "…";
    title = provider === "brave" ? t("settings.webSearch.usage.braveNotFetched") : t("settings.webSearch.usage.loading");
  }

  const low = summary?.remaining != null && summary.remaining <= 20;
  return (
    <span className={`llm-hub-search-quota${low ? " llm-hub-search-quota-low" : ""}`} title={title} aria-label={title}>
      {label}
    </span>
  );
}
