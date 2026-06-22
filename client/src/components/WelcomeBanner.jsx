import { useState } from "react";
import { useTranslation, Trans } from "react-i18next";

const STORAGE_KEY = "ntust-welcome-dismissed";

/**
 * Onboarding steps. Title and body text are resolved via i18n at render time;
 * bodies use <Trans> so embedded <strong>/<em> markup is preserved across
 * languages.
 *
 * @type {Array<{ icon: string, titleKey: string, bodyKey: string }>}
 */
const STEPS = [
  { icon: "🔍", titleKey: "welcome.step1Title", bodyKey: "welcome.step1Body" },
  { icon: "★", titleKey: "welcome.step2Title", bodyKey: "welcome.step2Body" },
  { icon: "🔔", titleKey: "welcome.step3Title", bodyKey: "welcome.step3Body" },
];

/**
 * Step-by-step onboarding wizard for first-time users.
 *
 * Shows one step at a time with animated slide transitions and dot progress
 * indicators. Dismissed permanently via localStorage.
 *
 * @returns {JSX.Element | null}
 */
function WelcomeBanner() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "1",
  );
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState("forward");

  if (dismissed) return null;

  function next() {
    if (step < STEPS.length - 1) {
      setDir("forward");
      setStep((s) => s + 1);
    } else {
      dismiss();
    }
  }

  function back() {
    if (step > 0) {
      setDir("backward");
      setStep((s) => s - 1);
    }
  }

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "1");
    setDismissed(true);
  }

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="welcome-wizard" role="region" aria-label={t("welcome.region")}>
      {/* ── Progress dots + skip ── */}
      <div className="wizard-header">
        <div
          className="wizard-dots"
          aria-label={t("welcome.stepProgress", {
            current: step + 1,
            total: STEPS.length,
          })}
        >
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`wizard-dot${i === step ? " wizard-dot-active" : i < step ? " wizard-dot-done" : ""}`}
            />
          ))}
        </div>
        <button
          className="wizard-skip-btn"
          onClick={dismiss}
          aria-label={t("welcome.skipTutorial")}
        >
          {t("welcome.skip")}
        </button>
      </div>

      {/* ── Step content — keyed so React remounts on change, triggering animation ── */}
      <div
        key={step}
        className={`wizard-step wizard-slide-${dir}`}
        aria-live="polite"
      >
        <div className="wizard-icon" aria-hidden="true">
          {current.icon}
        </div>
        <h3 className="wizard-title">{t(current.titleKey)}</h3>
        <p className="wizard-body">
          <Trans
            i18nKey={current.bodyKey}
            components={[<span key="0" />, <strong key="1" />, <span key="2" />, <strong key="3" />]}
          />
        </p>
      </div>

      {/* ── Navigation ── */}
      <div className="wizard-nav">
        <button
          className="btn btn-secondary btn-sm"
          onClick={back}
          style={{ visibility: step === 0 ? "hidden" : "visible" }}
        >
          {t("welcome.back")}
        </button>
        <span className="wizard-counter">
          {step + 1} / {STEPS.length}
        </span>
        <button className="btn btn-primary btn-sm" onClick={next}>
          {isLast ? t("welcome.getStarted") : t("welcome.next")}
        </button>
      </div>
    </div>
  );
}

export default WelcomeBanner;
