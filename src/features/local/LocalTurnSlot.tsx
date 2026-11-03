/**
 * V1 — the hot-seat turn indicator, as part of a player's own row.
 *
 * Each player gets one, in the row of buttons in front of them (black's
 * row is drawn upside down, so black reads theirs upright). It lights and
 * says "Your move" for the side that is to play; the other one dims and
 * names whose turn it is instead.
 */
export function LocalTurnSlot({ side, toMove }: { side: 'white' | 'black'; toMove: 'white' | 'black' }) {
  const mine = side === toMove;
  return (
    <span
      className={`local-turn-slot is-${side}${mine ? ' is-to-move' : ''}`}
      role="status"
      aria-live={mine ? 'polite' : undefined}
    >
      <span className="local-turn-lamp" aria-hidden />
      {mine ? 'Your move' : `${toMove === 'white' ? 'White' : 'Black'} to move`}
    </span>
  );
}
