import { useCallback, useState } from "react";

const KEY = "ntust-theme";

/** Raw string storage — must match what public/theme-init.js reads. */
function read() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/**
 * Theme preference: "system" follows the OS; "light"/"dark" force it.
 * public/theme-init.js applies the saved value before first paint.
 *
 * @returns {["system" | "light" | "dark", (t: "system" | "light" | "dark") => void]}
 */
export function useTheme() {
  const [theme, setThemeState] = useState(read);

  const setTheme = useCallback((t) => {
    setThemeState(t);
    try {
      if (t === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, t);
    } catch {
      /* ignore */
    }
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  }, []);

  return [theme, setTheme];
}
