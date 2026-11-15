import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { BrandMark, Icon } from "./Icon";
import { LanguageSwitcher } from "./LanguageSwitcher";

/** Google "G" mark (brand colours required by Google's guidelines). */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.6 10.6 0 0 0 12 1 11 11 0 0 0 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  );
}

/** A static mock of the alert users will receive — shows the product, not a promise. */
function AlertPreview() {
  const { t } = useTranslation();
  return (
    <div className="preview" aria-hidden="true">
      <div className="preview-notif">
        <span className="preview-notif-icon">
          <Icon name="bell" size={16} filled />
        </span>
        <div>
          <p className="preview-notif-title">{t("login.previewTitle")}</p>
          <p className="preview-notif-body">CS3003301 · 離散數學</p>
        </div>
        <span className="preview-notif-time">{t("login.previewNow")}</span>
      </div>
      <div className="preview-card">
        <div className="preview-card-top">
          <span className="pill pill-open">
            <span className="pill-dot" />
            {t("course.open")}
          </span>
          <span className="switch switch-on switch-static">
            <span className="switch-knob" />
          </span>
        </div>
        <p className="preview-card-name">離散數學</p>
        <p className="preview-card-sub">CS3003301 · 項天瑞</p>
        <div className="seats seats-lg seats-low">
          <div className="seats-line">
            <span className="seats-head">{t("course.seatsLeft", { count: 1 })}</span>
            <span className="seats-sub">{t("course.enrolled", { enrolled: 79, limit: 80 })}</span>
          </div>
          <div className="meter">
            <span className="meter-fill" style={{ width: "98%" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Landing + sign-in screen for signed-out visitors. */
export function LoginPage() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (err) {
      const code = /** @type {{ code?: string }} */ (err)?.code ?? "";
      setError(code === "auth/network-request-failed" ? t("errors.network") : t("errors.signIn"));
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    { icon: "search", title: t("login.step1Title"), body: t("login.step1Body") },
    { icon: "star", title: t("login.step2Title"), body: t("login.step2Body") },
    { icon: "bell", title: t("login.step3Title"), body: t("login.step3Body") },
  ];

  return (
    <div className="landing">
      <header className="landing-bar container">
        <span className="brand">
          <BrandMark size={30} />
          <span className="brand-name">{t("common.appName")}</span>
        </span>
        <LanguageSwitcher />
      </header>

      <main className="container landing-main">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">{t("login.eyebrow")}</p>
            <h1 className="hero-title">{t("login.title")}</h1>
            <p className="hero-sub">{t("login.subtitle")}</p>
            <div className="hero-cta">
              <button type="button" className="btn btn-google" onClick={handleSignIn} disabled={busy}>
                {busy ? <span className="spinner spinner-sm" aria-hidden="true" /> : <GoogleMark />}
                {busy ? t("login.signingIn") : t("login.cta")}
              </button>
              {error && (
                <p className="form-error" role="alert">
                  <Icon name="alert" size={15} /> {error}
                </p>
              )}
              <p className="hero-privacy">
                <Icon name="shield" size={15} />
                {t("login.privacy")}
              </p>
            </div>
          </div>
          <AlertPreview />
        </section>

        <section className="how" aria-labelledby="how-title">
          <h2 id="how-title" className="section-title">
            {t("login.howTitle")}
          </h2>
          <ol className="how-steps">
            {steps.map((s, i) => (
              <li key={s.title} className="how-step">
                <span className="how-num" aria-hidden="true">
                  <Icon name={s.icon} size={18} />
                </span>
                <div>
                  <h3 className="how-title">
                    <span className="visually-hidden">{i + 1}. </span>
                    {s.title}
                  </h3>
                  <p className="how-body">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="landing-foot container">
        <p>{t("common.notAffiliated")}</p>
      </footer>
    </div>
  );
}
