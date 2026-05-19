import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Pencil, User } from 'lucide-react';
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
 */
export function UserMenu({ displayName, onChangeName }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className="user-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="User menu"
      >
        <span className="user-menu-item-icon">
          <Icon icon={User} size="md" aria-hidden />
        </span>
        <span>{displayName}</span>
        <span className="user-menu-trigger-caret">
          <Icon icon={ChevronDown} size="sm" aria-hidden />
        </span>
      </button>
      {open && (
        <div className="user-menu-panel" role="menu">
          <button
            type="button"
            className="user-menu-item"
            role="menuitem"
            onClick={() => run(onChangeName)}
          >
            <span className="user-menu-item-icon">
              <Icon icon={Pencil} size="sm" aria-hidden />
            </span>
            Change name
          </button>
        </div>
      )}
    </div>
  );
}
