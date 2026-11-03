/**
 * The evaluation bar beside the board: my side's share of the position,
 * filled from the bottom, with the score (or mate distance) on the other
 * side. Dumb on purpose: App passes the score already in my perspective
 * (eval-bar.css). Order does not matter: it reads only its props.
 */
export function EvalBar({
  evalCp,
  mateInPlies,
  isPending,
}: {
  /** VIEWER-perspective centipawn score. Positive = "I'm winning". App
   *  inverts this for the black seat before passing it in (T5) — keeps
   *  this component dumb: always fill the bottom (my-side) of the bar. */
  evalCp: number;
  mateInPlies: number | null;
  /** True while we're showing the static-eval fallback waiting on the worker. */
  isPending: boolean;
}) {
  const isMate = mateInPlies !== null;
  let mySidePercent: number;
  let display: string;
  if (isMate) {
    // Snap to the winning edge so the bar visually screams "the game is
    // ending" — bypass the smooth tanh curve.
    mySidePercent = evalCp > 0 ? 95 : 5;
    const sign = evalCp > 0 ? '' : '−';
    const moves = Math.ceil((mateInPlies as number) / 2);
    display = moves <= 0 ? `${sign}#` : `${sign}M${moves}`;
  } else {
    // 50% baseline + tanh-shaped scale so big advantages don't peg the bar
    // to 0/100 and tiny ones still register. Clamp so the loser always
    // shows a sliver — fully empty looks broken.
    const t = Math.tanh(evalCp / 400);
    mySidePercent = Math.max(5, Math.min(95, 50 + t * 45));
    display = `${evalCp >= 0 ? '+' : '−'}${(Math.abs(evalCp) / 100).toFixed(1)}`;
  }
  // Text sits on the side opposite to my fill so it stays legible.
  const textOnBottom = mySidePercent < 50;
  return (
    <div
      className={`eval-bar${isMate ? ' is-mate' : ''}${isPending ? ' is-pending' : ''}`}
      aria-label={`Evaluation ${display}`}
    >
      <div className="eval-bar-white" style={{ height: `${mySidePercent}%` }} />
      <span
        className={`eval-bar-text${textOnBottom ? ' eval-bar-text-bottom' : ' eval-bar-text-top'}`}
      >
        {display}
      </span>
    </div>
  );
}
