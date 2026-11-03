import type { Dispatch, SetStateAction } from 'react';
import { AlertTriangle, ArrowRight, Dices, Eye, Flag, GraduationCap, Handshake, Lightbulb, Lock, RotateCw } from 'lucide-react';
import { Icon } from '../../components/Icon';
import { Tooltip } from '../../components/Tooltip';
import type { Color, SquareId, TopologyState } from '../../engine';
import { statusOf } from '../../session/step';
import { useSession } from '../../session/useSession';
import type { DrawOfferBlock } from '../../utils/drawOffer';
import { LocalTurnSlot } from '../local/LocalTurnSlot';
import type { WatchingGame } from '../review/watching';
import {
  allowedPieceTypesOf,
  boardOf,
  firstRouletteSpinDoneOf,
  isRouletteSpinningOf,
  logOf,
  modeOf,
} from './boardView';
import { DrawOfferPrompt } from './DrawOfferPrompt';
import { drawOfferTitle } from './drawOfferTitle';
import type { MaterialBreakdown } from './material';
import { MaterialScore } from './MaterialScore';

interface BoardActionsProps {
  isMultiplayer: boolean;
  isLocalMode: boolean;
  opponentMode: 'ai' | 'friend' | 'local';
  watchingGame: WatchingGame | null;
  /** Whose turn it is from this seat, and whether the bot is thinking (App). */
  currentPlayer: 'human' | 'ai';
  botThinking: boolean;
  /** This row's draw offer: white's in hot-seat, mine online (App). */
  rowDraw: {
    open: boolean;
    block: DrawOfferBlock | null;
    answers: boolean;
    opponent: string;
    busy: boolean;
    offer: () => void;
    answer: (accept: boolean) => void;
  } | null;
  guardLeave: (what: string, destroys: boolean, run: () => void) => void;
  startNewGame: () => void;
  formationLocked: boolean;
  toggleFormationLock: () => void;
  requestResign: (side?: Color) => void;
  /** S2.4 — the coaching group: its switch, the support and threat maps, the hint. */
  helpToolsEnabled: boolean;
  toggleHelpTools: () => void;
  showSupport: boolean;
  setShowSupport: Dispatch<SetStateAction<boolean>>;
  showThreats: boolean;
  setShowThreats: Dispatch<SetStateAction<boolean>>;
  hintMove: { from: SquareId; to: SquareId } | { rotate: true } | null;
  computeHint: () => void;
  /** The rotation preview: hover shows it, a click locks it (App state). */
  previewLocked: boolean;
  setPreviewLocked: (locked: boolean) => void;
  setLockedPreviewTopology: (topology: TopologyState | null) => void;
  setPreviewTopology: (topology: TopologyState | null) => void;
  handleSpinRoulette: () => void;
  canRotate: boolean;
  /** The first-game "Try rotating" bubble (useRotateHint) and the pulse. */
  showRotateHint: boolean;
  encourageRotate: boolean;
  handleRotate: () => void;
  dismissRotateHint: () => void;
  /** The material balance and captures (useMaterial). */
  materialScore: number;
  materialBreakdown: MaterialBreakdown;
}

/**
 * The row under the board: the turn chip or a draw offer to answer, the
 * action buttons (new game, lock the formation, resign, offer a draw, the
 * coaching tools, the rotation preview), the first Roulette spin, Rotate
 * with its first-game bubble, and the material balance. The game's state
 * comes from the session (the match's while one is played here); the
 * buttons' actions and the tool switches are App's. The data-tour targets
 * (coach, preview, rotate) sit on the same buttons as before. Order does
 * not matter.
 */
