import { describe, expect, it } from "vitest";
import {
  createLocalWebTools,
  decodeEntities,
  htmlToText,
  isPublicHttpUrl,
  MAX_PAGE_CHARS,
  readWebPage,
  searchWikipedia,
  type WebRequest,
  type WebResponse,
} from "./localWebTools";

function fakeTransport(response: Partial<WebResponse>, seen: WebRequest[] = []) {
  return async (request: WebRequest): Promise<WebResponse> => {
    seen.push(request);
    return { status: 200, text: "", headers: {}, ...response };
  };
}

describe("isPublicHttpUrl", () => {
  it("accepts public http(s) URLs", () => {
    expect(isPublicHttpUrl("https://example.com/a?b=1")).toBe(true);
    expect(isPublicHttpUrl("http://zh.wikipedia.org/wiki/Obsidian")).toBe(true);
    expect(isPublicHttpUrl("https://8.8.8.8/")).toBe(true);
  });

  it("rejects local, private, and non-http targets", () => {
    for (const url of [
      "file:///C:/secret.txt", "ftp://example.com", "javascript:alert(1)", "not a url",
      "http://localhost:8000", "http://127.0.0.1:8000/v1", "http://10.0.0.5", "http://192.168.1.1",
      "http://172.20.0.1", "http://169.254.169.254/latest", "http://100.64.0.1", "http://0.0.0.0",
      "http://[::1]/", "http://[fd00::1]/", "http://[fe80::1]/", "http://[::ffff:127.0.0.1]/",
      "http://router.local", "http://nas", "https://user:pass@example.com",
    ]) {
      expect(isPublicHttpUrl(url), url).toBe(false);
    }
  });
});

describe("htmlToText", () => {
  it("keeps the title and main text, drops scripts, styles, and navigation", () => {
    const html = `<html><head><title>My &amp; Page</title><style>.a{}</style></head><body>
      <nav><a href="/">Home</a></nav>
      <script>alert("x")</script>
      <h1>Heading</h1><p>First&nbsp;paragraph &#x4E2D;&#25991;.</p>
      <ul><li>One</li><li>Two</li></ul>
      <footer>Footer links</footer></body></html>`;
    const { title, text } = htmlToText(html);
    expect(title).toBe("My & Page");
    expect(text).toContain("Heading");
    expect(text).toContain("First paragraph 中文.");
    expect(text).toContain("- One");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("Home");
    expect(text).not.toContain("Footer");
  });

  it("prefers <article> when it has real content", () => {
    const article = "Article body. ".repeat(30);
    const { text } = htmlToText(`<body><div>Sidebar junk</div><article><p>${article}</p></article></body>`);
    expect(text).toContain("Article body.");
    expect(text).not.toContain("Sidebar junk");
  });

  it("decodes entities", () => {
    expect(decodeEntities("&lt;b&gt; &quot;x&quot; &#39;y&#39; &unknown;")).toBe("<b> \"x\" 'y' &unknown;");
  });
});

describe("readWebPage", () => {
  it("returns the page text and title", async () => {
    const seen: WebRequest[] = [];
    const page = await readWebPage("https://example.com/post", fakeTransport({
      text: "<title>Post</title><p>Hello world</p>", headers: { "Content-Type": "text/html; charset=utf-8" },
    }, seen));
    expect(page).toMatchObject({ url: "https://example.com/post", title: "Post", content: "Hello world", truncated: false });
    expect(seen[0].method).toBe("GET");
  });

  it("truncates long pages", async () => {
    const page = await readWebPage("https://example.com", fakeTransport({ text: "a".repeat(MAX_PAGE_CHARS + 10), headers: { "content-type": "text/plain" } }));
    expect(page.truncated).toBe(true);
    expect(page.content.length).toBeLessThan(MAX_PAGE_CHARS + 20);
  });

  it("refuses local URLs without sending a request", async () => {
    const seen: WebRequest[] = [];
    await expect(readWebPage("http://127.0.0.1:8000/", fakeTransport({}, seen))).rejects.toThrow(/public/);
    expect(seen).toHaveLength(0);
  });

  it("reports HTTP errors and unsupported content", async () => {
    await expect(readWebPage("https://example.com", fakeTransport({ status: 404 }))).rejects.toThrow(/404/);
    await expect(readWebPage("https://example.com/a.pdf", fakeTransport({ text: "%PDF", headers: { "content-type": "application/pdf" } })))
      .rejects.toThrow(/Unsupported/);
  });
});

describe("searchWikipedia", () => {
  const payload = JSON.stringify({ query: { pages: [
    { title: "B", index: 2, extract: "Second", fullurl: "https://zh.wikipedia.org/wiki/B" },
    { title: "A", index: 1, extract: "First", fullurl: "https://zh.wikipedia.org/wiki/A" },
  ] } });

  it("orders results by relevance and passes the zh variant", async () => {
    const seen: WebRequest[] = [];
    const results = await searchWikipedia("台北", "zh", "zh-tw", fakeTransport({ text: payload }, seen));
    expect(results.map(r => r.title)).toEqual(["A", "B"]);
    const url = new URL(seen[0].url);
    expect(url.hostname).toBe("zh.wikipedia.org");
    expect(url.searchParams.get("gsrsearch")).toBe("台北");
    expect(url.searchParams.get("variant")).toBe("zh-tw");
  });

  it("does not send the zh variant to other languages", async () => {
    const seen: WebRequest[] = [];
    await searchWikipedia("Taipei", "en", "zh-tw", fakeTransport({ text: payload }, seen));
    expect(new URL(seen[0].url).searchParams.has("variant")).toBe(false);
  });

  it("rejects bad input", async () => {
    await expect(searchWikipedia("", "en", undefined, fakeTransport({}))).rejects.toThrow(/query/);
    await expect(searchWikipedia("x", "evil.com/", undefined, fakeTransport({}))).rejects.toThrow(/language/);
  });
});

describe("createLocalWebTools", () => {
  it("routes tool calls, records sources, and enforces the call limit", async () => {
    const tools = createLocalWebTools({
      defaultWikipediaLang: "zh",
      maxCalls: 2,
      transport: fakeTransport({ text: "<title>T</title><p>Body</p>", headers: { "content-type": "text/html" } }),
    });
    expect(tools.tools.map(tool => tool.name)).toEqual(["wikipedia_search", "read_web_page"]);
    expect(tools.handles("read_web_page")).toBe(true);
    expect(tools.handles("web_search")).toBe(false);

    expect(await tools.execute("read_web_page", { url: "https://example.com" })).toMatchObject({ title: "T", content: "Body" });
    expect(tools.used).toBe(true);
    expect(tools.sources).toEqual([{ title: "T", url: "https://example.com" }]);

    expect(await tools.execute("read_web_page", { url: "http://localhost" })).toMatchObject({ error: expect.stringMatching(/public/) });
    expect(await tools.execute("read_web_page", { url: "https://example.com" })).toMatchObject({ error: expect.stringMatching(/limit/) });
  });
});
