import type { MultiplayerSyncHandle } from '../../components/MultiplayerGameView';
import type { Color } from '../../engine';
import type { GameLog } from '../../recording/log';
import type { GameStatus } from '../../shared/game';
import { drawOfferBlock, standingDrawOffer, type DrawOfferBlock, type DrawTable } from '../../utils/drawOffer';

/** A row's draw offer: white's seat in hot-seat, mine online (BoardActions). */
export interface RowDraw {
  open: boolean;
  block: DrawOfferBlock | null;
  answers: boolean;
  opponent: string;
  busy: boolean;
  offer: () => void;
  answer: (accept: boolean) => void;
}

interface DrawRowsArgs {
  isLocalMode: boolean;
  isMultiplayer: boolean;
  mpSync: MultiplayerSyncHandle | null;
  gameStatus: GameStatus;
  log: GameLog;
  /** The hot-seat game's offers, and its two actions (useResignAndDraw). */
  localDrawTable: () => DrawTable<Color>;
  offerLocalDraw: (side: Color) => void;
  answerLocalDraw: (side: Color, accept: boolean) => void;
}

/**
 * What each player's row shows of a draw offer, worked out as App did on
 * every render: in hot-seat, whose row the answer prompt replaces and why
 * a seat cannot offer; the bottom row's offer, white's seat in hot-seat or
 * mine online (the match doc holds the offer, the sync hook my lock). A
 * plain function of its arguments.
 */
export function drawRows({
  isLocalMode,
  isMultiplayer,
  mpSync,
  gameStatus,
  log,
  localDrawTable,
  offerLocalDraw,
  answerLocalDraw,
}: DrawRowsArgs) {
  // Hot-seat draw offers: what each seat's button says, and whose row the
  // answer prompt replaces while an offer stands. Only while the game
  // runs: an accepted offer is still "standing" on the final ply.
  const localDrawOpen = isLocalMode && gameStatus === 'active';
  const localStandingDraw = localDrawOpen
    ? standingDrawOffer(localDrawTable().offer, log.moves.length)
    : null;
  const localWhiteAnswers = localStandingDraw?.by === 'black';
  const localBlackAnswers = localStandingDraw?.by === 'white';
  const localWhiteBlock = localDrawOpen ? drawOfferBlock(localDrawTable(), 'white', log.moves.length) : null;
  const localBlackBlock = localDrawOpen ? drawOfferBlock(localDrawTable(), 'black', log.moves.length) : null;

  // The draw offer of the bottom row: white's seat in hot-seat, my own
  // seat online (the match doc holds the offer, the hook my lock).
  const mpDrawOpen =
    isMultiplayer && !!mpSync && mpSync.matchState.status === 'active' && !mpSync.matchState.outcome;
  const mpPlies = mpSync?.matchState.log.moves.length ?? 0;
  const mpStandingDraw = mpDrawOpen ? standingDrawOffer(mpSync!.drawTable.offer, mpPlies) : null;
  const rowDraw: RowDraw | null = isLocalMode
    ? {
        open: localDrawOpen,
        block: localWhiteBlock,
        answers: localWhiteAnswers,
        opponent: 'Black',
        busy: false,
        offer: () => offerLocalDraw('white'),
        answer: (accept) => answerLocalDraw('white', accept),
      }
    : isMultiplayer && mpSync
      ? {
          open: mpDrawOpen,
          block: mpDrawOpen ? drawOfferBlock(mpSync.drawTable, mpSync.myUid, mpPlies) : null,
          answers: !!mpStandingDraw && mpStandingDraw.by !== mpSync.myUid,
          opponent: mpSync.opponentDisplayName,
          busy: mpSync.drawBusy,
          offer: () => void mpSync.offerDraw(),
          answer: (accept) => void mpSync.answerDraw(accept),
        }
      : null;
  return { localBlackAnswers, localBlackBlock, rowDraw };
}