export function BoardActions({
  isMultiplayer,
  isLocalMode,
  opponentMode,
  watchingGame,
  currentPlayer,
  botThinking,
  rowDraw,
  guardLeave,
  startNewGame,
  formationLocked,
  toggleFormationLock,
  requestResign,
  helpToolsEnabled,
  toggleHelpTools,
  showSupport,
  setShowSupport,
  showThreats,
  setShowThreats,
  hintMove,
  computeHint,
  previewLocked,
  setPreviewLocked,
  setLockedPreviewTopology,
  setPreviewTopology,
  handleSpinRoulette,
  canRotate,
  showRotateHint,
  encourageRotate,
  handleRotate,
  dismissRotateHint,
  materialScore,
  materialBreakdown,
}: BoardActionsProps) {
  const state = useSession(boardOf(isMultiplayer));
  const log = useSession(logOf(isMultiplayer));
  const gameStatus = useSession(statusOf);
  const gameMode = useSession(modeOf(isMultiplayer));
  const allowedPieceTypes = useSession(allowedPieceTypesOf(isMultiplayer));
  const isRouletteSpinning = useSession(isRouletteSpinningOf(isMultiplayer));
  const firstRouletteSpinDone = useSession(firstRouletteSpinDoneOf(isMultiplayer));
  return (
    <div className="board-actions">
      {/* A draw offer made to this row's player (white in hot-seat, me
          online) takes the place of the turn chip (and the Offer
          button), as in black's hot-seat row above. */}
      {rowDraw?.answers ? (
        <DrawOfferPrompt
          text={`${rowDraw.opponent} offers a draw`}
          onAnswer={rowDraw.answer}
          disabled={rowDraw.busy}
        />
      ) : (
        isLocalMode &&
        gameStatus === 'active' && <LocalTurnSlot side="white" toMove={state.sideToMove} />
      )}
      {/* Sprint 3.2.1 \u2014 six icon buttons consolidated into one
          cohesive bar with a single divider between the meta-controls
          (Reset / Lock / Resign) and the in-game toggles (Support /
          Threat / Preview). Lock no longer reads as a stray button \u2014
          it's middle-of-the-row inside the same container. */}
      <div className="action-buttons-group">
        <Tooltip text="New game" side="top">
          <button
            type="button"
            className="action-btn"
            onClick={() => guardLeave('Start a new game', true, startNewGame)}
            aria-label="New game"
          >
            <Icon icon={RotateCw} size="md" aria-hidden />
          </button>
        </Tooltip>
        <Tooltip
          text={formationLocked ? 'Unlock formation (next game random)' : 'Lock formation (keep this 960)'}
          side="top"
        >
          <button
            type="button"
            className={`action-btn${formationLocked ? ' active' : ''}`}
            onClick={toggleFormationLock}
            aria-label={formationLocked ? 'Unlock formation' : 'Lock formation'}
          >
            <Icon icon={Lock} size="md" aria-hidden />
          </button>
        </Tooltip>
        <Tooltip text="Resign \u2014 half points, no bonus" side="top">
          <button
            type="button"
            className="action-btn resign-btn"
            onClick={() => requestResign('white')}
            disabled={!!watchingGame || gameStatus !== 'active' || log.moves.length === 0 || botThinking}
            aria-label="Resign"
          >
            <Icon icon={Flag} size="md" aria-hidden />
          </button>
        </Tooltip>
        {rowDraw && !rowDraw.answers && (
          <Tooltip text={drawOfferTitle(rowDraw.block, rowDraw.opponent)} side="top">
            <button
              type="button"
              className={`action-btn draw-offer-btn${rowDraw.block === 'offered' ? ' is-pending' : ''}`}
              onClick={rowDraw.offer}
              disabled={!rowDraw.open || rowDraw.block !== null || rowDraw.busy}
              aria-label="Offer a draw"
            >
              <Icon icon={Handshake} size="md" aria-hidden />
            </button>
          </Tooltip>
        )}
        {/* Sprint 4.2 — hide threat/support insight tools in local
            2P mode for a cleaner hot-seat UX (one device, two humans
            sharing the screen; coaching arrows are distracting). */}
        {opponentMode !== 'local' && (
          <>
            <span className="action-group-divider" aria-hidden />
            {/* S2.4 — master switch for the coaching group. Off hides
                (and deactivates) support / threat / hint so the row
                reads as plain chess. */}
            <Tooltip
              text={helpToolsEnabled ? 'Hide coaching tools' : 'Show coaching tools (support, threats, hint)'}
              side="top"
            >
              <button
                type="button"
                className={`action-btn${helpToolsEnabled ? ' active' : ''}`}
                onClick={toggleHelpTools}
                data-tour="coach"
                aria-label="Toggle coaching tools"
                aria-pressed={helpToolsEnabled}
              >
                <Icon icon={GraduationCap} size="md" aria-hidden />
              </button>
            </Tooltip>
            {helpToolsEnabled && (
              <>
                <Tooltip text="Support map (who backs whom)" side="top">
                  <button
                    type="button"
                    className={`action-btn${showSupport ? ' active' : ''}`}
                    onClick={() => setShowSupport((v) => !v)}
                    aria-label="Toggle support map"
                    aria-pressed={showSupport}
                  >
                    <Icon icon={ArrowRight} size="md" aria-hidden />
                  </button>
                </Tooltip>
                <Tooltip text="Threat map" side="top">
                  <button
                    type="button"
                    className={`action-btn${showThreats ? ' active' : ''}`}
                    onClick={() => setShowThreats((v) => !v)}
                    aria-label="Toggle threat map"
                    aria-pressed={showThreats}
                  >
                    <Icon icon={AlertTriangle} size="md" aria-hidden />
                  </button>
                </Tooltip>
                {/* V1 — no engine hints against another person. The
                    support and threat maps read the position you can
                    already see; the hint runs a search and hands you a
                    move, which in an online game is just an engine at
                    the board. Hot-seat keeps it: both players share the
                    screen and can see it being used. */}
                {gameMode === 'classic' && !isMultiplayer && (
                  <Tooltip text="Hint: engine suggests a move" side="top">
                    <button
                      type="button"
                      className={`action-btn${hintMove ? ' active' : ''}`}
                      onClick={computeHint}
                      disabled={currentPlayer !== 'human' || gameStatus !== 'active' || !!watchingGame}
                      aria-label="Show a hint"
                    >
                      <Icon icon={Lightbulb} size="md" aria-hidden />
                    </button>
                  </Tooltip>
                )}
              </>
            )}
          </>
        )}
        <Tooltip
          text={previewLocked ? 'Unlock rotation preview' : 'Preview rotation (click locks it)'}
          side="top"
        >
          <button
            type="button"
            className={`action-btn preview-btn${previewLocked ? ' active' : ''}`}
            disabled={currentPlayer !== 'human'}
            data-tour="preview"
            aria-label={previewLocked ? 'Unlock rotation preview' : 'Preview rotation'}
          onClick={() => {
            if (currentPlayer !== 'human') return;
            if (previewLocked) {
              setPreviewLocked(false);
              setLockedPreviewTopology(null);
            } else {
              setPreviewLocked(true);
              setLockedPreviewTopology(state.topologyState === 'A' ? 'B' : 'A');
            }
          }}
          onPointerEnter={() => {
            if (currentPlayer === 'human' && !previewLocked) {
              setPreviewTopology(state.topologyState === 'A' ? 'B' : 'A');
            }
          }}
          onPointerLeave={() => {
            if (!previewLocked) setPreviewTopology(null);
          }}
        >
          <Icon icon={Eye} size="md" aria-hidden />
        </button>
        </Tooltip>
      </div>

      {/* Sprint 2.7.1 \u2014 compact spin button replaces the old wide
          roulette banner. Lives inline among the board-actions row.
          Sprint 3.2 \u2014 the auto-spin effects (solo + MP) take over
          after the first manual spin, so before that the button is
          briefly visible every turn and immediately unmounted by
          auto-spin ~500ms later, producing a flicker + layout shift.
          Gating on `!firstRouletteSpinDone` means the button is only
          rendered for the literal first turn of the game (where it
          actually needs to be clicked); afterwards auto-spin handles
          every subsequent turn without the button mounting at all. */}
      {gameMode === 'roulette' &&
        gameStatus === 'active' &&
        !watchingGame &&
        allowedPieceTypes === null &&
        !isRouletteSpinning &&
        currentPlayer === 'human' &&
        !firstRouletteSpinDone && (
        <div className="action-group">
          <button
            type="button"
            className="spin-roulette-btn-compact"
            onClick={handleSpinRoulette}
            title="Spin the roulette for this turn"
          >
            <Icon icon={Dices} size="md" aria-hidden /> Spin
          </button>
        </div>
      )}

      <Tooltip
        text={`Rotate topology ${state.topologyState} → ${state.topologyState === 'A' ? 'B' : 'A'}`}
        side="top"
        disabled={!canRotate}
      >
        <button
          type="button"
          className={`rotate-btn-icon${(showRotateHint || (hintMove && 'rotate' in hintMove) || encourageRotate) && canRotate ? ' is-hint-pulsing' : ''}`}
          onClick={handleRotate}
          disabled={!canRotate}
          data-tour="rotate"
          aria-label={`Rotate topology ${state.topologyState} → ${state.topologyState === 'A' ? 'B' : 'A'}`}
        >
          <Icon icon={RotateCw} size="md" aria-hidden />
          <span className="rotate-label-text" aria-hidden>
            {state.topologyState}{' → '}{state.topologyState === 'A' ? 'B' : 'A'}
          </span>
          {/* Not over a draw offer: on a phone the row wraps and the
              bubble would sit on the Accept / Decline card. */}
          {showRotateHint && canRotate && !rowDraw?.answers && (
            <span className="rotate-hint-tooltip" role="status">
              <span>Try rotating the board! +15 pts, +25 more if it sets up a capture</span>
              {/* span-as-button: a real <button> here would nest inside
                  the rotate <button>, which is invalid HTML (React 19
                  logs hydration errors for it). */}
              <span
                role="button"
                tabIndex={0}
                className="rotate-hint-dismiss"
                aria-label="Dismiss hint"
                onClick={(e) => {
                  e.stopPropagation();
                  dismissRotateHint();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    dismissRotateHint();
                  }
                }}
              >
                ×
              </span>
            </span>
          )}
        </button>
      </Tooltip>
      <MaterialScore materialScore={materialScore} materialBreakdown={materialBreakdown} />
    </div>
  );
}
