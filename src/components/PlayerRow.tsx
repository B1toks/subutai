import { Pencil, User } from 'lucide-react';
import { Icon } from './Icon';

export interface PlayerRowProps {
  displayName: string;
  onChangeName: () => void;
}

/**
 * fix/mobile-ui: the player's name and "Change name" at the top of the
 * right panel, as a row — the name and the one action, no dropdown. A
 * popover inside the panel's scroll box would be clipped by it.
 * fix/v1.1.4: phone only (the panel is a drawer there and the header
 * has no room). From 721px the name is back in the header as UserMenu.
 */
export function PlayerRow({ displayName, onChangeName }: PlayerRowProps) {
  return (
    <div className="player-row">
      <span className="player-row-icon">
        <Icon icon={User} size="md" aria-hidden />
      </span>
      <span className="player-row-name" title={displayName}>{displayName}</span>
      <button type="button" className="player-row-btn" onClick={onChangeName}>
        <span className="player-row-icon">
          <Icon icon={Pencil} size="sm" aria-hidden />
        </span>
        Change name
      </button>
    </div>
  );
}
