# NTUST Notify

NTUST Notify is a full-stack course tracking app for monitoring NTUST course availability.

It helps users:

- sign in with Google
- search NTUST courses
- save courses to a personal watchlist
- enable notifications for selected courses
- receive alerts when a full course becomes available again

The project combines a React frontend, an Express backend, Firebase Authentication / Firestore, and email or Discord notifications.

---

## Features

- Google sign-in with Firebase Authentication
- course search via the NTUST course query API
- personal watchlist stored in Firestore
- per-course notification toggle
- notification preferences for:
  - Email
  - Discord webhook
- configurable polling interval
- backend notification polling with:
  - per-user interval enforcement
  - course request deduplication
  - in-memory cache
  - stale-data protection
- diagnostics endpoint for poller status and cache/fetch health

---

## Tech Stack

### Frontend
- React
- Vite
- Firebase Web SDK

### Backend
- Node.js
- Express
- Axios
- Firebase Admin SDK
- Nodemailer
- express-rate-limit
- Helmet
- CORS

### Infrastructure / Deployment
- Docker
- Docker Compose
- PM2

---

## Project Structure

```text
client/
  src/
    components/
    context/
    hooks/
    App.jsx
    firebase.js
    main.jsx
  public/
  package.json
  vite.config.js

server/
  index.js
  Dockerfile
  docker-compose.yaml
  package.json
  .env.example
```

---

## How It Works

### 1. Authentication
Users sign in with Google through Firebase Authentication.

After sign-in, the frontend creates or updates the user document in Firestore.

### 2. Course Search
The frontend sends search conditions to the backend.

The backend proxies those requests to the NTUST course query API and returns the result to the frontend.

### 3. Watchlist
Users can add courses to their personal watchlist.

Watched courses are stored in Firestore under:

```text
users/{uid}/watchedCourses/{courseNo}
```

### 4. Notifications
Users can configure notification preferences such as:

- email notifications
- Discord webhook notifications
- optional Discord user mention
- polling interval

Each watched course can also enable or disable notifications individually.

### 5. Polling Logic
The backend continuously checks watched courses and only sends an alert when a course changes from:

```text
FULL -> OPEN
```

This prevents duplicate alerts while still allowing a new notification if the course becomes full again and later reopens.

---

## Backend Design Notes

The backend includes several important design choices:

- **Firebase token verification** for protected routes
- **rate limiting** to prevent abuse
- **CORS protection** for allowed frontend origins
- **in-memory Firestore mirrors** using snapshot listeners
- **request deduplication** so identical course checks are fetched only once
- **course response caching** to reduce unnecessary upstream requests
- **stale cache protection** so failed NTUST fetches do not incorrectly change notification state
- **recursive polling scheduling** to avoid overlapping poll runs

---

## Frontend Design Notes

The frontend is built around a few core concepts:

- `App.jsx` coordinates the authenticated application flow
- `AuthContext` manages Firebase auth state
- `useWatchedCourses` syncs the user watchlist from Firestore
- `useNotifyPrefs` syncs notification preferences
- `SearchForm` handles query input
- `CourseTable` renders search results and watchlist data
- `NotifyPrefsPanel` manages notification settings and diagnostics

---

## Environment Setup

### Frontend

See `client/.env.example`.

Example:

```env
VITE_API_URL=https://your-backend.example.com
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

### Backend

See `server/.env.example`.

Example:

```env
PORT=3001
ALLOWED_ORIGINS=https://your-frontend.example.com
AUTH_EMAILS=you@example.com

GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM="NTUST Notify <you@gmail.com>"
```

---

## Local Development

### Frontend

```bash
cd client
npm install
npm run dev
```

### Backend

```bash
cd server
npm install
npm run dev
```

---

## Production Build

### Frontend

```bash
cd client
npm install
npm run build
```

### Backend

```bash
cd server
npm install
npm start
```

---

## Backend Hosting

The backend can be hosted in either of the following ways:

### Option 1: PM2

PM2 is suitable if you want to run the Express backend directly on a server without containerizing it.

Example:

```bash
cd server
npm install
pm2 start index.js --name ntust-notify-backend
```

Useful PM2 commands:

```bash
pm2 status
pm2 logs ntust-notify-backend
pm2 restart ntust-notify-backend
pm2 stop ntust-notify-backend
```

### Option 2: Docker Compose

The backend also includes Docker support through `Dockerfile` and `docker-compose.yaml`.

Example:

```bash
cd server
docker compose up --build -d
```

Before starting the container, make sure the following are prepared:

- `.env`
- Firebase service account credentials
- SMTP settings if email notification is required

---

## API Overview

### `GET /health`
Returns backend health status.

### `POST /api/courses`
Searches NTUST courses through the backend proxy.

### `GET /api/poll-options`
Returns available polling intervals for the current user.

### `POST /api/notify/test`
Sends a test notification using current user settings.

### `GET /api/notify/status`
Returns notification poller diagnostics and watched-course status.

---

## Notification Channels

### Email
Email notifications are sent using SMTP via Nodemailer.

### Discord
Discord notifications are sent using a webhook and can optionally mention a user.

---

## Security Notes

- Firebase ID tokens are required for protected routes
- CORS is restricted to configured origins
- rate limiting is applied to reduce abuse
- request body size is limited
- security headers are enabled with Helmet

---

## Future Improvements

Potential future improvements include:

- modularizing the backend into routes / services / poller modules
- adding TypeScript
- adding automated tests
- supporting more notification platforms
- separating the poller into an independent worker process

---

## License

This project is licensed under the terms of the repository license.
