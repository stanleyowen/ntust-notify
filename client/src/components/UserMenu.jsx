import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../lib/theme";
import { Icon } from "./Icon";

const THEMES = /** @type {const} */ ([
  { value: "system", icon: "monitor" },
  { value: "light", icon: "sun" },
  { value: "dark", icon: "moon" },
]);

/**
 * Avatar button + popover with account info, theme choice and sign-out.
 * Closes on Escape, outside click, and returns focus to the trigger.
 */
export function UserMenu() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  const rootRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const btnRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;
  const name = user.displayName || user.email || "";
  const initial = (name[0] ?? "?").toUpperCase();

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className="avatar-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t("user.menu")}
        onClick={() => setOpen((o) => !o)}
      >
        {user.photoURL && imgOk ? (
          <img src={user.photoURL} alt="" className="avatar" referrerPolicy="no-referrer" onError={() => setImgOk(false)} />
        ) : (
          <span className="avatar avatar-fallback" aria-hidden="true">
            {initial}
          </span>
        )}
      </button>

      {open && (
        <div className="popover" id={menuId}>
          <div className="popover-head">
            <span className="popover-name">{user.displayName}</span>
            <span className="popover-email">{user.email}</span>
          </div>

          <div className="popover-section">
            <span className="popover-label" id={`${menuId}-theme`}>
              {t("theme.label")}
            </span>
            <div className="segmented segmented-block" role="group" aria-labelledby={`${menuId}-theme`}>
              {THEMES.map((th) => (
                <button
                  key={th.value}
                  type="button"
                  className="segmented-btn"
                  aria-pressed={theme === th.value}
                  onClick={() => setTheme(th.value)}
                >
                  <Icon name={th.icon} size={15} />
                  {t(`theme.${th.value}`)}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="popover-item"
            onClick={async () => {
              setOpen(false);
              await signOut();
            }}
          >
            <Icon name="logout" size={16} />
            {t("user.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
