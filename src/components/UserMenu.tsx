import { useEffect, useRef, useState } from 'react';

export interface UserMenuProps {
  displayName: string | null;
  canFeedback: boolean;
  onChangeName: () => void;
  onOpenLeaderboard: () => void;
  onOpenFeedback: () => void;
  onOpenHelp: () => void;
}

export function UserMenu({
  displayName,
  canFeedback,
  onChangeName,
  onOpenLeaderboard,
  onOpenFeedback,
  onOpenHelp,
}: UserMenuProps) {
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

  const label = displayName ?? 'Menu';
  const triggerCls = `user-menu-trigger${displayName ? '' : ' user-menu-anon'}`;

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className={triggerCls}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={displayName ? 'User menu' : 'Menu'}
      >
        <span className="user-menu-item-icon">{'\u{1F464}'}</span>
        <span>{label}</span>
        <span className="user-menu-trigger-caret">{'▼'}</span>
      </button>
      {open && (
        <div className="user-menu-panel" role="menu">
          {displayName && (
            <button
              type="button"
              className="user-menu-item"
              role="menuitem"
              onClick={() => run(onChangeName)}
            >
              <span className="user-menu-item-icon">{'✏️'}</span>
              Change name
            </button>
          )}
          {displayName && <div className="user-menu-divider" />}
          <button
            type="button"
            className="user-menu-item"
            role="menuitem"
            onClick={() => run(onOpenLeaderboard)}
          >
            <span className="user-menu-item-icon">{'\u{1F3C6}'}</span>
            Leaderboard
          </button>
          <button
            type="button"
            className="user-menu-item"
            role="menuitem"
            onClick={() => run(onOpenFeedback)}
            disabled={!canFeedback}
            title={canFeedback ? 'Share feedback' : 'Sign in and pick a name to send feedback'}
          >
            <span className="user-menu-item-icon">{'\u{1F4AC}'}</span>
            Send feedback
          </button>
          <div className="user-menu-divider" />
          <button
            type="button"
            className="user-menu-item"
            role="menuitem"
            onClick={() => run(onOpenHelp)}
          >
            <span className="user-menu-item-icon">{'?'}</span>
            Rules &amp; info
          </button>
        </div>
      )}
    </div>
  );
}
