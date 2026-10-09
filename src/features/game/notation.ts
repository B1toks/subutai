import type { MoveClass } from '../../analysis/classify';
import { MATE_SCALE_CPL, pawns } from '../../analysis/lossText';
import type { LoggedMove } from '../../recording/log';
import type { GameMode } from '../../shared/game';

const MOVE_CLASS_MARKER: Record<MoveClass, string> = {
  best: ' ⭐',
  good: '',
  mistake: '?',
  blunder: '??',
  brilliant: '!!',
  checkmate: '#',
};

/**
 * The move log, in two versions.
 *
 * On screen it carries the coaching marks — ⭐ for the engine's own
 * choice, ? and ?? for mistakes, and the "← Better: … (−1.2 pawns)" tail.
 * That is the whole point of the panel and it stays.
 *
 * What goes on the clipboard is the bare log. A pasted log is an INPUT:
 * it gets fed back through the replay importer, mailed to someone,
 * pasted into a chat. The marks survived none of those trips intact —
 * a star that has been through a chat client comes back as U+2B50
 * U+FE0F — and every one of them is noise to whoever reads it. The
 * parser is now forgiving about them either way, but the honest fix is
 * not to ship them where they were never wanted.
 */
export function formatNotation(
  positionLabel: string,
  seed: number,
  moves: readonly LoggedMove[],
  gameMode: GameMode,
  annotate: boolean,
): string {
  const lines: string[] = [
    `[Chess960 "${positionLabel}"]`,
    `[Seed "${seed}"]`,
    '',
  ];
  for (let i = 0; i < moves.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    const white = moves[i];
    const black = moves[i + 1];
    let line = `${moveNum}. ${formatEntry(white, annotate, gameMode)}`;
    if (black) line += `  ${formatEntry(black, annotate, gameMode)}`;
    lines.push(line);
  }
  return lines.join('\n');
}

function formatEntry(entry: LoggedMove, annotate: boolean, gameMode: GameMode): string {
  let san = entry.san;
  if (!san) {
    if (entry.move.kind === 'topologyToggle') {
      const from = entry.topology ?? 'A';
      return `${from}→${from === 'A' ? 'B' : 'A'}`;
    }
    if (entry.move.kind === 'castle') {
      san = entry.move.to && entry.move.to[0] === 'c' ? 'O-O-O' : 'O-O';
    } else {
      san = `${entry.move.from}→${entry.move.to}`;
      if (entry.move.kind === 'promotion' && entry.move.promotion) {
        const pl: Record<string, string> = { queen: 'Q', rook: 'R', bishop: 'B', knight: 'N' };
        san += `=${pl[entry.move.promotion] ?? ''}`;
      }
    }
  }
  if (entry.move.kind !== 'topologyToggle' && entry.topology === 'B') {
    if (!san.includes('@')) san += '@B';
  }
  const a = annotate ? entry.analysis : undefined;
  if (a) {
    const marker = MOVE_CLASS_MARKER[a.classification];
    if (marker) san += marker;
    if (a.classification === 'blunder') {
      // Stage O: collapse the PV to a single move — the chain was hard
      // to parse mid-list. Prefer bestMoveSan when present (it's the
      // first PV move with explicit naming).
      const first = a.bestMoveSan ?? a.bestPvSan?.[0];
      if (first) {
        san += ` ← Better: ${first}`;
      }
      // Append the loss so the player can gauge how marginal the
      // suggestion is, in pawns like the review screen says it (a
      // number of centipawns means nothing to most players). A
      // mate-scale loss is not a number of pawns, so it gets words.
      if (a.cpl >= MATE_SCALE_CPL) {
        san += gameMode === 'roulette' ? ' (hangs the king)' : ' (allows mate)';
      } else if (a.cpl > 0) {
        san += ` (−${pawns(a.cpl)} pawns)`;
      }
    }
  }
  return san;
}
