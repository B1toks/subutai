import { MilestoneModal } from '../../components/MilestoneModal';
import { logOf } from '../game/boardView';
import { useSession } from '../../session/useSession';
import type { useGameResult } from './useGameResult';

interface MilestoneDialogProps {
  /** Whether the 50-move dialog is up (useGameResult). */
  result: ReturnType<typeof useGameResult>;
  isMultiplayer: boolean;
  /** Opens the resign confirmation (useResignAndDraw). */
  requestResign: () => void;
}

/**
 * The 50-move dialog, as App rendered it: keep playing, or go to the
 * resign confirmation. The move count comes from the session. Nothing
 * while the dialog is not up.
 */
export function MilestoneDialog({ result, isMultiplayer, requestResign }: MilestoneDialogProps) {
  const log = useSession(logOf(isMultiplayer));
  const { showMilestoneModal, setShowMilestoneModal } = result;
  if (!showMilestoneModal) return null;
  return (
    <MilestoneModal
      fullMoves={Math.floor(log.moves.length / 2)}
      currentScoreEstimate={Math.floor(log.moves.length / 2) * 5}
      onKeepPlaying={() => setShowMilestoneModal(false)}
      onResignNow={() => {
        setShowMilestoneModal(false);
        // The modal already explained the consequence — go straight to
        // the resign-confirmation dialog so the player can change their
        // mind without an extra click.
        requestResign();
      }}
    />
  );
}
