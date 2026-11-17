// Local bookkeeping for Tavily searches. Tavily's usage endpoint can lag behind
// real searches, so each search this plugin makes lowers a local estimate right
// away; the official number replaces it once it catches up (or drops lower because
// the key was also used elsewhere). In memory only: nothing is saved.
import { getTavilyUsage, type TavilyUsage } from "obsidian-llm-hub-common/core";

/** After this long, trust Tavily's number again (covers lag; never outlives a quota reset). */
export const ESTIMATE_TTL_MS = 10 * 60_000;

const estimates = new Map<string, { remaining: number; at: number }>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    try { listener(); } catch { /* a display listener must never fail a search */ }
  }
}

export function subscribeSearchQuota(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Remaining Tavily credits: the tighter of the plan and per-key limits; null = unlimited. */
export function tavilyRemaining(usage: TavilyUsage): number | null {
  const limits = [usage.plan, usage.key].filter((a): a is NonNullable<typeof a> => !!a && a.remaining !== null);
  return limits.length > 0 ? Math.min(...limits.map(a => a.remaining as number)) : null;
}

/** Record one successful Tavily search (a basic search costs one credit). */
function currentEstimate(key: string, now: number): number | undefined {
  const entry = estimates.get(key);
  if (!entry) return undefined;
  if (now - entry.at > ESTIMATE_TTL_MS) {
    estimates.delete(key);
    return undefined;
  }
  return entry.remaining;
}

export function noteTavilySearch(apiKey: string, now = Date.now()): void {
  const key = apiKey.trim();
  if (!key) return;
  const usage = getTavilyUsage(key);
  const base = currentEstimate(key, now) ?? (usage ? tavilyRemaining(usage) : null);
  if (base === null) return; // unknown or unlimited: nothing to count down
  estimates.set(key, { remaining: Math.max(0, base - 1), at: now });
  notify();
}

/**
 * What to show: the official number once it has caught up with (or gone below)
 * the local estimate, otherwise the estimate.
 */
export function displayedTavilyRemaining(apiKey: string, official: number | null, now = Date.now()): number | null {
  const key = apiKey.trim();
  const estimate = currentEstimate(key, now);
  if (estimate === undefined || official === null) return official;
  if (official <= estimate) {
    estimates.delete(key);
    return official;
  }
  return estimate;
}

/** Test helper. */
export function resetSearchQuotaEstimates(): void {
  estimates.clear();
}
