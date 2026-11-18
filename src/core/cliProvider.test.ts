import { describe, expect, it } from "vitest";
import { buildClaudePersistentArgs, buildClaudeVaultMcpConfig, buildCodexExecInvocation, parseCodexModelsCatalog, PersistentCliSession } from "./cliProvider";
import type { Message } from "../types";

describe("buildCodexExecInvocation", () => {
  it("passes initial prompts through stdin instead of argv", () => {
    const longPrompt = "x".repeat(200_000);
    const invocation = buildCodexExecInvocation(
      [{ role: "user", content: longPrompt } as Message],
      "system prompt",
    );

    expect(invocation.args).toEqual(["exec", "--json", "--skip-git-repo-check", "--config", 'model_reasoning_effort="low"', "-"]);
    expect(invocation.args.join(" ")).not.toContain(longPrompt);
    expect(invocation.stdin).toContain(longPrompt);
    expect(invocation.stdin).toContain("system prompt");
  });

  it("passes resumed prompts through stdin instead of argv", () => {
    const longPrompt = "y".repeat(200_000);
    const invocation = buildCodexExecInvocation(
      [{ role: "user", content: longPrompt } as Message],
      "ignored on resume",
      "session-123",
    );

    expect(invocation.args).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--config",
      'model_reasoning_effort="low"',
      "resume",
      "session-123",
      "-",
    ]);
    expect(invocation.args.join(" ")).not.toContain(longPrompt);
    expect(invocation.stdin).toBe(longPrompt);
  });

  it("adds a configured model to initial and resumed invocations", () => {
    const messages = [{ role: "user", content: "hello" } as Message];

    expect(buildCodexExecInvocation(messages, "system", undefined, " gpt-5.3-codex ").args)
      .toEqual(["exec", "--json", "--skip-git-repo-check", "--model", "gpt-5.3-codex", "--config", 'model_reasoning_effort="low"', "-"]);
    expect(buildCodexExecInvocation(messages, "system", "session-123", "gpt-5.3-codex").args)
      .toEqual(["exec", "--json", "--skip-git-repo-check", "--model", "gpt-5.3-codex", "--config", 'model_reasoning_effort="low"', "resume", "session-123", "-"]);
  });

  it("adds the confirmation bridge and read-only sandbox when configured", () => {
    const messages = [{ role: "user", content: "edit Note.md" } as Message];
    const url = "http://127.0.0.1:4321/mcp?token=secret";
    const invocation = buildCodexExecInvocation(messages, "system", undefined, undefined, url);

    expect(invocation.args).toEqual([
      "exec", "--json", "--skip-git-repo-check",
      "--config", 'model_reasoning_effort="low"',
      "--sandbox", "read-only",
      "--config", 'approval_policy="never"',
      "--config", `mcp_servers.llm_hub_vault.url=${JSON.stringify(url)}`,
      "-",
    ]);
  });

  it("overrides the Codex reasoning effort for initial and resumed invocations", () => {
    const messages = [{ role: "user", content: "hello" } as Message];

    expect(buildCodexExecInvocation(messages, "system", undefined, undefined, undefined, "high").args)
      .toContain('model_reasoning_effort="high"');
    expect(buildCodexExecInvocation(messages, "system", "session-123", undefined, undefined, "xhigh").args)
      .toContain('model_reasoning_effort="xhigh"');
  });

  it("parses visible models from the Codex model catalog", () => {
    const catalog = JSON.stringify({ models: [
      { slug: "gpt-visible", display_name: "GPT Visible", visibility: "list" },
      { slug: "gpt-hidden", display_name: "GPT Hidden", visibility: "hide" },
      { slug: "gpt-fallback", visibility: "list" },
    ] });

    expect(parseCodexModelsCatalog(catalog)).toEqual([
      { slug: "gpt-visible", displayName: "GPT Visible" },
      { slug: "gpt-fallback", displayName: "gpt-fallback" },
    ]);
  });

});

describe("CLI web search and Vault bridge", () => {
  const messages = [{ role: "user", content: "hi" } as Message];

  it("turns on Codex web search only when requested", () => {
    const on = buildCodexExecInvocation(messages, "system", undefined, undefined, undefined, "low", true).args;
    expect(on).toContain('web_search="live"');
    expect(on.indexOf('web_search="live"')).toBeLessThan(on.indexOf("-"));
    const resumed = buildCodexExecInvocation(messages, "system", "session-1", undefined, undefined, "low", true).args;
    expect(resumed.indexOf('web_search="live"')).toBeLessThan(resumed.indexOf("resume"));
    expect(buildCodexExecInvocation(messages, "system").args.join(" ")).not.toContain("web_search");
  });

  it("allows Claude's web tools when search is on and denies them when off", () => {
    const on = buildClaudePersistentArgs({ webSearch: true });
    expect(on[on.indexOf("--allowedTools") + 1]).toBe("WebSearch,WebFetch");
    expect(on).not.toContain("--mcp-config");
    const off = buildClaudePersistentArgs({ webSearch: false });
    expect(off[off.indexOf("--disallowedTools") + 1]).toBe("WebSearch,WebFetch");
    expect(off).not.toContain("--allowedTools");
  });

  it("connects Claude to the Vault bridge and blocks its own file-writing tools", () => {
    const args = buildClaudePersistentArgs({ systemPrompt: "sys", sessionId: "s-1", webSearch: true, mcpConfigPath: "/tmp/mcp.json" });
    expect(args.slice(0, 6)).toEqual(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]);
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("sys");
    expect(args[args.indexOf("--resume") + 1]).toBe("s-1");
    expect(args[args.indexOf("--mcp-config") + 1]).toBe("/tmp/mcp.json");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("WebSearch,WebFetch,mcp__llm_hub_vault");
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe("Edit,Write,MultiEdit,NotebookEdit");
  });

  it("writes an HTTP MCP config for the bridge", () => {
    expect(JSON.parse(buildClaudeVaultMcpConfig("http://127.0.0.1:1234/mcp?token=t"))).toEqual({
      mcpServers: { llm_hub_vault: { type: "http", url: "http://127.0.0.1:1234/mcp?token=t" } },
    });
  });

  it("changes the session options key when web search or the bridge changes", () => {
    const base = PersistentCliSession.optionsKey("http://a", { webSearch: false });
    expect(PersistentCliSession.optionsKey("http://a", { webSearch: false })).toBe(base);
    expect(PersistentCliSession.optionsKey("http://a", { webSearch: true })).not.toBe(base);
    expect(PersistentCliSession.optionsKey(undefined, { webSearch: false })).not.toBe(base);
  });
});
