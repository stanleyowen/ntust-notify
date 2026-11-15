/**
 * Inline SVG icon set (stroke icons, 24×24 grid). Icons inherit currentColor
 * and are hidden from assistive tech — the control that contains them must
 * carry the accessible label.
 */

const PATHS = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
  bell: <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  bellOff: <><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5" /><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /><path d="m2 2 20 20" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  alert: <><path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3" /><path d="M12 9v4M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>,
  refresh: <><path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" /><path d="M3 12A9 9 0 0 1 18.4 5.6L21 8" /><path d="M21 3v5h-5M3 21v-5h5" /></>,
  trash: <><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></>,
  external: <><path d="M15 3h6v6M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  pin: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8" />,
  monitor: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>,
  sliders: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></>,
  arrowRight: <path d="M5 12h14M13 5l7 7-7 7" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />,
  zap: <path d="M13 2 3 14h9l-1 8 10-12h-9z" />,
  send: <><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></>,
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
};

const FILLABLE = new Set(["star", "bell"]);

/**
 * @param {{ name: keyof typeof PATHS | "discord", size?: number, filled?: boolean, className?: string }} props
 */
export function Icon({ name, size = 18, filled = false, className }) {
  if (name === "discord") {
    return (
      <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.2a18.3 18.3 0 0 0-5.5 0L8.6 3a19.7 19.7 0 0 0-4.9 1.4C.5 9-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2a13 13 0 0 1-1.9-.9l.4-.3a14.2 14.2 0 0 0 12.1 0l.4.3a12.3 12.3 0 0 1-1.9.9l1.2 2a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.5-13.7M8 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4m8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4" />
      </svg>
    );
  }
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled && FILLABLE.has(name) ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** App mark: the NTUST-blue rounded tile with a bell and the red alert dot. */
export function BrandMark({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className="brand-mark">
      <rect width="32" height="32" rx="9" fill="#005EB8" />
      <path
        d="M11 14a5 5 0 0 1 10 0c0 5 2 6.5 2 6.5H9s2-1.5 2-6.5"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M14.3 23.5a1.9 1.9 0 0 0 3.4 0" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="23.5" cy="8.5" r="4" fill="#ED1C24" stroke="#005EB8" strokeWidth="1.5" />
    </svg>
  );
}
