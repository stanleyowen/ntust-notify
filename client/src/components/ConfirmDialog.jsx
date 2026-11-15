import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

/**
 * Accessible confirmation dialog built on native <dialog> (focus trapping,
 * Escape to close and inert background come for free).
 *
 * @param {{
 *   open: boolean,
 *   title: string,
 *   body: import("react").ReactNode,
 *   confirmLabel: string,
 *   busy?: boolean,
 *   danger?: boolean,
 *   onConfirm: () => void,
 *   onClose: () => void,
 * }} props
 */
export function ConfirmDialog({ open, title, body, confirmLabel, busy = false, danger = false, onConfirm, onClose }) {
  const { t } = useTranslation();
  const ref = useRef(/** @type {HTMLDialogElement | null} */ (null));

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="dialog-title"
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
    >
      <h2 id="dialog-title" className="dialog-title">
        {title}
      </h2>
      <div className="dialog-body">{body}</div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy} autoFocus>
          {t("common.cancel")}
        </button>
        <button type="button" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm} disabled={busy}>
          {busy && <span className="spinner spinner-sm" aria-hidden="true" />}
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
