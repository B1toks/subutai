import { useState, useEffect, useRef, useCallback } from 'react';
import { moveVoting, type VoteMode, type VoteRound, type GuessWinner } from '../../integrations/twitch/moveVoting';

/**
 * The Twitch layer as the board sees it: whether the panel is open, the
 * chat's vote mode and live vote round (mirrored from moveVoting), and
 * the cloud of chatters who guessed the streamer's move.
 */
export function useTwitchState() {
  // T3 — Twitch overlay visibility (session-only; channel persists in
  // the panel itself).
  const [showTwitch, setShowTwitch] = useState(false);
  // T6 — mirrored vote mode so the chat-vs-bot scheduler effect below can
  // react when the streamer flips the mode pill in the Twitch panel.
  const [twitchVoteMode, setTwitchVoteMode] = useState<VoteMode>(() => moveVoting.getMode());
  useEffect(() => moveVoting.onMode(setTwitchVoteMode), []);
  // R1 — live vote round mirrored for the on-board variant arrows: each
  // candidate is drawn as a dashed arrow in its own color (matching the
  // !1..!4 slots), growing thicker as its votes come in.
  const [voteRound, setVoteRound] = useState<VoteRound | null>(() => moveVoting.getRound());
  useEffect(() => moveVoting.onRound(setVoteRound), []);
  // R2/R9 — chatters who called the streamer's move burst over the board
  // as a chaotic word-cloud of nicks (no plate): each nick gets a random
  // spot, size, tilt and stagger, floats up and fades. Randomisation is
  // rolled ONCE per reveal here, so re-renders don't reshuffle the cloud.
  const [guessCloud, setGuessCloud] = useState<
    {
      key: string;
      name: string;
      color: string;
      x: number; // % across the board
      y: number;
      size: number; // rem
      rot: number; // deg
      delay: number; // ms
    }[]
  >([]);
  const guessWinnersTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announceGuessWinners = useCallback((winners: GuessWinner[]) => {
    if (winners.length === 0) return;
    const shown = winners.slice(0, 24); // a storm of 24 nicks is plenty
    // Fewer winners read bigger; a packed cloud shrinks so nicks coexist.
    const base = shown.length <= 3 ? 1.7 : shown.length <= 8 ? 1.3 : 1.0;
    setGuessCloud(
      shown.map((w, i) => ({
        key: `${w.nick}-${i}`,
        name: w.displayName,
        color: w.color,
        x: 12 + Math.random() * 76,
        y: 14 + Math.random() * 62,
        size: base * (0.8 + Math.random() * 0.7),
        rot: -14 + Math.random() * 28,
        delay: Math.random() * 450,
      })),
    );
    if (guessWinnersTimer.current) clearTimeout(guessWinnersTimer.current);
    guessWinnersTimer.current = setTimeout(() => setGuessCloud([]), 5_200);
  }, []);
  return { showTwitch, setShowTwitch, twitchVoteMode, voteRound, guessCloud, announceGuessWinners };
}
