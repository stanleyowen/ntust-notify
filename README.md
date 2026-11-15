# NTUST Notify

Seat alerts for full NTUST courses. Search the catalogue, watch a course, and get an email or Discord message the moment a seat opens — the server checks around the clock.

- **Search** by course number, name or teacher with live seat counts
- **Watchlist** with live seats, per-course alert switches and a one-tap "Register now" when a seat is open
- **Auto-expiring alerts**: each course's alerts stay on for 30 days, then switch off to save server and NTUST load. Extend or re-enable with one tap.
- **Alerts** by email (your Google address) and/or Discord webhook, with a real delivery test and delivery diagnostics
- English and 繁體中文, light and dark themes, mobile-first layout
- Delete your account and data at any time

---

## Architecture

```text
Browser ──(Google sign-in)──► Firebase Auth
   │
   │  HTTPS + Firebase ID token
   ▼
API server (Express) ──► Firestore (Admin SDK, server-only)
   │      ▲
   │      └── in-memory mirror via onSnapshot (poll loop never reads Firestore)
   ├──► NTUST course API (shared cache, in-flight de-dupe, keep-alive)
   └──► SMTP / Discord webhooks
```

The browser uses Firebase **only for Google sign-in**. Every read and write goes through the API, which validates it; `firestore.rules` denies all direct client access.

### Security model

| Concern | How it's handled |
| --- | --- |
| Data access | Firestore is server-only (`allow read, write: if false`). Users can only reach their own data through authenticated routes. |
| Identity | Every API call verifies a Firebase ID token and requires a verified Google email. Sign-in and account deletion also check revocation (disabled/deleted accounts), and a deleted account's leftover tokens are refused. The alert email and the fast-poll privilege come from the **Auth record**, never from editable document fields. |
| Network | The API listens on `127.0.0.1` by default (`HOST`), so it's reachable only through the local reverse proxy / tunnel and `X-Forwarded-For` can't be forged by direct clients. |
| Input | All bodies, params and stored values are validated or normalized (`server/src/validate.js`). Course metadata is fetched from NTUST server-side, never taken from the client. |
| SSRF | Discord webhooks must be `https://discord.com/api/webhooks/{id}/{token}` (strict host and path, no credentials, ports or redirects). |
| Abuse | Per-user rate limits on every authenticated route, a generous per-IP flood limit (campus NAT friendly), capped watchlist size, 8 KB body limit. |
| Mentions | Discord `allowed_mentions` only ever pings the configured user. |
| Errors | Central JSON error handler; no stack traces or upstream error text reach clients. |
| Frontend | Strict CSP generated at build time from your env (`vite.config.js`), plus HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` and COOP. |
| Container | Node 24 Alpine, non-root, read-only root filesystem, all capabilities dropped, `no-new-privileges`, healthcheck. Secrets are mounted read-only and never copied into the image. |

### Performance

- One NTUST client is shared by search, the watchlist and the poller. Search results warm the per-course cache, so watching a course you just found is instant.
- Concurrent identical requests share a single upstream call. Connections are kept alive, so warm calls skip the TLS handshake.
- NTUST responses are reduced to the fields the app uses and merged per course (NTUST returns one row per time/room block). That roughly halves the payload per course.
- Alerts expire 30 days after being turned on (`ALERT_DURATION_DAYS`). The poller skips expired courses immediately, and a sweep at startup and every 10 minutes persists the switch-off. Trackers created before expiry existed count as expired.
- The watchlist's live seats come from one batched request served from cache, refreshed every minute while visible.
- The client bundle is about 52% smaller than before (no Firestore SDK), and Firebase sits in its own long-cached chunk.

---

## Project structure

```text
client/                     React + Vite SPA
  src/
    context/                Auth, Account (data + optimistic mutations), Toasts
    components/             Views (Search, Watchlist, Alerts) and UI pieces
    lib/                    api client, course helpers, routing, theme
    locales/                en, zh-TW
    styles.css              design system (tokens → components)
  vite.config.js            build + generated security headers
server/
  index.js                  process entry: wiring + graceful shutdown
  src/
    config.js               validated env config
    validate.js             all input validation and normalization
    ntust.js                NTUST client (cache, de-dupe, projection, merge)
    store.js                Firestore gateway + real-time mirror
    poller.js               FULL → OPEN detection and alert delivery
    notifier.js             email + Discord senders
    app.js                  Express routes, auth, rate limits, errors
  test/                     node:test suites (no network or Firebase needed)
firestore.rules             deny-all client rules
firebase.json
```

---

## Setup

### Backend (npm)

```bash
cd server
cp .env.example .env        # fill in values
npm ci
npm run dev                 # node --watch
npm test                    # 30 tests
```

### Frontend (yarn, Node ≥ 24.12)

```bash
cd client                   # .nvmrc pins Node 24 (also used by Netlify)
cp .env.example .env        # VITE_API_URL=http://localhost:3000 for local dev
yarn
yarn dev                    # http://localhost:3001
yarn build
```

### Docker

```bash
cd server
docker compose up --build -d
```

`docker-compose.yaml` mounts `./service-account.json` read-only at `/run/secrets/` and sets `GOOGLE_APPLICATION_CREDENTIALS` for you. The port is published on `127.0.0.1` by default (reachable only through a reverse proxy on the same host); set `BIND_ADDR=0.0.0.0` in `.env` only if clients must connect directly.

---

## Deploying this version (order matters)

1. **Backend first.** The new client needs the new API routes. The old client keeps working until step 3.
2. **Frontend.** Make sure the Netlify build env has `VITE_API_URL` and the `VITE_FIREBASE_*` values: the CSP is generated from them.
3. **Firestore rules.** Once the new frontend is live, deny all client access:
   ```bash
   firebase deploy --only firestore:rules
   ```
   (or paste `firestore.rules` into Firebase Console → Firestore → Rules).

Existing users and watchlists carry over unchanged (same Firestore schema).

If the CSP blocks something in your environment, build with `VITE_CSP_REPORT_ONLY=true` to switch it to report-only while you investigate.

---

## API

All `/api/*` routes except `/api/semesters` need `Authorization: Bearer <Firebase ID token>`. Errors are `{ "error": string, "code": string }`.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness + Firestore mirror state |
| GET | `/api/semesters` | Semester list (cached 1 h) |
| POST | `/api/courses` | Search `{ semester, courseNo \| courseName \| teacher }` |
| POST | `/api/session` | Record sign-in; returns account bootstrap |
| GET | `/api/me` | Account bootstrap (profile, prefs, watchlist, limits) |
| PUT | `/api/me/prefs` | Save alert preferences |
| DELETE | `/api/me` | Delete account and all data |
| GET | `/api/watchlist/live` | Live seats for every watched course |
| PUT | `/api/watchlist/:courseNo` | Watch `{ semester, notifyEnabled? }` |
| PATCH | `/api/watchlist/:courseNo` | `{ notifyEnabled }` |
| DELETE | `/api/watchlist/:courseNo` | Unwatch |
| POST | `/api/notify/test` | Send a test alert (5 per 10 min) |
| GET | `/api/notify/status` | Delivery diagnostics |

---

## License

See [LICENSE](LICENSE). NTUST Notify is an independent project and is not affiliated with National Taiwan University of Science and Technology.
