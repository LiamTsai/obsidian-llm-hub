import { describe, expect, it } from "vitest";
import { en as sharedEn } from "../../node_modules/obsidian-llm-hub-common/dist/i18n/catalogues/en.js";
import { en } from "./en";
import { zhTW } from "./zh-TW";
import { isTraditionalChineseLocale } from "./index";

const placeholders = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join(",");

describe("zh-TW catalogue", () => {
  const source: Record<string, string> = { ...sharedEn, ...en };

  it("covers every English key", () => {
    const missing = Object.keys(source).filter(key => !zhTW[key]);
    expect(missing).toEqual([]);
  });

  it("keeps every {{placeholder}}", () => {
    const mismatched = Object.keys(source).filter(key => placeholders(source[key]) !== placeholders(zhTW[key] ?? ""));
    expect(mismatched).toEqual([]);
  });
});

describe("isTraditionalChineseLocale", () => {
  it("matches Traditional Chinese locales only", () => {
    expect(isTraditionalChineseLocale("zh-TW")).toBe(true);
    expect(isTraditionalChineseLocale("zh-hk")).toBe(true);
    expect(isTraditionalChineseLocale("zh-Hant")).toBe(true);
    expect(isTraditionalChineseLocale("zh")).toBe(false);
    expect(isTraditionalChineseLocale("zh-CN")).toBe(false);
    expect(isTraditionalChineseLocale("en")).toBe(false);
  });
});
