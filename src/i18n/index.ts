// Registers this plugin's catalogues with the shared translation registry.
import { getLanguage } from "obsidian";
import { initLocale as initSharedLocale, registerTranslations, t as translate, type TranslationVars } from "obsidian-llm-hub-common/i18n";
import { en, type TranslationKey } from "./en";
import { ja } from "./ja";
import { es } from "./es";
import { fr } from "./fr";
import { zh } from "./zh";
import { zhTW } from "./zh-TW";
import { ko } from "./ko";
import { pt } from "./pt";
import { it } from "./it";
import { de } from "./de";

export type { TranslationKey };
export { getLocale, setLocale, getSupportedLocales } from "obsidian-llm-hub-common/i18n";

registerTranslations({ en, ja, es, fr, zh, ko, pt, it, de });

/** zh-TW / zh-HK / zh-Hant. The shared registry keys locales by language only. */
export function isTraditionalChineseLocale(locale: string): boolean {
  return /^zh[-_](tw|hk|mo|hant)\b/i.test(locale);
}

/**
 * The shared registry drops the region ("zh-TW" -> "zh"), which would show
 * Simplified Chinese. When Obsidian runs in Traditional Chinese, the Traditional
 * catalogue (shared + plugin strings) replaces the "zh" entries before the
 * locale is resolved.
 */
export function initLocale(): void {
  if (isTraditionalChineseLocale(getLanguage())) {
    registerTranslations({ zh: zhTW });
  }
  initSharedLocale();
}

/** Typed wrapper: plugin code may only use keys this plugin actually defines. */
export function t(key: TranslationKey, vars?: TranslationVars): string {
  return translate(key, vars);
}
