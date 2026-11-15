# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Two independent workspaces with **different package managers** — use yarn in `client/`, npm in `server/` (the Dockerfile runs `npm ci` against `server/package-lock.json`).

```bash
# server (Node ≥ 22, CommonJS, Express 5)
cd server
npm ci
npm test                                          # node:test, all suites
node --test test/poller.test.js                   # one file
node --test --test-name-pattern="watchlist" test/app.test.js   # one test
npm run dev                                       # node --watch index.js

# client (React 19 + Vite 8/Rolldown, ESM; Node ≥ 24.12 via client/.nvmrc — firebase 13 requires it)
cd client
yarn
yarn dev                                          # http://localhost:3001
yarn build                                        # also emits dist/_headers (CSP)
```

There is no linter or client test suite. Server tests need no network or Firebase — they inject a memory store and fake NTUST/notifier from `server/test/helpers.js`.

**Do not run the server from `server/` with its real `.env`.** `index.js` auto-loads `./.env` (via `process.loadEnvFile()`), which points at the production Firebase project, and starts a poller that sends real email/Discord alerts. To smoke-test, run `node /abs/path/server/index.js` from a directory without a `.env` (public routes only), or rely on `npm test`.

## Architecture

```
Browser ──Google sign-in──► Firebase Auth
   │ Bearer <Firebase ID token>
   ▼
API (server/) ──Admin SDK──► Firestore   (firestore.rules: deny ALL client access)
   ├── in-memory mirror via onSnapshot (store.js)
   ├── NTUST course API (ntust.js)
   └── SMTP / Discord webhooks (notifier.js)
```

- **The browser uses Firebase for sign-in only.** It never touches Firestore; every read and write goes through the API. Do not reintroduce `firebase/firestore` in the client: it is denied by the rules and it was the bulk of the old bundle.
- **`server/index.js`** only wires dependencies together. Everything in `server/src/` is a factory taking injected deps (`createApp`, `createFirestoreStore`, `createPoller`, `createNtustClient`, `createNotifier`). That is what makes the HTTP surface testable with fakes. Keep new code in that style.
- **`store.js`** mirrors `users/{uid}` and `users/{uid}/watchedCourses/{CourseNo}` in memory through snapshot listeners. Reads are served from memory; writes go to Firestore and update memory immediately. `whenReady()` resolves after the initial load; `requireAuth` awaits it. `test/helpers.js#createMemoryStore` must keep the same interface as the real store.
- **Identity never comes from document fields.** The alert email and the `AUTH_EMAILS` fast-poll privilege are resolved from the verified Firebase Auth record or token (`store.identity` / `alertEmail` / `isPrivileged`). `users/{uid}.email` is informational only.
- **Watched-course metadata is fetched from NTUST server-side.** `PUT /api/watchlist/:courseNo` takes only `{ semester, notifyEnabled }`.
- **`validate.js`** is the single place for input validation. It covers request bodies and also re-normalizes everything read back from Firestore. Discord webhooks are strictly validated, because the server POSTs to them (SSRF guard).
- **`ntust.js`** is one shared client for search, the watchlist "live" route and the poller. It provides:
  - a per-course cache, which search results also warm;
  - in-flight de-duplication;
  - projection to `COURSE_FIELDS`.
- **NTUST data quirks**, both handled in `ntust.js` and mirrored in `client/src/lib/course.js`:
  - NTUST returns one row per time/room block of the same course. `mergeCourseRows` merges them by `(Semester, CourseNo)`, joining `Node` and `ClassRoomNo`.
  - `Restrict1 >= 9999` means **no enrollment cap**. Such a course is never "full".
- **`poller.js`** runs a 1 s tick with per-user intervals (min 30 s, or 1 s for privileged users). It fetches each distinct `(semester, course)` once per cycle at the fastest subscriber's interval, with `POLL_FETCH_CONCURRENCY` lanes. Rules:
  - It alerts only on a FULL→OPEN transition, once per open window.
  - The first cycle after boot seeds state silently.
  - Stale data from a failed fetch never changes state.
- **Alert expiry.** Enabling alerts sets `alertsExpireAt = now + ALERT_DURATION_DAYS` (default 30); re-enabling extends it. `alertsActive()` in `store.js` is the source of truth. Docs with no `alertsExpireAt` count as expired. `store.expireAlerts()` persists `notifyEnabled: false` at poller start and every 10 min.
- **`app.js`**:
  - An IP flood limiter runs before auth. It is deliberately generous because of campus NAT.
  - Per-user limiters run after auth.
  - All errors are `{ error, code }`, built with `HttpError`. The client localizes `code` via `errors.<code>` in `client/src/locales/*.json`.

### Client

- **State:**
  - `AuthContext` holds Firebase auth state (popup sign-in, redirect fallback).
  - `AccountContext` owns all server data: profile, prefs, watchlist, limits, live seats. It provides optimistic mutations with rollback, undo, and a refetch when the tab regains focus.
  - `ToastContext` handles toasts.
- **Routing** is a minimal hash router (`lib/useHashRoute.js`) with three views: `search`, `watchlist`, `alerts`.
- **`lib/api.js`** attaches the ID token, retries once with a refreshed token on `invalid_token`, and maps failures to `ApiError(status, code)`.
- **Styling** lives in a single token-based `styles.css`, with light and dark themes defined via CSS variables. Dark is applied through `prefers-color-scheme` or `html[data-theme]`; `public/theme-init.js` sets it before paint.
- **All UI copy** goes in both `locales/en.json` and `locales/zh-TW.json`.
- **The CSP is generated** in `vite.config.js` from `VITE_API_URL` and `VITE_FIREBASE_AUTH_DOMAIN`, and written to `dist/_headers` for Netlify. There is no static `public/_headers`.
  - The CSP forbids inline scripts and `<style>`, so don't add any.
  - New external origins must be added to the generator.
  - `VITE_CSP_REPORT_ONLY=true` switches the policy to report-only.

## Deployment

- **Frontend:** Netlify, at `notify.stanleyowen.com`. It auto-deploys from `main`, and the build env must contain `VITE_API_URL` and `VITE_FIREBASE_*`.
- **Backend:** `ntust-notify-api.stanleyowen.com`, served through a Cloudflare tunnel to `localhost:3005` on the home server (`stanley@192.168.1.100`). It runs as pm2 app `ntust-notify` in `~/server/ntust-notify/server`, with Node from nvm. Update with:
  ```bash
  cd ~/server/ntust-notify && git pull && cd server && npm ci --omit=dev && pm2 restart ntust-notify
  ```
  `TRUST_PROXY=1` matches the single cloudflared hop. The server binds `HOST` (default `127.0.0.1`), so cloudflared on the same box is the only way in; `ufw` also blocks the port. The server's `.env` and `service-account.json` are git-ignored and live only on the box.
- **Docker:** `server/Dockerfile` and `docker-compose.yaml` are an alternative backend deploy. Use explicit `--chmod` on `COPY`, because host files may be mode 600.
- **Deploy order** for API changes the client depends on: backend first, then frontend. Firestore rules are deployed separately (`firestore.rules`, via the Firebase Console or `npx firebase-tools deploy --only firestore:rules`).
