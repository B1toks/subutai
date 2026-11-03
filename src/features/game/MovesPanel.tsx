import type { RefObject } from 'react';
import { useSession } from '../../session/useSession';
import { logOf } from './boardView';

interface MovesPanelProps {
  isMultiplayer: boolean;
  /** The game's notation, and the copy button's action and state (useNotation). */
  notationString: string;
  copyNotation: () => void;
  copied: boolean;
  /** The move list's element: useMoveLogScroll (in App) keeps it scrolled to
   *  the newest move, in an effect after the commit that attaches it. */
  logRef: RefObject<HTMLPreElement | null>;
}

/**
 * The Moves panel of the right column: the game's notation, kept scrolled
 * to the newest move, and the copy button. The log comes from the session
 * (the match's while one is played here). Order does not matter: the
 * scroll effect stays in App and runs after this commit, as before.
 */
export function MovesPanel({ isMultiplayer, notationString, copyNotation, copied, logRef }: MovesPanelProps) {
  const log = useSession(logOf(isMultiplayer));
  return (
    <section className="sidebar-panel sidebar-moves">
      <h2 className="sidebar-panel-title">
        Moves ({Math.ceil(log.moves.length / 2)})
      </h2>
      {log.moves.length === 0 ? (
        <div className="move-log-empty">No moves yet.</div>
      ) : (
        <pre ref={logRef} className="move-log-text">
          {notationString}
        </pre>
      )}
      <button
        type="button"
        className="copy-btn"
        onClick={copyNotation}
        disabled={log.moves.length === 0}
      >
        {copied ? 'Copied!' : 'Copy to clipboard'}
      </button>
    </section>
  );
}
