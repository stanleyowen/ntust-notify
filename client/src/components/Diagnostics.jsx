import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorMessage } from "../lib/api";
import { formatInterval } from "../lib/course";
import { Icon } from "./Icon";

/**
 * @param {number | null} ts
 * @param {(k: string) => string} t
 */
function timeOf(ts, t) {
  return ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : t("diag.never");
}

/**
 * Collapsible "is the server actually watching my courses?" panel. Loads on
 * demand so it costs nothing for users who never open it.
 */
export function Diagnostics() {
  const { t } = useTranslation();
  const [data, setData] = useState(/** @type {any} */ (null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await api("/api/notify/status"));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setLoading(false);
    }
  }

  return (
    <details
      className="card section disclosure-card"
      onToggle={(e) => {
        if (/** @type {HTMLDetailsElement} */ (e.currentTarget).open && !data && !loading) load();
      }}
    >
      <summary>
        <span>
          <span className="section-title">{t("diag.title")}</span>
          <span className="section-desc">{t("diag.subtitle")}</span>
        </span>
        <Icon name="chevronDown" size={18} className="disclosure-chevron" />
      </summary>

      <div className="diag">
        <div className="diag-toolbar">
          <button type="button" className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            <Icon name="refresh" size={14} className={loading ? "spin" : ""} />
            {t("diag.refresh")}
          </button>
        </div>

        {error && (
          <p className="notice notice-error" role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </p>
        )}

        {data && (
          <>
            <dl className="kv">
              <div>
                <dt>{t("diag.poller")}</dt>
                <dd>
                  <span className={`status-dot ${data.pollerReady ? "ok" : "warn"}`} aria-hidden="true" />
                  {data.pollerReady ? t("diag.running") : t("diag.starting")}
                </dd>
              </div>
              <div>
                <dt>{t("diag.channels")}</dt>
                <dd>
                  {[data.channels.email && t("alerts.channel.email"), data.channels.discord && t("alerts.channel.discord")]
                    .filter(Boolean)
                    .join(", ") || t("diag.none")}
                </dd>
              </div>
              <div>
                <dt>{t("diag.interval")}</dt>
                <dd>{data.intervalMs.effective ? formatInterval(data.intervalMs.effective, t) : "—"}</dd>
              </div>
              <div>
                <dt>{t("diag.lastChecked")}</dt>
                <dd>{timeOf(data.lastPolledAt, t)}</dd>
              </div>
            </dl>

            {data.courses.length > 0 && (
              <ul className="diag-list">
                {data.courses.map((c) => {
                  const h = c.health;
                  const tone = !c.notifyEnabled ? "off" : !h ? "idle" : h.consecutiveFailures > 0 ? "bad" : "ok";
                  return (
                    <li key={c.courseNo} className="diag-item">
                      <span className={`status-dot ${tone}`} aria-hidden="true" />
                      <div>
                        <p className="diag-name">
                          <span className="mono">{c.courseNo}</span> {c.courseName}
                        </p>
                        <p className="diag-meta">
                          {!c.notifyEnabled
                            ? t("diag.alertsOff")
                            : !h
                              ? t("diag.notYet")
                              : h.consecutiveFailures > 0
                                ? t("diag.failing", { count: h.consecutiveFailures })
                                : t("diag.healthy", { time: timeOf(h.lastSuccessAt, t) })}
                          {c.cache && c.cache.limit != null && (
                            <> · {t("diag.cached", { enrolled: c.cache.enrolled, limit: c.cache.limit })}</>
                          )}
                          {c.state && <> · {c.state.wasFull ? t("diag.stateFull") : t("diag.stateOpen")}</>}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </details>
  );
}
