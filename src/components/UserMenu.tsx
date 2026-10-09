import { Pencil, User } from 'lucide-react';
import { Icon } from './Icon';

export interface UserMenuProps {
  displayName: string;
  onChangeName: () => void;
}

/**
 * Sprint 2.6: UserMenu is now a thin trigger that surfaces only the
 * profile-level action ("Change name"). Leaderboard / Feedback / Help
 * are exposed as standalone buttons in the header — putting them in a
 * dropdown buried them.
 * Sprint 3.1: emoji glyphs swapped for Lucide icons.
 * fix/mobile-ui: moved out of the header to the top of the right panel,
 * as a row — the player's name and the one action, no dropdown. A
 * popover inside the panel's scroll box would be clipped by it.
 */
export function UserMenu({ displayName, onChangeName }: UserMenuProps) {
  return (
    <div className="user-menu">
      <span className="user-menu-item-icon">
        <Icon icon={User} size="md" aria-hidden />
      </span>
      <span className="user-menu-name" title={displayName}>{displayName}</span>
      <button type="button" className="user-menu-item" onClick={onChangeName}>
        <span className="user-menu-item-icon">
          <Icon icon={Pencil} size="sm" aria-hidden />
        </span>
        Change name
      </button>
    </div>
  );
}
