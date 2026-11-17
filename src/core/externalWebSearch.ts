import type { WebSearchSettings } from "./webSearchMode";
import { createWebSearchSession, WEB_SEARCH_TOOL, type WebSearchTransport, type ExternalWebSearchOptions as SharedExternalWebSearchOptions } from "obsidian-llm-hub-common/core";
import { noteTavilySearch } from "./searchQuotaTracker";
import type { StreamChunk, ToolDefinition } from "src/types";
import { createProxyFetch } from "./proxyFetch";

export type ExternalWebSearchOptions = Omit<SharedExternalWebSearchOptions, "settings"> & { settings: WebSearchSettings };

export function createExternalSearchSession(options: ExternalWebSearchOptions, tools: ToolDefinition[],
  systemPrompt: string | undefined, execute?: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  proxyUrl?: string, proxyBypass?: string, signal?: AbortSignal) {
  const session = createWebSearchSession({ ...options,
    transport: createWebSearchTransport(proxyUrl, proxyBypass, signal) ?? options.transport,
  }, tools, systemPrompt, execute);
  if (options.settings.provider !== "tavily") return session;
  // Count each successful Tavily search locally so the quota badge drops right away.
  const apiKey = options.settings.tavilyApiKey;
  return {
    ...session,
    execute: async (name: string, args: Record<string, unknown>) => {
      const result = await session.execute(name, args);
      if (name === WEB_SEARCH_TOOL.name && isSuccessfulSearch(result)) noteTavilySearch(apiKey);
      return result;
    },
  };
}

function isSuccessfulSearch(result: unknown): boolean {
  return !!result && typeof result === "object" && !("error" in result) && "results" in result;
}

export function searchError(error: unknown): StreamChunk {
  return { type: "error", error: error instanceof Error ? error.message : "Web search failed." };
}

/** HTTP headers carry Brave's request quota; account usage uses this transport too. */
export function createWebSearchTransport(proxyUrl?: string, proxyBypass?: string, signal?: AbortSignal): WebSearchTransport | undefined {
  if (!proxyUrl) return undefined;
  const proxyFetch = createProxyFetch(proxyUrl, proxyBypass);
  return async request => {
    const response = await proxyFetch(request.url, { method: request.method, headers: request.headers, body: request.body, signal });
    const headers: Record<string, string> = {};
    response.headers?.forEach((value, key) => { headers[key] = value; });
    return { status: response.status, json: response.ok ? await response.json() : null, headers };
  };
}
