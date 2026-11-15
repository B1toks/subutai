import type { User } from 'firebase/auth';
import { BOT_STRENGTH_LABEL, type BotStrength } from '../../ai/agents';
import { GameSummary } from '../../components/GameSummary';
import type { GameMode } from '../../shared/game';
import type { useGameResult } from './useGameResult';

interface SoloSummaryProps {
  /** The finished game and its save (useGameResult). */
  result: ReturnType<typeof useGameResult>;
  /** The game's 960 code, as the chip shows it (App's positionLabel). */
  positionLabel: string;
  user: User | null;
  displayName: string | null;
  gameMode: GameMode;
  botLevel: BotStrength;
  startNewGame: () => void;
}

/**
 * The summary of a finished solo game, as App rendered it: the points,
 * the save's progress, why the game is not ranked if it is not, Close and
 * Play again. Nothing while there is no summary to show. App still holds
 * it back while the endgame scene plays.
 */
export function SoloSummary({
  result,
  positionLabel,
  user,
  displayName,
  gameMode,
  botLevel,
  startNewGame,
}: SoloSummaryProps) {
  const { summaryOpen, lastGamePoints, gameOutcome, lastGameImported, lastGameResumed, setSummaryOpen } = result;
  if (!summaryOpen || !lastGamePoints || !gameOutcome) return null;
  return (
    <GameSummary
      points={lastGamePoints}
      outcome={gameOutcome}
      personalBest={result.personalBest}
      isNewPersonalBest={result.isNewBest}
      currentRank={result.currentRank}
      saving={result.savingGame}
      saveError={result.saveError}
      chess960Id={positionLabel}
      gameId={result.lastGameId}
      playerId={user?.uid ?? null}
      playerName={displayName}
      durationMs={result.lastGameDurationMs ?? undefined}
      gameMode={gameMode}
      uncountedReason={
        lastGameImported
          ? 'Loaded from a replay log. Imported games are never ranked.'
          : lastGameResumed
            ? 'Resumed from a saved position. Only games played from the first move against the Strong bot are ranked.'
            : botLevel !== 'strong'
              ? `Played vs the ${BOT_STRENGTH_LABEL[botLevel]} bot. Only Strong-bot games are ranked.`
              : undefined
      }
      uncountedTitle={lastGameImported ? 'Imported game' : undefined}
      onClose={() => setSummaryOpen(false)}
      onPlayAgain={() => {
        setSummaryOpen(false);
        startNewGame();
      }}
    />
  );
}
