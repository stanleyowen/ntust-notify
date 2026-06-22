import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import zhTW from "./locales/zh-TW.json";

/**
 * Application i18n configuration.
 *
 * Languages: English ("en") and Traditional Chinese ("zh-TW").
 *
 * Language resolution order (handled by i18next-browser-languagedetector):
 * 1. A previously persisted choice in localStorage ("i18nextLng").
 * 2. The browser's preferred language (navigator.language).
 * Falls back to English when neither resolves to a supported language.
 *
 * Manual switches made via i18n.changeLanguage() are written back to
 * localStorage automatically, so the user's choice persists across visits.
 */
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      "zh-TW": { translation: zhTW },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "zh-TW"],
    // Map regional Chinese variants (zh, zh-HK, zh-Hant, …) onto zh-TW so
    // detection still picks Traditional Chinese for those users.
    load: "currentOnly",
    nonExplicitSupportedLngs: false,
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
      // Treat any zh* navigator language as Traditional Chinese.
      convertDetectedLanguage: (lng) =>
        lng && lng.toLowerCase().startsWith("zh") ? "zh-TW" : lng,
    },
    interpolation: {
      escapeValue: false, // React already escapes against XSS.
    },
  });

/**
 * Keep the document's <html lang> attribute in sync with the active language so
 * screen readers and the browser apply the correct language metadata.
 *
 * @param {string} lng - The newly active language code.
 * @returns {void}
 */
function syncHtmlLang(lng) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng;
  }
}

syncHtmlLang(i18n.resolvedLanguage);
i18n.on("languageChanged", syncHtmlLang);

export default i18n;
