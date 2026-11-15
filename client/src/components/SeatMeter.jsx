import { useTranslation } from "react-i18next";
import { enrollment } from "../lib/course";

/**
 * Seat availability: headline ("12 seats left" / "Full"), a fill bar, and the
 * raw enrolled/limit count. Colour is never the only signal — the text says it.
 *
 * @param {{ course: Record<string, any>, size?: "sm" | "lg" }} props
 */
export function SeatMeter({ course, size = "sm" }) {
  const { t } = useTranslation();
  const e = enrollment(course);

  if (e.unlimited) {
    return (
      <div className={`seats seats-${size} seats-open seats-nocap`}>
        <div className="seats-line">
          <span className="seats-head">{t("course.noCap")}</span>
          {e.enrolled != null && <span className="seats-sub">{t("course.enrolledOnly", { count: e.enrolled })}</span>}
        </div>
      </div>
    );
  }

  if (!e.known) {
    return (
      <div className={`seats seats-${size} seats-unknown`}>
        <span className="seats-head">{t("course.unknownSeats")}</span>
      </div>
    );
  }

  const tone = e.full ? "full" : e.remaining <= 3 ? "low" : "open";
  return (
    <div className={`seats seats-${size} seats-${tone}`}>
      <div className="seats-line">
        <span className="seats-head">
          {e.full ? t("course.noSeats") : t("course.seatsLeft", { count: e.remaining })}
        </span>
        <span className="seats-sub">{t("course.enrolled", { enrolled: e.enrolled, limit: e.limit })}</span>
      </div>
      <div
        className="meter"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={e.limit}
        aria-valuenow={Math.min(e.enrolled, e.limit)}
        aria-label={t("course.enrolled", { enrolled: e.enrolled, limit: e.limit })}
      >
        <span className="meter-fill" style={{ width: `${e.pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Compact Open / Full pill.
 *
 * @param {{ course: Record<string, any> }} props
 */
export function StatusPill({ course }) {
  const { t } = useTranslation();
  const e = enrollment(course);
  if (!e.known && !e.unlimited) return null;
  return (
    <span className={`pill ${e.full ? "pill-full" : "pill-open"}`}>
      <span className="pill-dot" aria-hidden="true" />
      {e.full ? t("course.full") : t("course.open")}
    </span>
  );
}
