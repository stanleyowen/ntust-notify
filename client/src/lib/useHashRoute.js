import { useEffect, useState, useCallback } from "react";

/** The app's top-level views. */
export const ROUTES = ["search", "watchlist", "alerts"];

/** @returns {string} */
function current() {
  const name = window.location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  return ROUTES.includes(name) ? name : "search";
}

/**
 * Minimal hash router: deep-linkable views, working back/forward buttons and
 * refresh — without a router dependency.
 *
 * @returns {[string, (route: string) => void]}
 */
export function useHashRoute() {
  const [route, setRoute] = useState(current);

  useEffect(() => {
    const onChange = () => {
      setRoute(current());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((to) => {
    if (ROUTES.includes(to)) window.location.hash = `/${to}`;
  }, []);

  return [route, navigate];
}
