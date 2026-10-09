import type { Color } from '../../engine';
import type { GameOutcome } from '../../analysis/points';
import { HUMAN_COLOR, type GameStatus } from '../../shared/game';

// How a finished solo or hot-seat game reads: who won, the line under the
// board, the result the score and the save use, and how Memory files it.

/**
 * V1 — who won a decisive game, or null if it is not decided or drawn.
 * On a checkmate the mated side is the one to move, so the winner is
 * the other one.
 */
export function winnerOf(status: GameStatus, sideToMove: Color): Color | null {
  if (status === 'checkmate') return sideToMove === 'white' ? 'black' : 'white';
  if (status === 'king_captured_white_wins') return 'white';
  if (status === 'king_captured_black_wins') return 'black';
  if (status === 'timeout_white') return 'black';
  if (status === 'timeout_black') return 'white';
  if (status === 'resigned_white') return 'black';
  if (status === 'resigned_black') return 'white';
  return null;
}

/** The game-over line under the board; null while the game is on. */
export function gameOverText(status: GameStatus, sideToMove: Color): string | null {
  if (status === 'checkmate') {
    const winner = sideToMove === 'white' ? 'Black' : 'White';
    return `Checkmate! ${winner} wins`;
  }
  if (status === 'draw_stalemate') {
    return 'Draw: stalemate';
  }
  if (status === 'draw_material') {
    return 'Draw: insufficient material';
  }
  if (status === 'draw_repetition') {
    return 'Draw: threefold repetition';
  }
  if (status === 'draw_50move') {
    return 'Draw: 50-move rule';
  }
  if (status === 'draw_agreement') {
    return 'Draw by agreement';
  }
  if (status === 'king_captured_white_wins') {
    return 'King captured! White wins';
  }
  if (status === 'king_captured_black_wins') {
    return 'King captured! Black wins';
  }
  if (status === 'timeout_white') {
    return 'White ran out of time. Black wins';
  }
  if (status === 'timeout_black') {
    return 'Black ran out of time. White wins';
  }
  if (status === 'resigned_white') {
    return 'White resigned. Black wins';
  }
  if (status === 'resigned_black') {
    return 'Black resigned. White wins';
  }
  return null;
}

/** A game against the bot as the score and the save see it: the human is
 *  White. Resignation is not here: the resign button finishes the game
 *  itself, as 'human-resign'. */
export function soloOutcome(status: GameStatus, sideToMove: Color): GameOutcome {
  if (status === 'checkmate') {
    return sideToMove === HUMAN_COLOR ? 'ai-win' : 'human-win';
  } else if (status === 'king_captured_black_wins') {
    // Black wins => human (white) lost.
    return 'ai-win';
  } else if (status === 'king_captured_white_wins') {
    return 'human-win';
  } else if (status === 'timeout_white') {
    // V1 — human (white) flagged.
    return 'ai-win';
  } else if (status === 'timeout_black') {
    return 'human-win';
  }
  return 'draw';
}

/** How Memory files the ending of a saved game. */
export function memoryTermination(status: GameStatus): 'checkmate' | 'stalemate' | 'resignation' | 'agreement' {
  const resigned = status === 'resigned_white' || status === 'resigned_black';
  return resigned
    ? 'resignation'
    : status === 'draw_agreement'
      ? 'agreement'
      : status === 'checkmate'
        || status === 'king_captured_white_wins'
        || status === 'king_captured_black_wins'
        || status === 'timeout_white'
        || status === 'timeout_black'
        ? 'checkmate'
        : 'stalemate';
}
