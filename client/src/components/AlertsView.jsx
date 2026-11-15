import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useAccount } from "../context/AccountContext";
import { useToast } from "../context/ToastContext";
import { api, errorMessage, ApiError } from "../lib/api";
import { formatInterval } from "../lib/course";
import { ConfirmDialog } from "./ConfirmDialog";
import { Diagnostics } from "./Diagnostics";
import { Icon } from "./Icon";

const WEBHOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{15,22}\/[\w-]{20,120}\/?(?:\?thread_id=\d{15,22})?$/;
const DISCORD_ID_RE = /^\d{15,22}$/;

/**
 * Client-side mirror of the server's validation, for instant feedback.
 *
 * @param {import("../context/AccountContext").Prefs} f
 * @returns {Record<string, string>}
 */
function validate(f) {
  /** @type {Record<string, string>} */
  const errs = {};
  const hook = f.discordWebhook.trim();
  if (f.discord && !hook) errs.discordWebhook = "webhook_required";
  else if (hook && !WEBHOOK_RE.test(hook)) errs.discordWebhook = "invalid_webhook";
  const id = f.discordUserId.trim();
  if (f.discord && f.discordTagMe && !id) errs.discordUserId = "discord_user_id_required";
  else if (id && !DISCORD_ID_RE.test(id)) errs.discordUserId = "invalid_discord_user_id";
  return errs;
}

