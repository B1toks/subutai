import { useEffect, useRef, useState } from 'react';

export interface UserMenuProps {
  displayName: string;
  onChangeName: () => void;
}

/**
 * Sprint 2.6: UserMenu is now a thin trigger that surfaces only the
 * profile-level action ("Change name"). Leaderboard / Feedback / Help
 * are exposed as standalone buttons in the header — putting them in a
 * dropdown buried them.
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
        <span className="user-menu-item-icon">{'\u{1F464}'}</span>
        <span>{displayName}</span>
        <span className="user-menu-trigger-caret">{'▼'}</span>
      </button>
      {open && (
        <div className="user-menu-panel" role="menu">
          <button
            type="button"
            className="user-menu-item"
            role="menuitem"
            onClick={() => run(onChangeName)}
          >
            <span className="user-menu-item-icon">{'✏️'}</span>
            Change name
          </button>
        </div>
      )}
    </div>
  );
}
