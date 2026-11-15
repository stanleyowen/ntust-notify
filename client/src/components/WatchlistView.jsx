import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAccount } from "../context/AccountContext";
import { enrollment, formatSchedule, NTUST_REGISTER_URL } from "../lib/course";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { SeatMeter, StatusPill } from "./SeatMeter";

const AUTO_REFRESH_MS = 60_000;

/**
 * @param {{
 *   course: Record<string, any>,
 *   pending: boolean,
 *   hasChannel: boolean,
 *   onToggle: (courseNo: string, enabled: boolean) => void,
 *   onRemove: (courseNo: string) => void,
 * }} props
 */
const WatchCard = memo(function WatchCard({ course, pending, hasChannel, durationDays, onToggle, onRemove }) {
  const { t } = useTranslation();
  const e = enrollment(course);
  const name = course.CourseName || course.CourseNo;
  const { on, daysLeft, ended, endedAt } = course.alerts;
  const switchId = `alerts-${course.CourseNo}`;
  const canRegister = e.unlimited || (e.known && !e.full);

  return (
    <article className={`watch-card ${e.full ? "is-full" : canRegister ? "is-open" : ""}`} aria-labelledby={`${switchId}-name`}>
      <div className="watch-card-top">
        <StatusPill course={course} />
        <label className="switch-label" htmlFor={switchId}>
          <span className={on ? "" : "muted"}>{t("watchlist.alerts")}</span>
          <button
            id={switchId}
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={t("watchlist.alertsLabel", { name })}
            className={`switch ${on ? "switch-on" : ""}`}
            onClick={() => onToggle(course.CourseNo, !on)}
            disabled={pending}
          >
            <span className="switch-knob" />
          </button>
        </label>
      </div>

      <h3 className="watch-card-name" id={`${switchId}-name`}>
        {name}
      </h3>
      <p className="watch-card-sub">
        <span className="mono">{course.CourseNo}</span>
        {course.CourseTeacher && <span>{course.CourseTeacher}</span>}
      </p>

      <SeatMeter course={course} size="lg" />

      <ul className="facts">
        <li>
          <Icon name="clock" size={14} />
          {formatSchedule(course.Node, t)}
        </li>
        {course.ClassRoomNo && (
          <li>
            <Icon name="pin" size={14} />
            {course.ClassRoomNo}
          </li>
        )}
      </ul>

      {on ? (
        <p className={`watch-card-timer ${daysLeft <= 7 ? "is-soon" : ""}`}>
          <Icon name="bell" size={14} />
          <span>{t("watchlist.alertsEndIn", { count: daysLeft })}</span>
          {daysLeft <= 7 && (
            <button type="button" className="link-btn" disabled={pending} onClick={() => onToggle(course.CourseNo, true, { extend: true })}>
              {t("watchlist.extend", { days: durationDays })}
            </button>
          )}
        </p>
      ) : ended ? (
        <p className="watch-card-timer">
          <Icon name="bellOff" size={14} />
          <span>{t("watchlist.alertsEnded", { date: new Date(endedAt).toLocaleDateString(), days: durationDays })}</span>
        </p>
      ) : null}

      {on && !hasChannel && (
        <p className="watch-card-warn">
          <Icon name="alert" size={14} />
          {t("watchlist.noChannelShort")}
        </p>
      )}
      {course.stale && (
        <p className="watch-card-note">
          <Icon name="info" size={14} />
          {t("watchlist.stale")}
        </p>
      )}

      <div className="watch-card-foot">
        {canRegister ? (
          <a className="btn btn-success btn-sm" href={NTUST_REGISTER_URL} target="_blank" rel="noopener noreferrer">
            {t("watchlist.registerNow")}
            <Icon name="external" size={14} />
          </a>
        ) : (
          <span className="watch-card-hint">{on ? t("watchlist.watchingHint") : ended ? "" : t("watchlist.pausedHint")}</span>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label={t("watchlist.removeLabel", { name })}
          title={t("watchlist.remove")}
          onClick={() => onRemove(course.CourseNo)}
          disabled={pending}
        >
          <Icon name="trash" size={16} />
        </button>
      </div>
    </article>
  );
});

/** Prompt shown when alerts are on but have no delivery channel. */
function ChannelBanner() {
  const { t } = useTranslation();
  const { enableEmail, emailAvailable, profile } = useAccount();
  const [busy, setBusy] = useState(false);
  return (
    <div className="banner banner-warn" role="region" aria-labelledby="channel-banner-title">
      <span className="banner-icon">
        <Icon name="bellOff" size={20} />
      </span>
      <div className="banner-body">
        <h2 className="banner-title" id="channel-banner-title">
          {t("banner.noChannelTitle")}
        </h2>
        <p>{t("banner.noChannelBody")}</p>
      </div>
      <div className="banner-actions">
        {emailAvailable && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await enableEmail();
              setBusy(false);
            }}
          >
            <Icon name="mail" size={15} />
            {t("banner.useEmail", { email: profile?.email ?? "" })}
          </button>
        )}
        <a className="btn btn-ghost btn-sm" href="#/alerts">
          {t("banner.otherOptions")}
        </a>
      </div>
    </div>
  );
}

