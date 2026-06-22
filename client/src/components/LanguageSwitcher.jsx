import { useTranslation } from "react-i18next";

/**
 * Languages selectable in the UI. The order here is the order shown in the
 * toggle. Keep these keys in sync with `supportedLngs` in i18n.js.
 *
 * @type {Array<{ code: string, short: string }>}
 */
const LANGS = [
  { code: "en", short: "EN" },
  { code: "zh-TW", short: "中" },
];

/**
 * Compact language toggle shown in the app header.
 *
 * Switching language calls i18n.changeLanguage(), which both re-renders the
 * tree and persists the choice to localStorage (handled by the language
 * detector configured in i18n.js).
 *
 * @returns {JSX.Element}
 */
function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const active = i18n.resolvedLanguage;

  return (
    <div className="lang-switcher" role="group" aria-label={t("language.label")}>
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          className={`lang-btn ${active === l.code ? "lang-btn-active" : ""}`}
          aria-pressed={active === l.code}
          title={t(`language.${l.code}`)}
          onClick={() => i18n.changeLanguage(l.code)}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}

export default LanguageSwitcher;
