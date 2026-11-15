import { useTranslation } from "react-i18next";
import { useAccount } from "../context/AccountContext";
import { BrandMark, Icon } from "./Icon";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { UserMenu } from "./UserMenu";

/**
 * @param {{ route: string, children: import("react").ReactNode }} props
 */
export function AppShell({ route, children }) {
  const { t } = useTranslation();
  const { courses, hasChannel, status } = useAccount();
  const needsChannel = status === "ready" && !hasChannel && courses.length > 0;

  const items = [
    { id: "search", icon: "search", label: t("nav.search") },
    { id: "watchlist", icon: "list", label: t("nav.watchlist"), count: courses.length || null },
    { id: "alerts", icon: "bell", label: t("nav.alerts"), attention: needsChannel },
  ];

  /** @param {"desktop" | "mobile"} variant */
  const links = (variant) =>
    items.map((it) => (
      <a
        key={it.id}
        href={`#/${it.id}`}
        className={`nav-link nav-link-${variant}`}
        aria-current={route === it.id ? "page" : undefined}
      >
        <span className="nav-icon">
          <Icon name={it.icon} size={variant === "mobile" ? 22 : 17} />
          {it.attention && <span className="nav-dot" aria-hidden="true" />}
        </span>
        <span className="nav-label">{it.label}</span>
        {it.count != null && (
          <span className="nav-count" aria-label={t("nav.countLabel", { count: it.count })}>
            {it.count}
          </span>
        )}
        {it.attention && <span className="visually-hidden">{t("nav.needsAttention")}</span>}
      </a>
    ));

  return (
    <div className="shell">
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          // Don't let "#main" hit the hash router; just move focus.
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        {t("nav.skip")}
      </a>
      <header className="topbar">
        <div className="topbar-inner container">
          <a href="#/search" className="brand" aria-label={t("common.appName")}>
            <BrandMark size={30} />
            <span className="brand-name">{t("common.appName")}</span>
          </a>
          <nav className="nav-desktop" aria-label={t("nav.main")}>
            {links("desktop")}
          </nav>
          <div className="topbar-actions">
            <LanguageSwitcher />
            <UserMenu />
          </div>
        </div>
      </header>

      <main id="main" className="container main" tabIndex={-1}>
        {children}
      </main>

      <nav className="nav-mobile" aria-label={t("nav.main")}>
        {links("mobile")}
      </nav>
    </div>
  );
}
