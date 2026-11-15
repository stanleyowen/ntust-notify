"use strict";

/**
 * NTUST Notify API — process entry point.
 *
 * Wires configuration, Firebase, the NTUST client, the notifier, the
 * Firestore mirror and the poller together, then serves HTTP. See src/ for
 * each piece.
 */

// Load .env when present (Node ≥ 20.12 built-in; no dotenv dependency).
// In Docker, env vars come from env_file instead and this is a no-op.
try {
  process.loadEnvFile();
} catch {
  /* no .env file — fine */
}

const { loadConfig } = require("./src/config");
const { createNtustClient } = require("./src/ntust");
const { createNotifier } = require("./src/notifier");
const { createFirestoreStore } = require("./src/store");
const { createPoller } = require("./src/poller");
const { createApp } = require("./src/app");

const config = loadConfig();

/**
 * Initialises Firebase Admin, or returns null when no credentials are set
 * (the server then serves public routes only).
 */
function initFirebase() {
  const json = config.firebaseServiceAccountJson;
  if (!json && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.warn("[FIREBASE] No credentials configured — auth, watchlists and alerts are disabled.");
    return null;
  }
  try {
    const { initializeApp, cert, applicationDefault } = require("firebase-admin/app");
    const { getFirestore, FieldValue } = require("firebase-admin/firestore");
    const { getAuth } = require("firebase-admin/auth");
    const app = initializeApp({ credential: json ? cert(JSON.parse(json)) : applicationDefault() });
    console.log("[FIREBASE] Admin SDK initialised.");
    return { db: getFirestore(app), auth: getAuth(app), FieldValue };
  } catch (err) {
    console.error("[FIREBASE] Initialisation failed:", err.message);
    return null;
  }
}

const firebase = initFirebase();
const ntust = createNtustClient();
const notifier = createNotifier({
  smtp: config.smtp,
  createTransport: config.smtp ? require("nodemailer").createTransport : undefined,
});
const store = firebase
  ? createFirestoreStore({
      db: firebase.db,
      auth: firebase.auth,
      FieldValue: firebase.FieldValue,
      privilegedEmails: config.privilegedEmails,
    })
  : null;
const poller = store
  ? createPoller({ store, ntust, notifier, concurrency: config.pollConcurrency })
  : null;

const app = createApp({
  config,
  ntust,
  store,
  poller,
  notifier,
  verifyIdToken: firebase ? (token) => firebase.auth.verifyIdToken(token) : null,
});

const server = app.listen(config.port, () => {
  console.log(`[SERVER] Listening on :${config.port} (${config.isProduction ? "production" : "development"})`);
});
// Slowloris protection and sane upper bounds on idle sockets.
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 65_000; // > typical proxy idle timeout (60 s)

if (store && poller) {
  store.start();
  poller.start().catch((err) => console.error("[NOTIFY] Poller failed to start:", err));
}

const sweepTimer = setInterval(() => {
  const n = ntust.sweep();
  if (n > 0) console.log(`[NTUST] Swept ${n} stale cache entr${n === 1 ? "y" : "ies"}.`);
}, 10 * 60 * 1000);
sweepTimer.unref();

let shuttingDown = false;
/** @param {string} signal */
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SERVER] ${signal} received — shutting down.`);
  poller?.stop();
  store?.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (err) => console.error("[SERVER] Unhandled rejection:", err));
