import { BarChart3 } from 'lucide-react';
import { Icon } from '../../components/Icon';
import { useSession } from '../../session/useSession';
import { logOf } from './boardView';

interface AnalysisPanelProps {
  isMultiplayer: boolean;
  /** The colour this seat plays (useEval). */
  myColor: 'white' | 'black';
  /** The search's mate distance and score, White's view (useEval). */
  searchMateInPlies: number | null;
  searchEvalFromWhite: number | null;
  /** The score from this seat's side (useEval). */
  myPerspectiveEval: number;
  /** Opens the Review of this game (App: busy.navigate to the review view). */
  onReview: () => void;
}

/**
 * The Analysis panel of the right column: the evaluation from my side
 * (or a mate count), the last move, and the way into Review. The log comes
 * from the session (the match's while one is played here); the scores
 * from useEval through App. Order does not matter.
 */
export function AnalysisPanel({
  isMultiplayer,
  myColor,
  searchMateInPlies,
  searchEvalFromWhite,
  myPerspectiveEval,
  onReview,
}: AnalysisPanelProps) {
  const log = useSession(logOf(isMultiplayer));
  return (
    <section className="sidebar-panel sidebar-analysis" data-tour="analysis">
      <h2 className="sidebar-panel-title">Analysis</h2>
      {(() => {
        if (searchMateInPlies != null) {
          const movesToMate = Math.ceil(Math.abs(searchMateInPlies) / 2);
          const fromMy =
            myColor === 'white' ? searchMateInPlies : -searchMateInPlies;
          const cls = fromMy > 0 ? 'positive' : 'negative';
          return (
            <div className={`analysis-eval ${cls}`}>
              {fromMy > 0 ? '+' : '-'}M{movesToMate}
            </div>
          );
        }
        if (!isMultiplayer && searchEvalFromWhite === null) {
          return <div className="analysis-eval">…</div>;
        }
        const cp = myPerspectiveEval;
        const cls = cp > 30 ? 'positive' : cp < -30 ? 'negative' : '';
        return (
          <div className={`analysis-eval ${cls}`}>
            {cp >= 0 ? '+' : ''}
            {(cp / 100).toFixed(2)}
          </div>
        );
      })()}
      {log.moves.length > 0 && (
        <div className="analysis-last">
          Last move:&nbsp;
          <span style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>
            {log.moves[log.moves.length - 1]?.san ??
              `${log.moves[log.moves.length - 1]?.move.from ?? ''}→${log.moves[log.moves.length - 1]?.move.to ?? ''}`}
          </span>
        </div>
      )}
      {/* Sprint 3.4.1 — Review CTA moved out of the board-actions
          row into the Analysis panel, where it reads as the natural
          next step after viewing the eval. */}
      {/* S2.1 — mid-match the local `log` belongs to the previous
          single-player game, so Review here would open the wrong
          game. Finished matches review via the end-of-match dialog. */}
      <button
        type="button"
        className="panel-action-btn"
        onClick={onReview}
        disabled={log.moves.length === 0 || isMultiplayer}
        title={isMultiplayer ? 'Review opens from the end-of-match screen' : undefined}
      >
        <Icon icon={BarChart3} size="md" aria-hidden />
        Review {isMultiplayer ? '(after the match)' : log.moves.length > 0 ? 'this game' : '(no moves yet)'}
      </button>
    </section>
  );
}
