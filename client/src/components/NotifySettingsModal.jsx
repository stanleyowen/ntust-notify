import { useState, useEffect } from "react";

/**
 * Modal dialog for editing user-level notification preferences.
 *
 * This appears to be an alternate modal-based UI for notification settings,
 * while the current app also provides an inline settings panel.
 *
 * @param {{
 *   prefs: {
 *     email?: boolean,
 *     discord?: boolean,
 *     discordWebhook?: string,
 *     discordTagMe?: boolean,
 *     discordUserId?: string,
 *   },
 *   onSave: (prefs: Record<string, any>) => Promise<void>,
 *   onClose: () => void,
 * }} props - Component props.
 * @returns {JSX.Element}
 */
function NotifySettingsModal({ prefs, onSave, onClose }) {
  const [form, setForm] = useState({ ...prefs });
  const [saving, setSaving] = useState(false);

  /**
   * Adds Escape-key handling so the modal can be dismissed from the keyboard.
   *
   * @returns {() => void}
   */
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * Updates a single field in the local form state.
   *
   * @param {string} field - Preference field name.
   * @param {any} value - New field value.
   * @returns {void}
   */
  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  /**
   * Saves the current form values through the parent callback, then closes the
   * modal.
   *
   * @returns {Promise<void>}
   */
  async function handleSave() {
    setSaving(true);
    await onSave(form);
    setSaving(false);
    onClose();
  }

  /**
   * Whether the user has enabled at least one notification channel.
   */
  const hasChannel = form.email || form.discord;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Notification settings"
      >
        {/* Header */}
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Notification Preferences</h2>
            <p className="modal-subtitle">
              Choose how you want to be alerted when a watched course opens up.
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {/* ── Email ── */}
          <label className="notify-row">
            <div className="notify-row-left">
              <input
                type="checkbox"
                checked={form.email}
                onChange={(e) => set("email", e.target.checked)}
              />
              <div>
                <span className="notify-label">📧 Email</span>
                <span className="notify-desc">
                  Send an email to your Google account address when a slot opens.
                </span>
              </div>
            </div>
          </label>

          {/* ── Discord ── */}
          <label className="notify-row">
            <div className="notify-row-left">
              <input
                type="checkbox"
                checked={form.discord}
                onChange={(e) => set("discord", e.target.checked)}
              />
              <div>
                <span className="notify-label">
                  <svg className="discord-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                  </svg>
                  Discord
                </span>
                <span className="notify-desc">
                  Post a message to a Discord channel via webhook.
                </span>
              </div>
            </div>
          </label>

          {/* Discord sub-fields */}
          {form.discord && (
            <div className="notify-sub">
              <div className="form-group">
                <label htmlFor="discordWebhook">Webhook URL</label>
                <input
                  id="discordWebhook"
                  type="url"
                  value={form.discordWebhook}
                  onChange={(e) => set("discordWebhook", e.target.value)}
                  placeholder="https://discord.com/api/webhooks/..."
                  spellCheck={false}
                />
              </div>

              <label className="notify-row notify-row-compact">
                <div className="notify-row-left">
                  <input
                    type="checkbox"
                    checked={form.discordTagMe}
                    onChange={(e) => set("discordTagMe", e.target.checked)}
                  />
                  <div>
                    <span className="notify-label">Tag me in the message</span>
                  </div>
                </div>
              </label>

              {form.discordTagMe && (
                <div className="form-group">
                  <label htmlFor="discordUserId">Your Discord User ID</label>
                  <input
                    id="discordUserId"
                    type="text"
                    value={form.discordUserId}
                    onChange={(e) => set("discordUserId", e.target.value)}
                    placeholder="e.g. 123456789012345678"
                  />
                  <span className="field-hint">
                    Enable Developer Mode in Discord → right-click your name →
                    Copy User ID.
                  </span>
                </div>
              )}
            </div>
          )}

          {!hasChannel && (
            <p className="notify-info">Select at least one channel to receive alerts.</p>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default NotifySettingsModal;
