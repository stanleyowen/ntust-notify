import { useTranslation } from "react-i18next";

const LANGS = [
  { code: "en", short: "EN" },
  { code: "zh-TW", short: "中" },
];

/** Two-option language toggle. Choice persists via i18next's detector. */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const active = i18n.resolvedLanguage;
  return (
    <div className="segmented segmented-sm" role="group" aria-label={t("language.label")}>
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          lang={l.code}
          className="segmented-btn"
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