/** @param {{ checked: boolean, onChange: (v: boolean) => void, labelledBy: string, describedBy?: string, disabled?: boolean }} props */
function Switch({ checked, onChange, labelledBy, describedBy, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={`switch ${checked ? "switch-on" : ""}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="switch-knob" />
    </button>
  );
}

export function AlertsView() {
  const { t } = useTranslation();
  const toast = useToast();
  const { prefs, savePrefs, limits, profile, emailAvailable, courses, deleteAccount } = useAccount();
  const id = useId();

  const [form, setForm] = useState(prefs);
  const [touched, setTouched] = useState(/** @type {Record<string, boolean>} */ ({}));
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState(/** @type {string | null} */ (null));
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(/** @type {null | Record<string, { status: string, code?: string }>} */ (null));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Adopt server state when it changes and the user has no local edits.
  useEffect(() => {
    setForm((f) => (f === null || JSON.stringify(f) === JSON.stringify(prefs) ? prefs : f));
  }, [prefs]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(prefs), [form, prefs]);
  const errors = useMemo(() => (form ? validate(form) : {}), [form]);
  const hasErrors = Object.keys(errors).length > 0;

  if (!form) return null;

  /** @param {keyof typeof form} key @param {any} value */
  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setServerError(null);
    setTestResult(null);
  };

  async function onSave(e) {
    e?.preventDefault();
    setTouched({ discordWebhook: true, discordUserId: true });
    if (hasErrors) return;
    setSaving(true);
    setServerError(null);
    try {
      const saved = await savePrefs({ ...form, discordWebhook: form.discordWebhook.trim(), discordUserId: form.discordUserId.trim() });
      setForm(saved);
      setTouched({});
      toast(t("toast.saved"), { tone: "success" });
    } catch (err) {
      setServerError(errorMessage(err, t));
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const { results } = await api("/api/notify/test", { method: "POST" });
      setTestResult(results);
    } catch (err) {
      toast(errorMessage(err, t), { tone: "error" });
    } finally {
      setTesting(false);
    }
  }

  async function onDelete() {
    setDeleting(true);
    try {
      await deleteAccount();
    } catch (err) {
      setDeleting(false);
      setConfirmDelete(false);
      toast(errorMessage(err, t), { tone: "error" });
    }
  }

  // Errors appear after the user leaves the field (or tries to save), not mid-typing.
  const fieldError = (key) => (touched[key] && errors[key] ? t(`errors.${errors[key]}`) : null);
  const hookErr = fieldError("discordWebhook");
  const idErr = fieldError("discordUserId");
  const savedHasChannel = prefs.email || prefs.discord;
  const alertsOn = courses.filter((c) => c.alerts.on).length;

  return (
    <div className="view view-narrow">
      <header className="view-head">
        <h1 className="view-title">{t("alerts.title")}</h1>
        <p className="view-sub">{t("alerts.subtitle", { count: alertsOn })}</p>
      </header>

      <form onSubmit={onSave} noValidate>
        {/* ── Channels ─────────────────────────────────────────── */}
        <section className="card section" aria-labelledby={`${id}-channels`}>
          <h2 className="section-title" id={`${id}-channels`}>
            {t("alerts.channelsTitle")}
          </h2>

          <div className="setting">
            <span className="setting-icon">
              <Icon name="mail" size={18} />
            </span>
            <div className="setting-text">
              <span className="setting-title" id={`${id}-email`}>
                {t("alerts.emailTitle")}
              </span>
              <span className="setting-desc" id={`${id}-email-desc`}>
                {emailAvailable ? (
                  <Trans i18nKey="alerts.emailBody" values={{ email: profile?.email ?? "" }} components={{ b: <strong /> }} />
                ) : (
                  t("alerts.emailUnavailable")
                )}
              </span>
            </div>
            <Switch
              checked={form.email}
              onChange={(v) => set("email", v)}
              labelledBy={`${id}-email`}
              describedBy={`${id}-email-desc`}
              disabled={!emailAvailable && !form.email}
            />
          </div>

          <div className="setting">
            <span className="setting-icon setting-icon-discord">
              <Icon name="discord" size={18} />
            </span>
            <div className="setting-text">
              <span className="setting-title" id={`${id}-discord`}>
                {t("alerts.discordTitle")}
              </span>
              <span className="setting-desc">{t("alerts.discordBody")}</span>
            </div>
            <Switch checked={form.discord} onChange={(v) => set("discord", v)} labelledBy={`${id}-discord`} />
          </div>

          {form.discord && (
            <div className="setting-sub">
              <div className="field">
                <label className="field-label" htmlFor={`${id}-hook`}>
                  {t("alerts.webhookLabel")}
                </label>
                <input
                  id={`${id}-hook`}
                  className="input mono"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={300}
                  placeholder="https://discord.com/api/webhooks/…"
                  value={form.discordWebhook}
                  onChange={(e) => set("discordWebhook", e.target.value)}
                  onBlur={() => setTouched((x) => ({ ...x, discordWebhook: true }))}
                  aria-invalid={Boolean(hookErr) || undefined}
                  aria-describedby={`${id}-hook-hint`}
                />
                <span className={`field-hint ${hookErr ? "field-hint-error" : ""}`} id={`${id}-hook-hint`}>
                  {hookErr ?? t("alerts.webhookHint")}
                </span>
              </div>

              <label className="check">
                <input type="checkbox" checked={form.discordTagMe} onChange={(e) => set("discordTagMe", e.target.checked)} />
                <span>{t("alerts.tagMe")}</span>
              </label>

              {form.discordTagMe && (
                <div className="field">
                  <label className="field-label" htmlFor={`${id}-uid`}>
                    {t("alerts.userIdLabel")}
                  </label>
                  <input
                    id={`${id}-uid`}
                    className="input mono"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={22}
                    placeholder="123456789012345678"
                    value={form.discordUserId}
                    onChange={(e) => set("discordUserId", e.target.value)}
                    onBlur={() => setTouched((x) => ({ ...x, discordUserId: true }))}
                    aria-invalid={Boolean(idErr) || undefined}
                    aria-describedby={`${id}-uid-hint`}
                  />
                  <span className={`field-hint ${idErr ? "field-hint-error" : ""}`} id={`${id}-uid-hint`}>
                    {idErr ?? t("alerts.userIdHint")}
                  </span>
                </div>
              )}

              <details className="disclosure">
                <summary>{t("alerts.helpSummary")}</summary>
                <ol className="steps-list">
                  <li>{t("alerts.help1")}</li>
                  <li>
                    <Trans i18nKey="alerts.help2" components={{ b: <strong /> }} />
                  </li>
                  <li>
                    <Trans i18nKey="alerts.help3" components={{ b: <strong /> }} />
                  </li>
                  <li>{t("alerts.help4")}</li>
                </ol>
              </details>
            </div>
          )}

          {!form.email && !form.discord && (
            <p className="notice notice-warn">
              <Icon name="alert" size={16} />
              <span>{t("alerts.noChannel")}</span>
            </p>
          )}
        </section>

        {/* ── Frequency ────────────────────────────────────────── */}
        <section className="card section" aria-labelledby={`${id}-freq`}>
          <h2 className="section-title" id={`${id}-freq`}>
            {t("alerts.frequencyTitle")}
          </h2>
          <p className="section-desc">{t("alerts.frequencyBody")}</p>
          <div className="radio-pills" role="radiogroup" aria-labelledby={`${id}-freq`}>
            {limits.pollOptions.map((ms) => (
              <label key={ms} className="radio-pill">
                <input type="radio" name="pollInterval" value={ms} checked={form.pollInterval === ms} onChange={() => set("pollInterval", ms)} />
                <span>{formatInterval(ms, t)}</span>
              </label>
            ))}
          </div>
          {limits.privileged && <p className="section-desc muted">{t("alerts.privileged")}</p>}
        </section>

        {/* ── Save bar ─────────────────────────────────────────── */}
        <div className={`savebar ${dirty || serverError ? "is-visible" : ""}`} aria-hidden={!(dirty || serverError)}>
          <div className="savebar-inner">
            <span className="savebar-msg" role={serverError ? "alert" : undefined}>
              {serverError ? (
                <>
                  <Icon name="alert" size={16} /> {serverError}
                </>
              ) : (
                t("alerts.unsaved")
              )}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setForm(prefs); setServerError(null); setTouched({}); }} disabled={saving} tabIndex={dirty ? 0 : -1}>
              {t("alerts.discard")}
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !dirty} tabIndex={dirty ? 0 : -1}>
              {saving && <span className="spinner spinner-sm" aria-hidden="true" />}
              {saving ? t("alerts.saving") : t("alerts.save")}
            </button>
          </div>
        </div>
      </form>

      {/* ── Test ───────────────────────────────────────────────── */}
      <section className="card section" aria-labelledby={`${id}-test`}>
        <div className="section-row">
          <div>
            <h2 className="section-title" id={`${id}-test`}>
              {t("alerts.testTitle")}
            </h2>
            <p className="section-desc">
              {!savedHasChannel ? t("alerts.testNoChannel") : dirty ? t("alerts.testSaveFirst") : t("alerts.testBody")}
            </p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onTest} disabled={testing || dirty || !savedHasChannel}>
            {testing ? <span className="spinner spinner-sm" aria-hidden="true" /> : <Icon name="send" size={15} />}
            {testing ? t("alerts.testing") : t("alerts.testButton")}
          </button>
        </div>
        {testResult && (
          <ul className="test-results" aria-live="polite">
            {[
              ["email", "mail"],
              ["discord", "discord"],
            ]
              .filter(([k]) => testResult[k]?.status !== "off")
              .map(([k, icon]) => {
                const r = testResult[k];
                return (
                  <li key={k} className={`test-result test-${r.status}`}>
                    <Icon name={icon} size={16} />
                    <span className="test-channel">{t(`alerts.channel.${k}`)}</span>
                    <span className="test-status">
                      <Icon name={r.status === "sent" ? "check" : "alert"} size={14} />
                      {r.status === "sent" ? t("alerts.testSent") : errorMessage(new ApiError(0, r.code ?? "delivery_failed"), t)}
                    </span>
                  </li>
                );
              })}
          </ul>
        )}
      </section>

      <Diagnostics />

      {/* ── Danger zone ───────────────────────────────────────── */}
      <section className="card section section-danger" aria-labelledby={`${id}-danger`}>
        <div className="section-row">
          <div>
            <h2 className="section-title" id={`${id}-danger`}>
              {t("alerts.dangerTitle")}
            </h2>
            <p className="section-desc">{t("alerts.dangerBody")}</p>
          </div>
          <button type="button" className="btn btn-danger-ghost" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={15} />
            {t("alerts.deleteButton")}
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmDelete}
        danger
        busy={deleting}
        title={t("alerts.deleteTitle")}
        body={<p>{t("alerts.deleteBody", { email: profile?.email ?? "" })}</p>}
        confirmLabel={deleting ? t("alerts.deleting") : t("alerts.deleteConfirm")}
        onConfirm={onDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
