"use strict";

/**
 * Alert delivery over Discord webhooks and SMTP email.
 *
 * Both senders THROW on failure (unlike the previous implementation, which
 * swallowed errors so the "test notification" button always reported success).
 * Callers decide whether a failure is fatal.
 */

const { isValidDiscordWebhook, DISCORD_ID_RE } = require("./validate");

const DAY_MAP = { M: "Mon", T: "Tue", W: "Wed", R: "Thu", F: "Fri", S: "Sat", U: "Sun" };
const PERIOD_MAP = {
  1: "08:10", 2: "09:10", 3: "10:10", 4: "11:10", 5: "12:10", 6: "13:10",
  7: "14:10", 8: "15:10", 9: "16:10", 10: "17:10", 11: "18:10", 12: "19:10",
  A: "07:10", n: "12:10", N: "13:10",
};
const COURSE_QUERY_URL = "https://querycourse.ntust.edu.tw/";

/**
 * "M1,W3" → "Mon 08:10, Wed 10:10".
 *
 * @param {unknown} node
 * @returns {string}
 */
function formatNode(node) {
  if (typeof node !== "string" || !node) return "N/A";
  return node
    .split(",")
    .map((n) => {
      const day = DAY_MAP[/** @type {keyof typeof DAY_MAP} */ (n[0])] ?? n[0];
      const p = n.slice(1);
      const time = PERIOD_MAP[/** @type {keyof typeof PERIOD_MAP} */ (/^\d+$/.test(p) ? Number(p) : p)] ?? p;
      return `${day} ${time}`;
    })
    .join(", ");
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Collapses whitespace/newlines so upstream text can't break a header line.
 *
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
function oneLine(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * @param {Record<string, any>} course
 */
function seatSummary(course) {
  const limit = Number.parseInt(String(course.Restrict1 ?? ""), 10);
  const enrolled = Number(course.ChooseStudent);
  const hasLimit = Number.isFinite(limit) && limit > 0 && limit < 9999;
  const remaining = hasLimit && Number.isFinite(enrolled) ? Math.max(0, limit - enrolled) : null;
  return {
    enrolled: Number.isFinite(enrolled) ? enrolled : "?",
    limit: hasLimit ? limit : "?",
    remaining: remaining ?? "?",
  };
}

/**
 * @param {{
 *   smtp: { host: string, port: number, secure: boolean, user: string, pass: string, from: string } | null,
 *   fetchImpl?: typeof fetch,
 *   createTransport?: (opts: any) => { sendMail: (m: any) => Promise<any> },
 *   logger?: Pick<Console, "log" | "warn">,
 * }} deps
 */
function createNotifier({ smtp, fetchImpl = globalThis.fetch, createTransport, logger = console }) {
  let mailer = null;
  if (smtp && createTransport) {
    mailer = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
      // Refuse to send credentials over an unencrypted connection.
      requireTLS: !smtp.secure,
      pool: true,
      maxConnections: 3,
    });
    logger.log(`[SMTP] Mailer configured via ${smtp.host}`);
  } else {
    logger.warn("[SMTP] Not configured – email notifications disabled.");
  }

  /**
   * @param {Record<string, any>} course
   * @param {{ discordWebhook?: string, discordTagMe?: boolean, discordUserId?: string }} prefs
   * @returns {Promise<void>}
   */
  async function sendDiscord(course, prefs) {
    const url = prefs.discordWebhook;
    if (!isValidDiscordWebhook(url)) throw new Error("invalid_webhook");

    const s = seatSummary(course);
    const field = (name, value, inline = true) => ({
      name,
      value: oneLine(value, 1000) || "—",
      inline,
    });
    const tagId =
      prefs.discordTagMe && DISCORD_ID_RE.test(String(prefs.discordUserId ?? ""))
        ? String(prefs.discordUserId)
        : null;

    const res = await fetchImpl(/** @type {string} */ (url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        content: tagId ? `<@${tagId}>` : "",
        // Only ever ping the configured user — course text from NTUST can't
        // trigger @everyone / role mentions.
        allowed_mentions: { parse: [], users: tagId ? [tagId] : [] },
        embeds: [
          {
            title: oneLine(`Seat open · ${course.CourseNo} ${course.CourseName ?? ""}`, 250),
            url: COURSE_QUERY_URL,
            color: 0x16a34a,
            fields: [
              field("Course", course.CourseNo),
              field("Teacher", course.CourseTeacher || "N/A"),
              field("Seats", `${s.remaining} left · ${s.enrolled}/${s.limit} enrolled`),
              field("Credits", course.CreditPoint ?? "?"),
              field("Room", course.ClassRoomNo || "N/A"),
              field("Schedule", formatNode(course.Node), false),
            ],
            footer: { text: oneLine(`NTUST Notify · Semester ${course.Semester ?? ""}`, 200) },
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`discord_${res.status}`);
  }

  /**
   * @param {Record<string, any>} course
   * @param {string} to - Verified recipient address.
   * @returns {Promise<void>}
   */
  async function sendEmail(course, to) {
    if (!mailer) throw new Error("email_not_configured");
    if (!to) throw new Error("no_verified_email");

    const s = seatSummary(course);
    const rows = [
      ["Course", course.CourseNo],
      ["Name", course.CourseName],
      ["Teacher", course.CourseTeacher || "N/A"],
      ["Seats", `${s.remaining} left · ${s.enrolled}/${s.limit} enrolled`],
      ["Credits", course.CreditPoint ?? "?"],
      ["Room", course.ClassRoomNo || "N/A"],
      ["Schedule", formatNode(course.Node)],
    ];

    const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
<p style="margin:0 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#16a34a;font-weight:700">Seat available</p>
<h1 style="margin:0 0 20px;font-size:20px;line-height:1.35">${escapeHtml(course.CourseNo)} · ${escapeHtml(course.CourseName)}</h1>
<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">
${rows.map(([k, v]) => `<tr><td style="padding:8px 0;color:#6b7280;width:96px;border-top:1px solid #f0f1f3">${escapeHtml(k)}</td><td style="padding:8px 0;border-top:1px solid #f0f1f3;font-weight:600">${escapeHtml(v)}</td></tr>`).join("\n")}
</table>
<p style="margin:24px 0 0"><a href="${COURSE_QUERY_URL}" style="display:inline-block;background:#2f54eb;color:#ffffff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open NTUST course selection</a></p>
<p style="margin:24px 0 0;color:#9ca3af;font-size:12px">Semester ${escapeHtml(course.Semester)} · You're receiving this because you turned on alerts for this course in NTUST Notify.</p>
</div></body></html>`;

    const text = [
      `A seat just opened in ${course.CourseNo} ${course.CourseName ?? ""}`,
      "",
      ...rows.map(([k, v]) => `${k}: ${v}`),
      "",
      `Register: ${COURSE_QUERY_URL}`,
    ].join("\n");

    await mailer.sendMail({
      from: smtp.from,
      to,
      subject: oneLine(`Seat open: ${course.CourseNo} ${course.CourseName ?? ""}`, 150),
      text,
      html,
    });
  }

  return { sendDiscord, sendEmail, emailEnabled: Boolean(mailer) };
}

module.exports = { createNotifier, formatNode, escapeHtml };
