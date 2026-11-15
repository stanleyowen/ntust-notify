"use strict";

/**
 * Centralised, validated runtime configuration.
 *
 * Every environment variable the server reads is parsed here exactly once so
 * the rest of the code works with typed values and never touches process.env.
 */

const DEFAULT_ORIGINS = [
  "https://notify.stanleyowen.com",
  "https://ntust.netlify.app",
];

/** Minimum poll interval for regular users, in ms. */
const NORMAL_MIN_INTERVAL_MS = 30_000;

/** Minimum poll interval for privileged (AUTH_EMAILS) users, in ms. */
const PRIVILEGED_MIN_INTERVAL_MS = 1_000;

/** Poll interval choices offered to every user. */
const NORMAL_POLL_OPTIONS = [30_000, 60_000, 180_000, 300_000, 600_000];

/** Privileged users additionally get a 1-second option. */
const PRIVILEGED_POLL_OPTIONS = [1_000, ...NORMAL_POLL_OPTIONS];

/** Interval used when a user has never chosen one. */
const DEFAULT_POLL_INTERVAL_MS = 60_000;

/**
 * Parses an integer env var and clamps it to [min, max].
 *
 * @param {string | undefined} raw
 * @param {number} fallback
 * @param {{ min?: number, max?: number }} [bounds]
 * @returns {number}
 */
function toInt(raw, fallback, { min = -Infinity, max = Infinity } = {}) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * Splits a comma-separated env var into trimmed, non-empty entries.
 *
 * @param {string | undefined} raw
 * @returns {string[]}
 */
function toList(raw) {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Builds the configuration object from an environment map.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 */
function loadConfig(env = process.env) {
  const origins = toList(env.ALLOWED_ORIGINS);
  const smtpReady = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

  return {
    port: toInt(env.PORT, 3000, { min: 1, max: 65535 }),
    isProduction: env.NODE_ENV === "production",
    allowedOrigins: origins.length ? origins : DEFAULT_ORIGINS,
    // Lower-cased for case-insensitive comparison against verified emails.
    privilegedEmails: new Set(toList(env.AUTH_EMAILS).map((e) => e.toLowerCase())),
    // Number of reverse-proxy hops to trust for X-Forwarded-For. 0 = none.
    trustProxy: toInt(env.TRUST_PROXY, 1, { min: 0, max: 10 }),
    pollConcurrency: toInt(env.POLL_FETCH_CONCURRENCY, 8, { min: 1, max: 32 }),
    maxWatchedPerUser: toInt(env.MAX_WATCHED_PER_USER, 30, { min: 1, max: 200 }),
    firebaseServiceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON || null,
    smtp: smtpReady
      ? {
          host: env.SMTP_HOST,
          port: toInt(env.SMTP_PORT, 587, { min: 1, max: 65535 }),
          secure: env.SMTP_SECURE === "true",
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
          from: env.SMTP_FROM || env.SMTP_USER,
        }
      : null,
  };
}

module.exports = {
  loadConfig,
  NORMAL_MIN_INTERVAL_MS,
  PRIVILEGED_MIN_INTERVAL_MS,
  NORMAL_POLL_OPTIONS,
  PRIVILEGED_POLL_OPTIONS,
  DEFAULT_POLL_INTERVAL_MS,
};
