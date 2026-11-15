// Applies a saved light/dark preference before first paint to avoid a flash.
// Kept as a tiny external file because the CSP disallows inline scripts.
try {
  var t = localStorage.getItem("ntust-theme");
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
} catch (e) {
  /* storage unavailable — fall back to the system preference */
}
