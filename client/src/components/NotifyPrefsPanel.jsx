import { useState, useEffect } from "react";
import { useTranslation, Trans } from "react-i18next";
import { auth } from "../firebase";

/**
 * Base URL for backend API requests.
 *
 * @type {string}
 */
const API_BASE = import.meta.env.VITE_API_URL ?? "";

/**
 * Inline notification preferences panel rendered inside the Notifications tab.
 *
 * This component allows the user to:
 * - enable or disable email notifications,
 * - configure Discord webhook notifications,
 * - choose a server-side polling interval,
 * - send a test notification,
 * - inspect poller diagnostics returned by the backend.
 *
 * @param {{
 *   prefs: {
 *     email?: boolean,
 *     discord?: boolean,
 *     discordWebhook?: string,
 *     discordTagMe?: boolean,
 *     discordUserId?: string,
 *     pollInterval?: number,
 *   },
 *   onSave: (prefs: Record<string, any>) => Promise<void>,
 * }} props - Component props.
 * @returns {JSX.Element}
 */
function NotifyPrefsPanel({ prefs, onSave, watchedCount = 0, notifyEnabledCount = 0 }) {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState({ ...prefs });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // null | { discord, email }
  const [status, setStatus] = useState(null); // null | API response
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState(null);
  const [pollOptions, setPollOptions] = useState([
    { labelKey: "notify.poll30s", value: 30_000 },
    { labelKey: "notify.poll1m", value: 60_000 },
    { labelKey: "notify.poll3m", value: 180_000 },
    { labelKey: "notify.poll5m", value: 300_000 },
    { labelKey: "notify.poll10m", value: 600_000 },
  ]);

  /**
   * Fetches the poll interval options allowed for the currently authenticated
   * user.
   *
   * The backend may return a faster set of options for privileged users.
   * Using onAuthStateChanged ensures the component waits until Firebase has
   * restored the session and a valid ID token can be requested.
   *
   * @returns {() => void}
   */
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${API_BASE}/api/poll-options`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.options)) setPollOptions(data.options);
      } catch {
        // Keep the default options if the fetch fails.
      }
    });
    return () => unsubscribe();
  }, []);

  /**
   * Resets the local editable form whenever upstream preferences change.
   *
   * This is especially useful on first load when preferences arrive
   * asynchronously from Firestore.
   *
   * @returns {void}
   */
  useEffect(() => {
    setForm({ ...prefs });
  }, [prefs]);

  /**
   * Updates a single form field in local component state.
   *
   * @param {string} field - Preference field name.
   * @param {any} value - New field value.
   * @returns {void}
   */
  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  }

  /**
   * Persists the current notification settings through the parent save handler.
   *
   * @returns {Promise<void>}
   */
  async function handleSave() {
    setSaving(true);
    await onSave(form);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  /**
   * Sends a test notification through the backend using the user's currently
   * saved server-side notification settings.
   *
   * @returns {Promise<void>}
   */
  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error(t("errors.notLoggedIn"));
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/notify/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setTestResult(data.results ?? { error: data.error ?? t("errors.unknown") });
    } catch (err) {
      setTestResult({ error: err.message });
    } finally {
      setTesting(false);
    }
  }

  /**
   * Fetches backend poller diagnostics for the current user's watched courses.
   *
   * @returns {Promise<void>}
   */
  async function handleRefreshStatus() {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error(t("errors.notLoggedIn"));
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/notify/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(t("errors.http", { status: res.status }));
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      setStatusError(err.message);
    } finally {
      setStatusLoading(false);
    }
  }

  /**
   * Whether at least one notification delivery channel is currently enabled.
   */
  const hasChannel = form.email || form.discord;

  const setupSteps = [
    {
      done: watchedCount > 0,
      label: t("notify.step1Label"),
      hint: t("notify.step1Hint"),
    },
    {
      done: hasChannel,
      label: t("notify.step2Label"),
      hint: t("notify.step2Hint"),
    },
    {
      done: notifyEnabledCount > 0,
      label: t("notify.step3Label"),
      hint: t("notify.step3Hint"),
    },
  ];
  const allSetupDone = setupSteps.every((s) => s.done);

  return (
    <div className="notify-prefs-panel">
      <div className="notify-prefs-panel-header">
        <h2 className="notify-prefs-panel-title">{t("notify.title")}</h2>
        <p className="notify-prefs-panel-subtitle">{t("notify.subtitlePanel")}</p>
      </div>

      <div className="notify-prefs-panel-body">
        {/* ── Setup checklist ── */}
        {!allSetupDone && (
          <div className="setup-checklist" role="list" aria-label={t("notify.checklistAria")}>
            <p className="setup-checklist-title">{t("notify.checklistTitle")}</p>
            {setupSteps.map((step, i) => (
              <div
                key={i}
                className={`setup-step${step.done ? " setup-step-done" : ""}`}
                role="listitem"
              >
                <span className="setup-step-check" aria-hidden="true">
                  {step.done ? "✓" : i + 1}
                </span>
                <div>
                  <span className="setup-step-label">{step.label}</span>
                  {!step.done && (
                    <span className="setup-step-hint">{step.hint}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {/* ── Email ── */}
        <label className="notify-row">
          <div className="notify-row-left">
            <input
              type="checkbox"
              checked={form.email}
              onChange={(e) => set("email", e.target.checked)}
            />
            <div>
              <span className="notify-label">{t("notify.emailLabel")}</span>
              <span className="notify-desc">{t("notify.emailDesc")}</span>
            </div>
          </div>
        </label>

        {/* ── Discord ── */}
        <label className="notify-row">
          <div className="notify-row-left">
            <input
              type="checkbox"
              checked={form.discord}
              onChange={(e) => set("discord", e.target.checked)}
            />
            <div>
              <span className="notify-label">
                <svg className="discord-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                </svg>
                {t("notify.discordLabel")}
              </span>
              <span className="notify-desc">{t("notify.discordDesc")}</span>
            </div>
          </div>
        </label>

        {/* Discord sub-fields */}
        {form.discord && (
          <div className="notify-sub">
            <div className="form-group">
              <label htmlFor="discordWebhook">{t("notify.webhookUrl")}</label>
              <input
                id="discordWebhook"
                type="url"
                value={form.discordWebhook}
                onChange={(e) => set("discordWebhook", e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                spellCheck={false}
              />
            </div>

            <label className="notify-row notify-row-compact">
              <div className="notify-row-left">
                <input
                  type="checkbox"
                  checked={form.discordTagMe}
                  onChange={(e) => set("discordTagMe", e.target.checked)}
                />
                <div>
                  <span className="notify-label">{t("notify.tagMe")}</span>
                </div>
              </div>
            </label>

            {form.discordTagMe && (
              <div className="form-group">
                <label htmlFor="discordUserId">{t("notify.discordUserId")}</label>
                <input
                  id="discordUserId"
                  type="text"
                  value={form.discordUserId}
                  onChange={(e) => set("discordUserId", e.target.value)}
                  placeholder={t("notify.discordUserIdPlaceholder")}
                />
                <span className="field-hint">{t("notify.discordUserIdHint")}</span>
              </div>
            )}

            <details className="help-details">
              <summary className="help-summary">{t("notify.helpSummary")}</summary>
              <ol className="help-steps">
                <li>{t("notify.helpStep1")}</li>
                <li>
                  <Trans i18nKey="notify.helpStep2" components={[<span key="0" />, <em key="1" />]} />
                </li>
                <li>
                  <Trans i18nKey="notify.helpStep3" components={[<span key="0" />, <strong key="1" />]} />
                </li>
                <li>
                  <Trans i18nKey="notify.helpStep4" components={[<span key="0" />, <strong key="1" />]} />
                </li>
                <li>{t("notify.helpStep5")}</li>
              </ol>
            </details>
          </div>
        )}

        {!hasChannel && (
          <p className="notify-info">{t("notify.selectChannel")}</p>
        )}

        {/* ── Poll interval ── */}
        <div className="form-group notify-interval-group">
          <label htmlFor="pollInterval">{t("notify.checkInterval")}</label>
          <select
            id="pollInterval"
            value={form.pollInterval ?? 60_000}
            onChange={(e) => set("pollInterval", Number(e.target.value))}
          >
            {pollOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.labelKey ? t(o.labelKey) : o.label}
              </option>
            ))}
          </select>
          <span className="field-hint">{t("notify.intervalHint")}</span>
        </div>

        {/* ── Poller diagnostics ── */}
        <div className="notify-diagnostics">
          <div className="notify-diagnostics-header">
            <span className="notify-label">{t("notify.diagnostics")}</span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleRefreshStatus}
              disabled={statusLoading}
            >
              {statusLoading ? t("notify.loading") : t("notify.refreshStatus")}
            </button>
          </div>
          {statusError && (
            <p className="notify-info" style={{ color: "#ef4444" }}>✗ {statusError}</p>
          )}
          {status && !statusError && (
            <>
              {/* Global poller health */}
              <div className="notify-course-stat">
                <ul className="notify-course-stat-list" style={{ paddingLeft: 0, listStyle: "none" }}>
                  <li>
                    {t("notify.pollerReady")}{" "}
                    <strong>{status.pollerReady ? t("notify.yes") : t("notify.seeding")}</strong>
                  </li>
                  {status.hasAnyNotify != null && (
                    <li>
                      {t("notify.channels")}{" "}
                      <strong>{status.hasAnyNotify ? t("notify.configured") : t("notify.noneEnabled")}</strong>
                      {!status.hasAnyNotify && <span style={{ color: "#f59e0b" }}>{t("notify.enableHint")}</span>}
                    </li>
                  )}
                  {status.requestedIntervalMs != null && status.effectiveIntervalMs != null && (
                    <li>
                      <Trans
                        i18nKey="notify.pollIntervalLine"
                        values={{
                          requested: (status.requestedIntervalMs / 1000).toFixed(0),
                          effective: (status.effectiveIntervalMs / 1000).toFixed(0),
                        }}
                        components={[<span key="0" />, <strong key="1" />, <span key="2" />, <strong key="3" />]}
                      />
                      {status.requestedIntervalMs !== status.effectiveIntervalMs && (
                        <span style={{ color: "#f59e0b" }}>{t("notify.capped")}</span>
                      )}
                    </li>
                  )}
                  {status.lastPolled && (
                    <li>
                      <Trans
                        i18nKey="notify.lastPolled"
                        values={{ time: new Date(status.lastPolled).toLocaleTimeString(i18n.language) }}
                        components={[<span key="0" />, <strong key="1" />]}
                      />
                    </li>
                  )}
                </ul>
              </div>
              {status.watching.map((w) => {
                const n = w.ntust;
                const skipped = w.skipReasons && w.skipReasons.length > 0;
                const healthy = n && n.consecutiveFailures === 0 && n.lastSuccessAt;
                const failing = n && n.consecutiveFailures > 0;
                return (
                  <div key={w.courseNo} className="notify-course-stat">
                    <div className="notify-course-stat-title">
                      <span
                        className="notify-course-stat-dot"
                        style={{
                          background: skipped ? "#f59e0b" : !n ? "#6b7280" : healthy ? "#22c55e" : failing ? "#ef4444" : "#f59e0b",
                        }}
                      />
                      <strong>{w.courseNo}</strong>{w.courseName ? ` — ${w.courseName}` : ""}
                    </div>
                    {skipped ? (
                      <ul className="notify-course-stat-list">
                        {w.skipReasons.map((r) => (
                          <li key={r} style={{ color: "#f59e0b" }}>{t("notify.skipped", { reason: r })}</li>
                        ))}
                      </ul>
                    ) : n ? (
                      <ul className="notify-course-stat-list">
                        <li>{t("notify.ntustFetches", { count: n.consecutiveFailures, total: n.totalFetches, failures: n.consecutiveFailures })}</li>
                        {n.lastSuccessAt && <li>{t("notify.lastSuccess", { time: new Date(n.lastSuccessAt).toLocaleTimeString(i18n.language) })}</li>}
                        {n.lastErrorAt && <li style={{ color: "#ef4444" }}>{t("notify.lastError", { error: n.lastError, time: new Date(n.lastErrorAt).toLocaleTimeString(i18n.language) })}</li>}
                        {w.cache && <li>{t("notify.cachedEnrollment", { enrolled: w.cache.chooseStudent, limit: w.cache.restrict1, age: w.cache.ageSeconds })}</li>}
                        {w.sharedPollIntervalMs != null && (
                          <li>
                            {t("notify.ntustPollRate", { seconds: w.sharedPollIntervalMs / 1000 })}
                            {w.sharedPollIntervalMs < status.effectiveIntervalMs && (
                              <span style={{ color: "#f59e0b" }}>
                                {t("notify.drivenByFaster", { seconds: status.effectiveIntervalMs / 1000 })}
                              </span>
                            )}
                          </li>
                        )}
                        {w.state && <li>{t("notify.pollerState", { state: w.state.wasFull ? t("notify.stateFull") : t("notify.stateOpen") })}{w.state.notifiedOpen ? t("notify.notified") : ""}</li>}
                      </ul>
                    ) : (
                      <p className="notify-desc">{t("notify.noFetchData")}</p>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      <div className="notify-prefs-panel-footer">
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? t("notify.saving") : t("notify.savePreferences")}
        </button>
        {hasChannel && (
          <button
            className="btn btn-secondary"
            onClick={handleTest}
            disabled={testing || saving}
            title={t("notify.testTitle")}
          >
            {testing ? t("notify.sending") : t("notify.testNotification")}
          </button>
        )}
        {saved && <span className="notify-saved-badge">{t("notify.saved")}</span>}
        {testResult && !testing && (
          <span className="notify-saved-badge" style={{ background: testResult.error ? "#ef4444" : undefined }}>
            {testResult.error
              ? `✗ ${testResult.error}`
              : [
                  testResult.discord && testResult.discord !== "not configured"
                    ? `Discord: ${testResult.discord}`
                    : null,
                  testResult.email && testResult.email !== "not configured"
                    ? `Email: ${testResult.email}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || t("notify.sent")}
          </span>
        )}
      </div>
    </div>
  );
}

export default NotifyPrefsPanel;
