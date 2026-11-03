import { Eye, Flag, Handshake, RotateCw } from 'lucide-react';
import { Icon } from '../../components/Icon';
import type { Color, TopologyState } from '../../engine';
import { useSession } from '../../session/useSession';
import type { DrawOfferBlock } from '../../utils/drawOffer';
import { DrawOfferPrompt } from '../game/DrawOfferPrompt';
import { drawOfferTitle } from '../game/drawOfferTitle';
import { LocalTurnSlot } from './LocalTurnSlot';

interface LocalTopActionsProps {
  /** White has offered a draw and black is to answer it (App). */
  localBlackAnswers: boolean;
  /** Why black cannot offer a draw now, or null (App). */
  localBlackBlock: DrawOfferBlock | null;
  answerLocalDraw: (side: Color, accept: boolean) => void;
  requestResign: (side?: Color) => void;
  offerLocalDraw: (side: Color) => void;
  /** The rotation preview lock (App state). */
  previewLocked: boolean;
  setPreviewLocked: (locked: boolean) => void;
  setLockedPreviewTopology: (topology: TopologyState | null) => void;
  /** The Rotate button pulses to suggest a rotation (useRotateHint). */
  encourageRotate: boolean;
  canRotate: boolean;
  handleRotate: () => void;
}

/**
 * Black's row in a hot-seat game, drawn above the board and turned 180°
 * so the player sitting opposite reads it upright (Sprint 4.2). It mirrors
 * the part of the main action row that matters in hot-seat: resign, offer
 * a draw, preview the rotation, rotate. A draw offer made to black takes
 * the place of black's turn chip and Offer button until black answers it
 * or a move retires it; the rest of the row stays, so black can still
 * resign, or rotate if it is black's turn. Hot-seat is never online, so the
 * board and the log are the solo session's. App renders it while a
 * hot-seat game runs. Order does not matter.
 */
export function LocalTopActions({
  localBlackAnswers,
  localBlackBlock,
  answerLocalDraw,
  requestResign,
  offerLocalDraw,
  previewLocked,
  setPreviewLocked,
  setLockedPreviewTopology,
  encourageRotate,
  canRotate,
  handleRotate,
}: LocalTopActionsProps) {
  const state = useSession((s) => s.board);
  const log = useSession((s) => s.log);
  return (
    <div
      className="local-actions local-actions-top"
      aria-hidden={state.sideToMove !== 'black' && !localBlackAnswers}
    >
      {localBlackAnswers ? (
        <DrawOfferPrompt
          text="White offers a draw"
          onAnswer={(accept) => answerLocalDraw('black', accept)}
        />
      ) : (
        <LocalTurnSlot side="black" toMove={state.sideToMove} />
      )}
      <button
        type="button"
        className="action-btn resign-btn"
        onClick={() => requestResign('black')}
        disabled={log.moves.length === 0}
        aria-label="Resign (black)"
        title="Resign"
      >
        <Icon icon={Flag} size="md" aria-hidden />
      </button>
      {!localBlackAnswers && (
        <button
          type="button"
          className={`action-btn draw-offer-btn${localBlackBlock === 'offered' ? ' is-pending' : ''}`}
          onClick={() => offerLocalDraw('black')}
          disabled={localBlackBlock !== null}
          aria-label="Offer a draw (black)"
          title={drawOfferTitle(localBlackBlock, 'White')}
        >
          <Icon icon={Handshake} size="md" aria-hidden />
        </button>
      )}
      <button
        type="button"
        className={`action-btn preview-btn${previewLocked ? ' active' : ''}`}
        onClick={() => {
          if (previewLocked) {
            setPreviewLocked(false);
            setLockedPreviewTopology(null);
          } else {
            setPreviewLocked(true);
            setLockedPreviewTopology(state.topologyState === 'A' ? 'B' : 'A');
          }
        }}
        aria-label={previewLocked ? 'Unlock rotation preview' : 'Preview rotation'}
        title={previewLocked ? 'Unlock preview' : 'Preview rotation'}
      >
        <Icon icon={Eye} size="md" aria-hidden />
      </button>
      <button
        type="button"
        className={`rotate-btn-icon${encourageRotate && canRotate && state.sideToMove === 'black' ? ' is-hint-pulsing' : ''}`}
        onClick={handleRotate}
        // Black's own move only: handleRotate rotates for the side to
        // move, and this row is lit on white's turn too while black
        // has a draw offer to answer.
        disabled={!canRotate || state.sideToMove !== 'black'}
        aria-label={`Rotate ${state.topologyState} to ${state.topologyState === 'A' ? 'B' : 'A'}`}
        title="Rotate board"
      >
        <Icon icon={RotateCw} size="md" aria-hidden />
        <span className="rotate-label-text" aria-hidden>
          {state.topologyState}{' → '}{state.topologyState === 'A' ? 'B' : 'A'}
        </span>
      </button>
    </div>
  );
}
