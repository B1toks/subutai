/**
 * T4 — per-move voting rounds.
 *
 * Two modes share one pipeline:
 *   predict — the engine picks its move as usual; the move plus 3
 *     decoys go on screen as !1..!4 for a vote window, then the real
 *     move is revealed and played. Correct guess = +1 point.
 *   chat — "chat plays vs the streamer": 4 random legal moves go up,
 *     the top-voted one IS the AI's move (tie → random among tied, no
 *     votes → random). Voters of the winning option get +1.
 *
 * The store is a singleton living outside React: App's AI scheduler
 * awaits `gate()`, the Twitch panel renders rounds via subscriptions,
 * and the chat client feeds votes in. Match-long scores power the
 * end-of-game leaderboard (result calls from predictions.ts add +3).
 */

import type { BoardState, Move } from '../engine';
import { computeSAN } from '../recording/log';
import { twitchChat, type TwitchChatMessage } from './chat';

export type VoteMode = 'off' | 'predict' | 'chat';

export interface VoteCandidate {
  move: Move;
  san: string;
}

export interface VoteRound {
  mode: Exclude<VoteMode, 'off'>;
  candidates: VoteCandidate[];
  /** Vote counts per candidate index (live). */
  counts: number[];
  endsAt: number;
  /** Set when the round resolves: the played candidate. */
  revealIdx: number | null;
}

export interface ViewerScore {
  nick: string;
  displayName: string;
  color: string;
  points: number;
}

const VOTE_WINDOW_MS = 15_000;
const REVEAL_HOLD_MS = 3_500;

type RoundCb = (round: VoteRound | null) => void;
type ScoresCb = (scores: ViewerScore[]) => void;

class MoveVotingStore {
  private mode: VoteMode = 'off';
  private round: VoteRound | null = null;
  /** nick → candidate idx for the live round. */
  private votes = new Map<string, number>();
  private voterMeta = new Map<string, { displayName: string; color: string }>();
  private scores = new Map<string, ViewerScore>();
  private roundCbs: RoundCb[] = [];
  private scoresCbs: ScoresCb[] = [];
  private clearTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Votes arrive through the same anonymous chat connection the
    // panel displays. Only counted while a round is open.
    twitchChat.onMessage((msg) => this.ingest(msg));
  }

  getMode(): VoteMode {
    return this.mode;
  }

  setMode(mode: VoteMode) {
    this.mode = mode;
  }

  getRound(): VoteRound | null {
    return this.round;
  }

  getScores(): ViewerScore[] {
    return [...this.scores.values()].sort((a, b) => b.points - a.points);
  }

  /** New match — wipe the per-match leaderboard. */
  resetScores() {
    this.scores.clear();
    this.emitScores();
  }

  /** Result-call bonus (predictions.ts winners): +3 each. */
  awardResultCall(winners: { nick: string; displayName: string; color: string }[]) {
    for (const w of winners) this.addPoints(w.nick, w.displayName, w.color, 3);
    this.emitScores();
  }

  onRound(cb: RoundCb): () => void {
    this.roundCbs.push(cb);
    return () => {
      this.roundCbs = this.roundCbs.filter((c) => c !== cb);
    };
  }

  onScores(cb: ScoresCb): () => void {
    this.scoresCbs.push(cb);
    return () => {
      this.scoresCbs = this.scoresCbs.filter((c) => c !== cb);
    };
  }

  /**
   * AI-move gate. Returns the move to actually play — immediately when
   * voting is off/unavailable, otherwise after a vote round.
   */
  async gate(boardState: BoardState, legalMoves: Move[], chosenMove: Move): Promise<Move> {
    if (this.mode === 'off') return chosenMove;
    if (twitchChat.getStatus() !== 'connected') return chosenMove;
    if (this.round) return chosenMove; // shouldn't overlap — bail safely
    const pieceMoves = legalMoves.filter((m) => m.from && m.to);
    if (pieceMoves.length < 2) return chosenMove;

    const mode = this.mode;
    let candidates: VoteCandidate[];
    let revealIdx: number; // predict: where the real move hides

    if (mode === 'predict') {
      const decoys = pickRandom(
        pieceMoves.filter((m) => !sameMove(m, chosenMove)),
        3,
      );
      const all = shuffle([chosenMove, ...decoys]);
      candidates = all.map((m) => ({ move: m, san: computeSAN(boardState, m) }));
      revealIdx = all.findIndex((m) => sameMove(m, chosenMove));
    } else {
      const picks = pickRandom(pieceMoves, Math.min(4, pieceMoves.length));
      candidates = picks.map((m) => ({ move: m, san: computeSAN(boardState, m) }));
      revealIdx = -1; // decided by the vote
    }

    this.votes.clear();
    this.voterMeta.clear();
    this.round = {
      mode,
      candidates,
      counts: candidates.map(() => 0),
      endsAt: Date.now() + VOTE_WINDOW_MS,
      revealIdx: null,
    };
    this.emitRound();

    await new Promise((r) => setTimeout(r, VOTE_WINDOW_MS));

    const round = this.round;
    if (!round) return chosenMove; // disconnected mid-round

    let finalIdx: number;
    if (mode === 'predict') {
      finalIdx = revealIdx;
    } else {
      const max = Math.max(...round.counts);
      const top = round.counts
        .map((c, i) => ({ c, i }))
        .filter((x) => x.c === max && max > 0)
        .map((x) => x.i);
      finalIdx =
        top.length > 0
          ? top[Math.floor(Math.random() * top.length)]
          : Math.floor(Math.random() * round.candidates.length);
    }

    // Award the voters who picked the played move.
    for (const [nick, idx] of this.votes) {
      if (idx === finalIdx) {
        const meta = this.voterMeta.get(nick);
        this.addPoints(nick, meta?.displayName ?? nick, meta?.color ?? '', 1);
      }
    }
    this.emitScores();

    this.round = { ...round, revealIdx: finalIdx };
    this.emitRound();
    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => {
      this.round = null;
      this.emitRound();
    }, REVEAL_HOLD_MS);

    return candidates[finalIdx].move;
  }

  private ingest(msg: TwitchChatMessage) {
    const round = this.round;
    if (!round || round.revealIdx !== null) return;
    const m = msg.text.trim().match(/^!([1-4])\b/);
    if (!m) return;
    const idx = parseInt(m[1], 10) - 1;
    if (idx >= round.candidates.length) return;
    const prev = this.votes.get(msg.nick);
    if (prev !== undefined) round.counts[prev]--;
    this.votes.set(msg.nick, idx);
    this.voterMeta.set(msg.nick, { displayName: msg.displayName, color: msg.color });
    round.counts[idx]++;
    this.emitRound();
  }

  private addPoints(nick: string, displayName: string, color: string, pts: number) {
    const cur = this.scores.get(nick);
    if (cur) {
      cur.points += pts;
      cur.displayName = displayName;
      if (color) cur.color = color;
    } else {
      this.scores.set(nick, { nick, displayName, color, points: pts });
    }
  }

  private emitRound() {
    const snapshot = this.round ? { ...this.round, counts: [...this.round.counts] } : null;
    for (const cb of this.roundCbs) cb(snapshot);
  }

  private emitScores() {
    const s = this.getScores();
    for (const cb of this.scoresCbs) cb(s);
  }
}

function sameMove(a: Move, b: Move): boolean {
  return a.from === b.from && a.to === b.to && a.kind === b.kind;
}

function pickRandom<T>(arr: T[], n: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const moveVoting = new MoveVotingStore();
