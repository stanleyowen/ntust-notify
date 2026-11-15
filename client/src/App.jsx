import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "./context/AuthContext";
import { AccountProvider, useAccount } from "./context/AccountContext";
import { useHashRoute } from "./lib/useHashRoute";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./components/LoginPage";
import { SearchView } from "./components/SearchView";
import { WatchlistView } from "./components/WatchlistView";
import { AlertsView } from "./components/AlertsView";
import { BrandMark, Icon } from "./components/Icon";

/** Full-screen splash while Firebase restores the session. */
function Splash() {
  return (
    <div className="splash" aria-busy="true">
      <BrandMark size={44} />
      <span className="spinner" aria-hidden="true" />
    </div>
  );
}

/** Routes between the three signed-in views. */
function SignedIn() {
  const { t } = useTranslation();
  const [route] = useHashRoute();
  const { status, loadError, reload } = useAccount();

  useEffect(() => {
    document.title = `${t(`nav.${route}`)} · ${t("common.appName")}`;
  }, [route, t]);

  let content;
  if (status === "loading") {
    content = (
      <div className="view-loading" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
      </div>
    );
  } else if (status === "error") {
    content = (
      <div className="empty">
        <span className="empty-icon">
          <Icon name="alert" size={24} />
        </span>
        <h1 className="empty-title">{t("errors.loadAccount")}</h1>
        <p className="empty-body">{loadError}</p>
        <button type="button" className="btn btn-primary" onClick={reload}>
          {t("common.retry")}
        </button>
      </div>
    );
  } else if (route === "watchlist") {
    content = <WatchlistView />;
  } else if (route === "alerts") {
    content = <AlertsView />;
  } else {
    content = <SearchView />;
  }

  return <AppShell route={route}>{content}</AppShell>;
}

export default function App() {
  const { user } = useAuth();
  if (user === undefined) return <Splash />;
  if (user === null) return <LoginPage />;
  // Keyed by uid so switching accounts resets all per-user state.
  return (
    <AccountProvider key={user.uid}>
      <SignedIn />
    </AccountProvider>
  );
}
