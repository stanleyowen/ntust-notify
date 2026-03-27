import { useState } from "react";
import { useAuth } from "../context/AuthContext";

/**
 * Authenticated user menu shown in the app header.
 *
 * The menu displays the current user's avatar/details and provides a sign-out
 * action.
 *
 * @returns {JSX.Element | null}
 */
function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  return (
    <div className="user-menu">
      <button
        className="user-avatar-btn"
        onClick={() => setOpen((o) => !o)}
        title={user.displayName ?? user.email}
      >
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt={user.displayName ?? "User"}
            className="user-avatar"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="user-avatar-fallback">
            {(user.displayName ?? user.email ?? "U")[0].toUpperCase()}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="user-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="user-menu-dropdown">
            <div className="user-menu-info">
              <span className="user-menu-name">{user.displayName}</span>
              <span className="user-menu-email">{user.email}</span>
            </div>
            <hr className="user-menu-divider" />
            <button
              className="user-menu-signout"
              onClick={async () => {
                setOpen(false);
                await signOut();
              }}
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default UserMenu;
