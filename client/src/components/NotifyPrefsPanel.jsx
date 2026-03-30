import { useState, useEffect } from "react";
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
function NotifyPrefsPanel({ prefs, onSave, demo = false }) {
  const [form, setForm] = useState({ ...prefs });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // null | { discord, email }
  const [status, setStatus] = useState(null); // null | API response
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState(null);
  const [pollOptions, setPollOptions] = useState([
    { label: "30 seconds", value: 30_000 },
    { label: "1 minute", value: 60_000 },
    { label: "3 minutes", value: 180_000 },
    { label: "5 minutes", value: 300_000 },
    { label: "10 minutes", value: 600_000 },
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
      if (!user) throw new Error("Not logged in");
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/notify/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setTestResult(data.results ?? { error: data.error ?? "Unknown error" });
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
      let res;
      if (demo) {
        res = await fetch(`${API_BASE}/api/demo/status`);
      } else {
        const user = auth.currentUser;
        if (!user) throw new Error("Not logged in");
        const token = await user.getIdToken();
        res = await fetch(`${API_BASE}/api/notify/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus(await res.json());
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

  return (
    <div className="notify-prefs-panel">
      <div className="notify-prefs-panel-header">
        <h2 className="notify-prefs-panel-title">Notification Preferences</h2>
        <p className="notify-prefs-panel-subtitle">
          Choose how you want to be alerted when a watched course opens up.
          Toggle the 🔔 bell icon on any watched course to enable alerts for it.
        </p>
      </div>

      <div className="notify-prefs-panel-body">
        {/* ── Email ── */}
        <label className="notify-row">
          <div className="notify-row-left">
            <input
              type="checkbox"
              checked={form.email}
              onChange={(e) => set("email", e.target.checked)}
            />
            <div>
              <span className="notify-label">📧 Email</span>
              <span className="notify-desc">
                Send an email to your Google account address when a slot opens.
              </span>
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
                Discord
              </span>
              <span className="notify-desc">
                Post a message to a Discord channel via webhook.
              </span>
            </div>
          </div>
        </label>

        {/* Discord sub-fields */}
        {form.discord && (
          <div className="notify-sub">
            <div className="form-group">
              <label htmlFor="discordWebhook">Webhook URL</label>
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
                  <span className="notify-label">Tag me in the message</span>
                </div>
              </div>
            </label>

            {form.discordTagMe && (
              <div className="form-group">
                <label htmlFor="discordUserId">Your Discord User ID</label>
                <input
                  id="discordUserId"
                  type="text"
                  value={form.discordUserId}
                  onChange={(e) => set("discordUserId", e.target.value)}
                  placeholder="e.g. 123456789012345678"
                />
                <span className="field-hint">
                  Enable Developer Mode in Discord → right-click your name →
                  Copy User ID.
                </span>
              </div>
            )}
          </div>
        )}

        {!hasChannel && (
          <p className="notify-info">Select at least one channel to receive alerts.</p>
        )}

        {/* ── Poll interval ── */}
        <div className="form-group notify-interval-group">
          <label htmlFor="pollInterval">Check interval</label>
          <select
            id="pollInterval"
            value={form.pollInterval ?? 60_000}
            onChange={(e) => set("pollInterval", Number(e.target.value))}
          >
            {pollOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="field-hint">
            How often the server checks for open slots on your watched courses.
          </span>
        </div>

        {/* ── Poller diagnostics ── */}
        <div className="notify-diagnostics">
          <div className="notify-diagnostics-header">
            <span className="notify-label">Poller diagnostics</span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleRefreshStatus}
              disabled={statusLoading}
            >
              {statusLoading ? "Loading…" : "🔄 Refresh status"}
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
                  <li>Poller ready: <strong>{status.pollerReady ? "✔ Yes" : "⧗ Seeding…"}</strong></li>
                  {status.hasAnyNotify != null && (
                    <li>
                      Notification channels:{" "}
                      <strong>{status.hasAnyNotify ? "✔ configured" : "✗ none enabled"}</strong>
                      {!status.hasAnyNotify && <span style={{ color: "#f59e0b" }}> — enable email or Discord above</span>}
                    </li>
                  )}
                  {status.requestedIntervalMs != null && status.effectiveIntervalMs != null && (
                    <li>
                      Poll interval: requested <strong>{(status.requestedIntervalMs / 1000).toFixed(0)}s</strong>
                      {" → "}effective <strong>{(status.effectiveIntervalMs / 1000).toFixed(0)}s</strong>
                      {status.requestedIntervalMs !== status.effectiveIntervalMs && (
                        <span style={{ color: "#f59e0b" }}> (capped — not an auth user)</span>
                      )}
                    </li>
                  )}
                  {status.lastPolled && (
                    <li>Last polled: <strong>{new Date(status.lastPolled).toLocaleTimeString()}</strong></li>
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
                          <li key={r} style={{ color: "#f59e0b" }}>⚠ Skipped: {r}</li>
                        ))}
                      </ul>
                    ) : n ? (
                      <ul className="notify-course-stat-list">
                        <li>NTUST fetches: {n.totalFetches} total, {n.consecutiveFailures} consecutive failure{n.consecutiveFailures !== 1 ? "s" : ""}</li>
                        {n.lastSuccessAt && <li>Last success: {new Date(n.lastSuccessAt).toLocaleTimeString()}</li>}
                        {n.lastErrorAt && <li style={{ color: "#ef4444" }}>Last error: {n.lastError} ({new Date(n.lastErrorAt).toLocaleTimeString()})</li>}
                        {w.cache && <li>Cached enrollment: {w.cache.chooseStudent} / {w.cache.restrict1} ({w.cache.ageSeconds}s ago)</li>}
                        {w.state && <li>Poller state: {w.state.wasFull ? "Full" : "Open"}{w.state.notifiedOpen ? " · notified" : ""}</li>}
                      </ul>
                    ) : (
                      <p className="notify-desc">No fetch data yet — poller hasn’t run for this course.</p>
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
          {saving ? "Saving…" : "Save preferences"}
        </button>
        {hasChannel && (
          <button
            className="btn btn-secondary"
            onClick={handleTest}
            disabled={testing || saving}
            title="Send a test alert to verify your Discord / email channel"
          >
            {testing ? "Sending…" : "🔔 Test notification"}
          </button>
        )}
        {saved && <span className="notify-saved-badge">✓ Saved</span>}
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
                  .join(" · ") || "Sent"}
          </span>
        )}
      </div>
    </div>
  );
}

export default NotifyPrefsPanel;
