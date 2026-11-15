/**
 * localStorage helpers that never throw (private mode, blocked storage, etc.).
 * Only used for per-device conveniences: theme, last semester, recent searches.
 */

/**
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @returns {T}
 */
export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 */
export function save(key, value) {
  try {
    if (value === undefined || value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
