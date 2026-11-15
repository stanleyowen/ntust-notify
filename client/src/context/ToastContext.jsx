import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../components/Icon";

/**
 * @typedef {{ id: number, message: string, tone: "neutral" | "success" | "error", action?: { label: string, onClick: () => void } }} Toast
 * @typedef {(message: string, opts?: { tone?: Toast["tone"], action?: Toast["action"] }) => void} ShowToast
 */

const ToastContext = createContext(/** @type {ShowToast | null} */ (null));

/** @param {{ toast: Toast, onDismiss: (id: number) => void }} props */
function ToastItem({ toast, onDismiss }) {
  const { t } = useTranslation();
  const timer = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));

  const start = useCallback(() => {
    timer.current = setTimeout(() => onDismiss(toast.id), toast.action ? 7000 : 4000);
  }, [onDismiss, toast]);
  const pause = () => clearTimeout(timer.current);

  useEffect(() => {
    start();
    return () => clearTimeout(timer.current);
  }, [start]);

  return (
    <div className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"} onMouseEnter={pause} onMouseLeave={start}>
      {toast.tone === "success" && <Icon name="check" size={16} />}
      {toast.tone === "error" && <Icon name="alert" size={16} />}
      <span className="toast-msg">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action.onClick();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="toast-close" aria-label={t("common.dismiss")} onClick={() => onDismiss(toast.id)}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

/** @param {{ children: import("react").ReactNode }} props */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState(/** @type {Toast[]} */ ([]));
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((x) => x.id !== id)), []);

  /** @type {ShowToast} */
  const show = useCallback((message, { tone = "neutral", action } = {}) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-2), { id, message, tone, action }]);
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite">
        {toasts.map((x) => (
          <ToastItem key={x.id} toast={x} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** @returns {ShowToast} */
// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
