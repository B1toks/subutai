import type { LucideIcon } from 'lucide-react';
import { Icon } from './Icon';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

/**
 * Sprint 3.4 — branded empty-state block for fresh / unpopulated lists
 * (leaderboard, saved games, etc.). Pass any Lucide icon component
 * directly; the icon picks up `--text-muted` via currentColor.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden>
        <Icon icon={icon} size={48} strokeWidth={1.5} />
      </div>
      <h3 className="empty-state-title">{title}</h3>
      {description && (
        <p className="empty-state-description">{description}</p>
      )}
      {action && (
        <button
          type="button"
          className="empty-state-action"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
