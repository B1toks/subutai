import { createPositionFromBackRankKey, isValidChess960Key } from '../engine';
import type { BoardState, Color, Move } from '../engine';
import { applyRotationMove, toggleTopology } from '../engine/auxetic';
import {
  applyMove,
  checkDrawConditions,
  findKing,
  generateLegalMoves,
  isCheckmate,
  isSquareAttacked,
} from '../engine/moves';
import { appendMove, computeSAN, createGameLog, type GameLog } from '../recording/log';
import { NotationParseError, parseMemoryNotation } from './notation';

/** R10 — is a board rotation currently a legal turn (classic rules)?
 *  Mirrors handleRotate's own guard: no back-to-back rotations, and the
 *  toggled board must not leave the mover's king attacked. */
export function rotateIsLegal(bs: BoardState): boolean {
  if (bs.lastMoveWasRotation) return false;
  const toggled = toggleTopology(bs);
  const king = findKing(toggled, bs.sideToMove);
  if (!king) return false;
  const opp: Color = bs.sideToMove === 'white' ? 'black' : 'white';
  return !isSquareAttacked(toggled, king, opp, toggled.topologyState);
}

export interface ImportedReplay {
  readonly config960: string;
  readonly initial: BoardState;
  readonly final: BoardState;
  readonly log: GameLog;
  /** The last entry was a rotation (feeds isCheckmate / draw detection). */
  readonly lastWasRotation: boolean;
}

function colorName(c: Color): string {
  return c === 'white' ? 'White' : 'Black';
}

/** Is the game on this board already over? Same terminals checkGameOver
 *  looks for, per mode. */
function isOver(state: BoardState, lastWasRotation: boolean, roulette: boolean): boolean {
  if (!findKing(state, 'white') || !findKing(state, 'black')) return true;
  if (roulette) return false;
  return isCheckmate(state, lastWasRotation) || checkDrawConditions(state, lastWasRotation) !== null;
}

/**
 * QA-02 — rebuild a pasted log with the rules of a live game.
 *
 * Every entry must be a move the side to move could actually have made
 * there (Load replay used to fall back to the raw token, so a queen could
 * jump pawns, Black could move first and a king could be taken). A
 * rotation is checked exactly like the Rotate button; an @A/@B tag is only
 * a check against where the board is and never switches it. Anything else
 * is a NotationParseError naming the move.
 */
export function replayFromNotation(
  text: string,
  options: { roulette?: boolean; now?: number } = {},
): ImportedReplay {
  const roulette = options.roulette ?? false;
  const now = options.now ?? Date.now();
  const parsed = parseMemoryNotation(text);
  if (!isValidChess960Key(parsed.config960)) {
    throw new NotationParseError(`"${parsed.config960}" is not a valid Chess960 starting rank.`);
  }
  const initial = createPositionFromBackRankKey(parsed.config960);
  let current: BoardState = initial;
  let lastWasRotation = false;
  let log: GameLog = createGameLog(`replay-${now}`, initial, now);

  for (const token of parsed.moves) {
    const where = `Move ${token.moveNumber} ("${token.text}")`;
    if (isOver(current, lastWasRotation, roulette)) {
      throw new NotationParseError(`${where}: the game was already over.`);
    }
    if (token.requiredTopology && token.requiredTopology !== current.topologyState) {
      throw new NotationParseError(
        `${where}: the log says the board is in ${token.requiredTopology}, but it is in ${current.topologyState}.`,
      );
    }

    const mv = token.move;
    // R-1 — a Roulette turn is up to two actions by the SAME side, and the
    // log does not say who acted (QA-08), so plain alternation refuses the
    // second action of every turn. The piece being moved says whose action
    // it is; the live game's own clamp puts sideToMove back to the mover
    // between the two actions in the same way. The first entry is not
    // corrected: White opens, whatever the piece. Rotations keep the
    // alternation.
    if (roulette && log.moves.length > 0 && mv.kind !== 'topologyToggle' && mv.from) {
      const mover = current.pieces[mv.from]?.color;
      if (mover && mover !== current.sideToMove) current = { ...current, sideToMove: mover };
    }
    let played: Move;
    if (mv.kind === 'topologyToggle') {
      if (token.rotationFrom && token.rotationFrom !== current.topologyState) {
        throw new NotationParseError(
          `${where}: the board is in ${current.topologyState}, so it cannot rotate from ${token.rotationFrom}.`,
        );
      }
      if (current.lastMoveWasRotation) {
        throw new NotationParseError(`${where}: two rotations in a row are not allowed.`);
      }
      if (!roulette && !rotateIsLegal(current)) {
        throw new NotationParseError(`${where}: rotating here would leave the king in check.`);
      }
      played = mv;
    } else {
      const legal = generateLegalMoves(current, { allowSelfCheck: roulette });
      let found: Move | undefined;
      if (mv.kind === 'castle') {
        const targetFile = token.castleSide === 'queen' ? 'c' : 'g';
        const castleTo = (ms: Move[]) =>
          ms.find((m) => m.kind === 'castle' && m.to !== undefined && m.to[0] === targetFile);
        found = castleTo(legal);
        // R-1 — a castle token names no piece, so in Roulette, as the second
        // action of a turn, it belongs to whichever side can castle there.
        if (!found && roulette && log.moves.length > 0) {
          const other: Color = current.sideToMove === 'white' ? 'black' : 'white';
          const flipped = { ...current, sideToMove: other };
          const flippedLegal = generateLegalMoves(flipped, { allowSelfCheck: true });
          found = castleTo(flippedLegal);
          if (found) current = flipped;
        }
      } else {
        const piece = mv.from ? current.pieces[mv.from] : undefined;
        if (piece && piece.color !== current.sideToMove) {
          throw new NotationParseError(
            `${where}: it is ${colorName(current.sideToMove)}'s turn, but ${mv.from} holds a ${piece.color} piece.`,
          );
        }
        const pieceMatches = !token.piece || piece?.type === token.piece;
        const same = (m: Move) =>
          m.from === mv.from && m.to === mv.to && (!mv.promotion || m.promotion === mv.promotion);
        // A king move written as squares can also be a castle; the plain
        // move wins when both exist, as it always did.
        found = pieceMatches
          ? legal.find((m) => m.kind !== 'castle' && same(m)) ?? legal.find(same)
          : undefined;
      }
      if (!found) {
        throw new NotationParseError(`${where}: not a legal move in this position.`);
      }
      played = found;
    }

    const san = computeSAN(current, played);
    log = appendMove(log, played, san, current.topologyState);
    lastWasRotation = played.kind === 'topologyToggle';
    current = lastWasRotation ? applyRotationMove(current) : applyMove(current, played);
  }

  return { config960: parsed.config960, initial, final: current, log, lastWasRotation };
}
