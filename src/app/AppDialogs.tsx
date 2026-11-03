import type { User } from 'firebase/auth';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { NamePicker } from '../components/NamePicker';
import type { Color } from '../engine';

type OpponentMode = 'ai' | 'friend' | 'local';

interface AppDialogsProps {
  /** The player (useAuth): signed in, named, and how to rename. */
  authLoading: boolean;
  user: User | null;
  displayName: string | null;
  setDisplayName: (name: string | null) => void;
  /** The welcome screen and the tour are up (useOnboarding). */
  showWelcome: boolean;
  showTutorial: boolean;
  showNameModal: boolean;
  setShowNameModal: (open: boolean) => void;
  /** Resign asked for, by this side (App), and its confirm. */
  confirmingResign: Color | null;
  setConfirmingResign: (side: Color | null) => void;
  confirmResign: () => void;
  /** Leaving a game in progress, asked by guardLeave (useNavigationGuards). */
  pendingLeave: { title: string; message: string; confirmLabel: string; run: () => void } | null;
  setPendingLeave: (leave: null) => void;
  /** Switching opponent mid-game, and what follows a yes. */
  pendingOpponentChange: OpponentMode | null;
  setPendingOpponentChange: (next: OpponentMode | null) => void;
  applyOpponentChange: (next: OpponentMode) => void;
  startNewGame: () => void;
}

/**
 * The game page's small dialogs: the name prompt (first time, and Change
 * name) and the three confirms (resign, leave a game, switch opponent).
 * Each keeps its own condition, as in App before; this component holds no
 * state and is always mounted where they were, so each dialog mounts and
 * unmounts exactly when it did. Order does not matter.
 */
export function AppDialogs({
  authLoading,
  user,
  displayName,
  setDisplayName,
  showWelcome,
  showTutorial,
  showNameModal,
  setShowNameModal,
  confirmingResign,
  setConfirmingResign,
  confirmResign,
  pendingLeave,
  setPendingLeave,
  pendingOpponentChange,
  setPendingOpponentChange,
  applyOpponentChange,
  startNewGame,
}: AppDialogsProps) {
  return (
    <>
      {/* The name prompt waits its turn behind BOTH the welcome screen and
          the tour. It used to wait only for the welcome screen, so taking
          the "start the tour" button dropped a modal straight on top of
          the first tour step — the field sat over the tooltip and neither
          could be read. The tour teaches; the name is what you pick once
          you have decided to stay, so it comes after. Skipping the tour
          still brings it up immediately. */}
      {!authLoading && user && !displayName && !showWelcome && !showTutorial && (
        <NamePicker
          mode="initial"
          uid={user.uid}
          onComplete={(name) => {
            setDisplayName(name);
          }}
        />
      )}

      {showNameModal && user && displayName && (
        <NamePicker
          mode="change"
          uid={user.uid}
          currentName={displayName}
          onComplete={(name) => {
            setDisplayName(name);
            setShowNameModal(false);
          }}
          onCancel={() => setShowNameModal(false)}
        />
      )}

      {confirmingResign && (
        <ConfirmDialog
          title="Resign this game?"
          message="Resigning only earns half move points and no capture or outcome bonus. Are you sure?"
          confirmLabel="Resign anyway"
          cancelLabel="Cancel"
          danger
          onConfirm={confirmResign}
          onCancel={() => setConfirmingResign(null)}
        />
      )}

      {pendingLeave && (
        <ConfirmDialog
          title={pendingLeave.title}
          message={pendingLeave.message}
          confirmLabel={pendingLeave.confirmLabel}
          cancelLabel="Keep playing"
          danger
          onConfirm={() => {
            const go = pendingLeave.run;
            setPendingLeave(null);
            go();
          }}
          onCancel={() => setPendingLeave(null)}
        />
      )}

      {pendingOpponentChange && (
        <ConfirmDialog
          title="Abandon current game?"
          message="Switching opponent will end the game in progress and start fresh."
          confirmLabel="Abandon game"
          cancelLabel="Keep playing"
          danger
          onConfirm={() => {
            const next = pendingOpponentChange;
            setPendingOpponentChange(null);
            applyOpponentChange(next);
            startNewGame();
          }}
          onCancel={() => setPendingOpponentChange(null)}
        />
      )}
    </>
  );
}
