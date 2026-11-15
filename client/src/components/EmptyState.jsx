import { Icon } from "./Icon";

/**
 * @param {{ icon: Parameters<typeof Icon>[0]["name"], title: string, body?: import("react").ReactNode, children?: import("react").ReactNode, compact?: boolean }} props
 */
export function EmptyState({ icon, title, body, children, compact = false }) {
  return (
    <div className={`empty ${compact ? "empty-compact" : ""}`}>
      <span className="empty-icon">
        <Icon name={icon} size={compact ? 20 : 24} />
      </span>
      <h2 className="empty-title">{title}</h2>
      {body && <p className="empty-body">{body}</p>}
      {children}
    </div>
  );
}
