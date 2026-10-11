// What the coach says on the board: the nudges in a losing position and
// the two one-shot tips, shown as toasts.

/* R5 — encouragement in a losing position. When the human (white) has
 * been meaningfully behind for a couple of moves, drop a supportive nudge
 * instead of letting them spiral into a resign. Rotate-flavoured lines
 * fire only when a board rotate is actually available and also pulse the
 * Rotate button — in this variant a single rotate can swing the eval hard.
 * Gated behind the coaching-tools switch and rate-limited. */
export const ENCOURAGE_GENERIC = [
  "Don't resign, keep playing. One slip from the bot and you're right back in it.",
  'Hang in there: a single strong move can turn this whole game around.',
  "You're behind, not beaten. Make the bot earn every square.",
];
export const ENCOURAGE_ROTATE = [
  // R15 data: a rotate swings the eval hard but usually AGAINST the rotator
  // (mean -277cp for the rotating side). Sell it as honest chaos, and always
  // pair it with the re-check habit.
  'Tough spot? A rotate shakes up the whole position. Just re-check your pieces right after.',
  'Feeling stuck? Rotate scrambles the game for both sides. Chaos favours the prepared.',
];

/* R15 step 4-lite — two data-driven coaching beats.
 * The labelled human games say: median FIRST blunder lands on move 4 (92 of
 * 98 inside moves 1-10), and 25 of 98 first blunders come immediately after
 * the player's OWN rotation. Two one-shot-per-game nudges target exactly
 * those windows. Both ride the coaching-tools gate like the R5 nudges. */
export const EARLY_GAME_TIP =
  'Heads up: most games here are decided in the first 10 moves. Slow down and check captures.';
export const ROTATE_AFTERMATH_TIP =
  'You rotated and the whole board changed with you. Re-check your pieces before moving on.';
