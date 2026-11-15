import { auth } from "../firebase";

/** Backend origin. Empty in dev uses Vite's /api proxy. */
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
const TIMEOUT_MS = 20_000;

/** Error carrying the server's stable error code for localisation. */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} [message]
   */
  constructor(status, code, message) {
    super(message || code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {AbortSignal | undefined} signal
 * @returns {AbortSignal}
 */
function withTimeout(signal) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  if (!signal) return timeout;
  return typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : signal;
}

/**
 * Calls the API with the user's Firebase ID token. Retries once with a
 * force-refreshed token if the server says the token expired.
 *
 * @template T
 * @param {string} path - e.g. "/api/me"
 * @param {{ method?: string, body?: unknown, auth?: boolean, signal?: AbortSignal }} [opts]
 * @returns {Promise<T>}
 */
export async function api(path, { method = "GET", body, auth: needsAuth = true, signal } = {}) {
  /** @param {boolean} forceRefresh */
  const attempt = async (forceRefresh) => {
    /** @type {Record<string, string>} */
    const headers = { Accept: "application/json" };
    if (needsAuth) {
      const user = auth.currentUser;
      if (!user) throw new ApiError(401, "unauthorized");
      headers.Authorization = `Bearer ${await user.getIdToken(forceRefresh)}`;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res;
    try {
      res = await fetch(API_BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "omit",
        signal: withTimeout(signal),
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new ApiError(0, err?.name === "TimeoutError" ? "timeout" : "network");
    }

    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, data?.code ?? `http_${res.status}`, data?.error);
    return data;
  };

  try {
    return await attempt(false);
  } catch (err) {
    if (err instanceof ApiError && err.code === "invalid_token" && needsAuth) return attempt(true);
    throw err;
  }
}

/**
 * Localised message for an error, using the server's code when known.
 *
 * @param {unknown} err
 * @param {(key: string, opts?: any) => string} t
 * @returns {string}
 */
export function errorMessage(err, t) {
  const code = err instanceof ApiError ? err.code : "";
  const key = `errors.${code}`;
  const msg = code ? t(key, { defaultValue: "" }) : "";
  if (msg) return msg;
  if (err instanceof ApiError && err.status === 429) return t("errors.rate_limited");
  if (err instanceof ApiError && err.status >= 500) return t("errors.server");
  return t("errors.generic");
}