export function WatchlistView() {
  const { t } = useTranslation();
  const { courses, pending, hasChannel, setAlerts, unwatch, refreshLive, live, limits } = useAccount();
  const count = courses.length;

  // Fetch live seats on open, then every minute while the tab is visible.
  useEffect(() => {
    if (count === 0) return;
    refreshLive();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refreshLive();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count > 0, refreshLive]);

  const stats = useMemo(() => {
    let open = 0;
    let alerts = 0;
    for (const c of courses) {
      const e = enrollment(c);
      if (e.unlimited || (e.known && !e.full)) open++;
      if (c.alerts.on) alerts++;
    }
    return { open, alerts };
  }, [courses]);

  if (count === 0) {
    return (
      <div className="view">
        <header className="view-head">
          <h1 className="view-title">{t("watchlist.title")}</h1>
        </header>
        <EmptyState icon="list" title={t("watchlist.emptyTitle")} body={t("watchlist.emptyBody")}>
          <a className="btn btn-primary" href="#/search">
            <Icon name="search" size={16} />
            {t("watchlist.emptyCta")}
          </a>
        </EmptyState>
      </div>
    );
  }

  const updated = live.updatedAt ? new Date(live.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className="view">
      <header className="view-head view-head-row">
        <div>
          <h1 className="view-title">{t("watchlist.title")}</h1>
          <p className="view-sub">
            {t("watchlist.summary", { count, open: stats.open, alerts: stats.alerts })}
            <span className="muted"> · {t("watchlist.limit", { count, max: limits.maxWatched })}</span>
          </p>
        </div>
        <div className="view-actions">
          <span className="live-status" aria-live="polite">
            {live.loading ? (
              t("watchlist.refreshing")
            ) : updated ? (
              <>
                <span className="live-dot" aria-hidden="true" />
                {t("watchlist.updated", { time: updated })}
              </>
            ) : null}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => refreshLive({ force: true })} disabled={live.loading}>
            <Icon name="refresh" size={15} className={live.loading ? "spin" : ""} />
            {t("watchlist.refresh")}
          </button>
        </div>
      </header>

      {!hasChannel && stats.alerts > 0 && <ChannelBanner />}

      <div className="watch-grid">
        {courses.map((c) => (
          <WatchCard
            key={c.CourseNo}
            course={c}
            pending={pending.has(c.CourseNo)}
            hasChannel={hasChannel}
            durationDays={limits.alertDurationDays}
            onToggle={setAlerts}
            onRemove={unwatch}
          />
        ))}
      </div>
    </div>
  );
}
