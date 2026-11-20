import { useRef, useEffect } from 'react';
import { standingDrawOffer } from '../../utils/drawOffer';
import type { MultiplayerSyncHandle } from './useMultiplayerSync';
import type { ToastContextValue } from '../../components/Toast';

interface UseDrawDeclinedToastArgs {
  isMultiplayer: boolean;
  mpSync: MultiplayerSyncHandle | null;
  toast: ToastContextValue;
}

/**
 * Online: tells the player when the opponent declines their draw offer.
 * Reads the match doc's drawOffer only; it writes nothing.
 */
export function useDrawDeclinedToast({ isMultiplayer, mpSync, toast }: UseDrawDeclinedToastArgs) {
  // Online: tell me when my draw offer is declined. A decline marks the
  // offer `declined` with the log as it was; a move retires the offer too,
  // but then the log has grown, and an accept ends the match.
  const mpMyDrawOfferRef = useRef<{ code: string; atPly: number } | null>(null);
  useEffect(() => {
    if (!isMultiplayer || !mpSync) return;
    const m = mpSync.matchState;
    const standing = standingDrawOffer(m.drawOffer, m.log.moves.length);
    if (standing?.by === mpSync.myUid) {
      mpMyDrawOfferRef.current = { code: m.code, atPly: standing.atPly };
      return;
    }
    const mine = mpMyDrawOfferRef.current;
    mpMyDrawOfferRef.current = null;
    if (
      mine &&
      mine.code === m.code &&
      m.status === 'active' &&
      !m.outcome &&
      m.drawOffer?.declined &&
      m.drawOffer.atPly === mine.atPly &&
      m.log.moves.length === mine.atPly
    ) {
      toast.show(`${mpSync.opponentDisplayName} declined the draw.`, 'info', 2400);
    }
  }, [isMultiplayer, mpSync, toast]);
}
