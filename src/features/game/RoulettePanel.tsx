import type { MultiplayerSyncHandle } from '../../components/MultiplayerGameView';
import { useSession } from '../../session/useSession';
import {
  allowedPieceTypesOf,
  boardOf,
  rouletteActionsLeftOf,
  rouletteRevealOf,
  usedRouletteSlotsOf,
} from './boardView';
import { glyphForPiece } from './pieceGlyph';
import { ROULETTE_MAX_ACTIONS, ROULETTE_SLOT_COUNT } from './roulette';

interface RoulettePanelProps {
  isMultiplayer: boolean;
  /** The live match (useOnlineMatch): whose bag it is online. Null outside one. */
  mpSync: MultiplayerSyncHandle | null;
}

/**
 * The roulette panel above the board: the bag landing slot by slot (the
 * session's RouletteReveal), then the bag with its used slots, and the
 * actions left. Everything comes from the session, read as App reads it
 * (boardView.ts: the match's turn while one is played here); online the
 * pieces are drawn in the colour of the side whose turn it is. App
 * renders it in a Roulette game that runs, while a bag is spun or
 * landing, and not while watching. Order does not matter.
 */
export function RoulettePanel({ isMultiplayer, mpSync }: RoulettePanelProps) {
  const state = useSession(boardOf(isMultiplayer));
  const rouletteReveal = useSession(rouletteRevealOf(isMultiplayer));
  const allowedPieceTypes = useSession(allowedPieceTypesOf(isMultiplayer));
  const usedRouletteSlots = useSession(usedRouletteSlotsOf(isMultiplayer));
  const rouletteActionsLeft = useSession(rouletteActionsLeftOf(isMultiplayer));
  return (
    <div className="roulette-panel">
      <div className="roulette-display">
        {rouletteReveal ? (
          rouletteReveal.slots.map((t, i) => {
            const owner: 'white' | 'black' = isMultiplayer && mpSync
              ? (mpSync.isMyTurn
                  ? mpSync.myColor
                  : (mpSync.myColor === 'white' ? 'black' : 'white'))
              : state.sideToMove;
            return i < rouletteReveal.shown ? (
              <span key={i} className={`roulette-face roulette-face-${t} roulette-face-landed`}>
                <span className={`piece piece-${owner}`}>{glyphForPiece(owner, t)}</span>
              </span>
            ) : (
              <span key={i} className="roulette-face roulette-face-rolling">?</span>
            );
          })
        ) : allowedPieceTypes ? (
          allowedPieceTypes.map((t, i) => {
            const isUsed = usedRouletteSlots.includes(i);
            // Sprint 4.0 — render the piece in the *turn-owner's*
            // colour, not in state.sideToMove. During action 2 of
            // an MP roulette turn the local engine flips
            // sideToMove only on the active client (Q.D.3 override
            // in the `state` IIFE above); on the opposite client
            // sideToMove still reads as the just-flipped value,
            // so the bag visualised in the wrong colour. Deriving
            // owner from mpSync.isMyTurn + myColor keeps both
            // clients in sync.
            const rouletteOwner: 'white' | 'black' = isMultiplayer && mpSync
              ? (mpSync.isMyTurn
                  ? mpSync.myColor
                  : (mpSync.myColor === 'white' ? 'black' : 'white'))
              : state.sideToMove;
            return (
              <span
                key={i}
                className={`roulette-face roulette-face-${t}${isUsed ? ' slot-used' : ''}`}
              >
                <span className={`piece piece-${rouletteOwner}`}>
                  {glyphForPiece(rouletteOwner, t)}
                </span>
              </span>
            );
          })
        ) : (
          Array.from({ length: ROULETTE_SLOT_COUNT }, (_, i) => (
            <span key={i} className="roulette-face roulette-face-rolling">?</span>
          ))
        )}
      </div>

      {allowedPieceTypes && !rouletteReveal && (
        <div className="roulette-actions" aria-label="Actions remaining">
          <span className="roulette-actions-label">Actions:</span>
          {Array.from({ length: ROULETTE_MAX_ACTIONS }, (_, i) => (
            <span
              key={i}
              className={`roulette-action-dot${i < rouletteActionsLeft ? ' active' : ' spent'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
