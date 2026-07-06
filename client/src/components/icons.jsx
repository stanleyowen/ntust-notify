/**
 * Small inline SVG icons shared across the course table and watchlist panel.
 * SVGs render crisply at any size and inherit currentColor, unlike the emoji
 * glyphs they replace.
 */

/**
 * Star icon used for the watch toggle.
 *
 * @param {{ filled?: boolean }} props - Component props.
 * @returns {JSX.Element}
 */
export function StarIcon({ filled = false }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3.2 14.7 9l6.1.6-4.6 4.1 1.4 6-5.6-3.3L6.4 19.7l1.4-6L3.2 9.6 9.3 9z" />
    </svg>
  );
}

/**
 * Bell icon used for the per-course alert toggle.
 *
 * @param {{ filled?: boolean }} props - Component props.
 * @returns {JSX.Element}
 */
export function BellIcon({ filled = false }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
      <path d="M13.7 20a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

/**
 * Refresh (circular arrows) icon.
 *
 * @returns {JSX.Element}
 */
export function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/**
 * Small ✕ icon used for remove buttons.
 *
 * @returns {JSX.Element}
 */
export function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
