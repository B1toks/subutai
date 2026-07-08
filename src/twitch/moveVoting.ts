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
 *   chatvsbot (T6) — "chat plays vs the bot": chat controls the HUMAN
 *     side. Free-form rounds — viewers type any legal move ("e4",
 *     "Nf3", "O-O", "e2e4"); the majority move is played against the
 *     engine. The streamer can always move manually as an override.
 *   guess (R2) — "guess the streamer": while the streamer thinks, chat
 *     types the move they expect (free-form, same input as chatvsbot).
 *     The round doesn't gate anything — it resolves whenever the
 *     streamer actually moves; correct guessers get +2 and their nicks
 *     flash on the board.
 *
 * The store is a singleton living outside React: App's AI scheduler
 * awaits `gate()`, the Twitch panel renders rounds via subscriptions,
 * and the chat client feeds votes in. Match-long scores power the
 * end-of-game leaderboard (result calls from predictions.ts add +3).
 */

import type { BoardState, Move } from '../engine';
import { computeSAN } from '../recording/log';
import { twitchChat, type TwitchChatMessage } from './chat';

export type VoteMode = 'off' | 'predict' | 'chat' | 'chatvsbot' | 'guess';

/** R10 — guess-round difficulty: name the exact move (+2) or just the
 *  piece type the streamer will touch (+1, the easy on-ramp). */
export type GuessLevel = 'move' | 'piece';

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
  /** T6 — chatvsbot rounds have no fixed slate: candidates grow as
   *  chat proposes distinct legal moves. */
  freeform?: boolean;
  /** R2 — guess rounds have no clock: they stay open until the
   *  streamer moves (endsAt is ignored). */
  openEnded?: boolean;
  /** R10 — what a guess round is guessing: the exact move or just the
   *  piece type. Absent on non-guess rounds. */
  guessKind?: GuessLevel;
}

/** R2 — who called the streamer's move. */
export interface GuessWinner {
  nick: string;
  displayName: string;
  color: string;
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
type ModeCb = (mode: VoteMode) => void;

/** R10 — plain-word fallback for keys moveKey() rejects: "rotate",
 *  "knight", "queen"… Lowercased single word, "!" prefix stripped. */
function plainWordKey(raw: string): string | null {
  let t = raw.trim().toLowerCase();
  if (t.startsWith('!')) t = t.slice(1);
  if (!/^[a-z]{2,10}$/.test(t)) return null;
  return t;
}

/** R10 — the board-rotation pseudo-move chat can call. */
const ROTATE_CANDIDATE: VoteCandidate = {
  move: { kind: 'topologyToggle' },
  san: 'Rotate',
};

/** R10 — words that map a chat message to a piece type. */
const PIECE_WORDS: Record<string, string> = {
  pawn: 'pawn',
  knight: 'knight',
  horse: 'knight',
  bishop: 'bishop',
  rook: 'rook',
  tower: 'rook',
  queen: 'queen',
  king: 'king',
};

const PIECE_LABEL: Record<string, string> = {
  pawn: 'Pawn',
  knight: 'Knight',
  bishop: 'Bishop',
  rook: 'Rook',
  queen: 'Queen',
  king: 'King',
};

/**
 * T6 — normalise a chat message (or a SAN string, for indexing) into a
 * comparable move key: lowercase, "!" / "move " prefixes stripped,
 * trailing check/annotation marks dropped, zeros mapped to letter-O
 * castling. Returns null for anything that can't be a single move token.
 */
export function moveKey(raw: string): string | null {
  let t = raw.trim().toLowerCase();
  if (t.startsWith('!')) t = t.slice(1);
  if (t.startsWith('move ')) t = t.slice(5);
  if (!t || t.includes(' ')) return null;
  t = t.replace(/[+#?!]+$/g, '').replace(/0/g, 'o');
  if (!/^[a-ho1-8x=qrbnk-]{2,7}$/.test(t)) return null;
  return t;
}

const PROMO_LETTER: Record<string, string> = {
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
};

const PIECE_LETTER: Record<string, string> = {
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: 'k',
};

/**
 * T6 — chat-friendly aliases for a legal move: what a viewer would
 * actually type. The app's own SAN is the long arrow form ("Ne1→f3"),
 * which nobody types in chat — so we derive the short forms here:
 * "e4", "nf3" / "nxf3", "exd5", "o-o", "e8=q" / "e8q" / "e8".
 * Coordinate forms ("e2e4") are registered separately by the caller.
 */
function moveAliases(state: BoardState, m: Move): string[] {
  if (m.kind === 'castle') return [m.to && m.to[0] === 'c' ? 'o-o-o' : 'o-o'];
  if (!m.from || !m.to) return [];
  const piece = state.pieces[m.from];
  if (!piece) return [];
  const to = m.to.toLowerCase();
  const isCapture = state.pieces[m.to] != null || m.kind === 'enPassant';
  if (piece.type === 'pawn') {
    const base = isCapture ? `${m.from[0]}x${to}` : to;
    const promo = m.kind === 'promotion' && m.promotion ? PROMO_LETTER[m.promotion] : '';
    if (!promo) return [base];
    const out = [`${base}=${promo}`, `${base}${promo}`];
    // Bare "e8" means the queen promotion, like every chess UI.
    if (promo === 'q') out.push(base);
    return out;
  }
  const letter = PIECE_LETTER[piece.type] ?? '';
  // Register both spellings so "Nf3" and "Nxf3" both land regardless of
  // whether the move actually captures.
  return [`${letter}${to}`, `${letter}x${to}`];
}

class MoveVotingStore {
  private mode: VoteMode = 'off';
  private round: VoteRound | null = null;
  /** nick → candidate idx for the live round. */
  private votes = new Map<string, number>();
  private voterMeta = new Map<string, { displayName: string; color: string }>();
  private scores = new Map<string, ViewerScore>();
  private roundCbs: RoundCb[] = [];
  private scoresCbs: ScoresCb[] = [];
  private modeCbs: ModeCb[] = [];
  /** T6 — normalized move text → candidate, for the live freeform round. */
  private sanIndex = new Map<string, VoteCandidate>();
  /** R10 — guess difficulty picked by the streamer (session-only). */
  private guessLevel: GuessLevel = 'move';
  /** R10 — piece-level rounds: from-square → piece type, captured when
   *  the round opens so the resolve can classify the played move. */
  private guessTypeByFrom = new Map<string, string>();
  private clearTimer: ReturnType<typeof setTimeout> | null = null;
  // M.13 — coalesce round emits. Busy channels fire 50+ votes/sec; one
  // setRound per vote was a render storm that froze the panel and made
  // the scoring look "stuck". We batch and flush at most ~7×/sec.
  private emitDirty = false;
  private emitTimer: ReturnType<typeof setInterval> | null = null;

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
    // T6 — App subscribes so the chat-vs-bot scheduler can react.
    for (const cb of this.modeCbs) cb(mode);
  }

  onMode(cb: ModeCb): () => void {
    this.modeCbs.push(cb);
    return () => {
      this.modeCbs = this.modeCbs.filter((c) => c !== cb);
    };
  }

  getRound(): VoteRound | null {
    return this.round;
  }

  getGuessLevel(): GuessLevel {
    return this.guessLevel;
  }

  /** R10 — takes effect on the NEXT guess round; an open one keeps its kind. */
  setGuessLevel(level: GuessLevel) {
    this.guessLevel = level;
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
    // chatvsbot gates the HUMAN move instead — the engine plays freely.
    if (this.mode !== 'predict' && this.mode !== 'chat') return chosenMove;
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

  /**
   * T6 — human-move gate for "chat vs bot". Opens a FREE-FORM round: no
   * fixed slate; any legal move is votable by typing its SAN ("e4",
   * "Nf3", "O-O") or coordinates ("e2e4"). Resolves with the majority
   * move (tie → random among tied). While chat is silent the window
   * extends instead of resolving on nothing — the streamer can always
   * move manually, which cancels the round via cancelRound().
   * Returns null when the mode is off, chat is disconnected, or the
   * round was cancelled under us.
   */
  async gateHumanMove(
    boardState: BoardState,
    legalMoves: Move[],
    allowRotate = false,
  ): Promise<Move | null> {
    if (this.mode !== 'chatvsbot') return null;
    if (twitchChat.getStatus() !== 'connected') return null;
    // The bot often answers within the previous round's REVEAL_HOLD —
    // wait for the banner to clear instead of giving up (nothing would
    // ever re-trigger the App effect, and the round chain would stall).
    while (this.round && this.round.revealIdx !== null) {
      await new Promise((r) => setTimeout(r, 250));
      if (this.mode !== 'chatvsbot') return null;
    }
    if (this.round) return null;
    const pieceMoves = legalMoves.filter((m) => m.from && m.to);
    if (pieceMoves.length === 0) return null;

    this.indexLegalMoves(boardState, pieceMoves);
    // R10 — chat can play the rotation itself ("rotate"), when legal.
    if (allowRotate) this.sanIndex.set('rotate', ROTATE_CANDIDATE);

    this.votes.clear();
    this.voterMeta.clear();
    const round: VoteRound = {
      mode: 'chatvsbot',
      candidates: [],
      counts: [],
      endsAt: Date.now() + VOTE_WINDOW_MS,
      revealIdx: null,
      freeform: true,
    };
    this.round = round;
    this.emitRound();

    for (;;) {
      await new Promise((r) => setTimeout(r, Math.max(50, round.endsAt - Date.now())));
      if (this.round !== round) return null; // cancelled under us
      if (this.mode !== 'chatvsbot') {
        this.cancelRound();
        return null;
      }
      if (round.counts.some((c) => c > 0)) break;
      round.endsAt = Date.now() + VOTE_WINDOW_MS;
      this.emitRound();
    }

    const max = Math.max(...round.counts);
    const top = round.counts
      .map((c, i) => ({ c, i }))
      .filter((x) => x.c === max)
      .map((x) => x.i);
    const finalIdx = top[Math.floor(Math.random() * top.length)];

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

    return round.candidates[finalIdx].move;
  }

  /** Build the typed-text → candidate index for a free-form round.
   *  Two passes: coordinate keys are unique by construction and always
   *  land; short aliases can collide ("bxc3" pawn vs bishop, two knights
   *  reaching f3) — those are collected first, then a collision either
   *  resolves to the pawn reading (what lowercase means in chat) or the
   *  alias is dropped and voters fall back to the coordinate form. */
  private indexLegalMoves(boardState: BoardState, pieceMoves: Move[]) {
    this.sanIndex.clear();
    const aliasMap = new Map<string, VoteCandidate[]>();
    for (const m of pieceMoves) {
      const cand: VoteCandidate = { move: m, san: computeSAN(boardState, m) };
      const promo = m.kind === 'promotion' && m.promotion ? PROMO_LETTER[m.promotion] : '';
      this.sanIndex.set(`${m.from}${m.to}${promo}`.toLowerCase(), cand);
      if (promo === 'q') this.sanIndex.set(`${m.from}${m.to}`.toLowerCase(), cand);
      for (const alias of moveAliases(boardState, m)) {
        const list = aliasMap.get(alias);
        if (list) list.push(cand);
        else aliasMap.set(alias, [cand]);
      }
    }
    for (const [alias, cands] of aliasMap) {
      if (cands.length === 1) {
        if (!this.sanIndex.has(alias)) this.sanIndex.set(alias, cands[0]);
        continue;
      }
      // Prefer the pawn move when exactly one candidate is a pawn move —
      // "bxc3" typed lowercase means the b-pawn, not the bishop.
      const pawnCands = cands.filter(
        (c) => c.move.from != null && boardState.pieces[c.move.from]?.type === 'pawn',
      );
      if (pawnCands.length === 1 && !this.sanIndex.has(alias)) {
        this.sanIndex.set(alias, pawnCands[0]);
      }
      // Otherwise ambiguous (two knights to one square) — drop the alias;
      // the coordinate form still works and stays visible in the hint.
    }
  }

  /**
   * R2 — open a "guess the streamer" round. Free-form input like
   * chatvsbot, but nothing awaits it: it has no clock and resolves only
   * when the streamer moves (resolveGuessRound / resolveGuessRotate) or
   * the position changes under it (cancelRound — App's effect cleanup).
   * R10 — the round's kind follows the streamer-picked difficulty:
   * 'move' indexes exact moves, 'piece' indexes piece-type words; both
   * accept "rotate" when a rotation is currently legal.
   */
  openGuessRound(boardState: BoardState, legalMoves: Move[], allowRotate = false) {
    if (this.mode !== 'guess') return;
    if (twitchChat.getStatus() !== 'connected') return;
    if (this.round) return;
    const pieceMoves = legalMoves.filter((m) => m.from && m.to);
    if (pieceMoves.length === 0) return;
    const kind = this.guessLevel;
    if (kind === 'move') {
      this.indexLegalMoves(boardState, pieceMoves);
    } else {
      this.sanIndex.clear();
      this.guessTypeByFrom.clear();
      const present = new Set<string>();
      for (const m of pieceMoves) {
        const type = m.from ? boardState.pieces[m.from]?.type : undefined;
        if (!type) continue;
        this.guessTypeByFrom.set(m.from as string, type);
        present.add(type);
      }
      for (const [word, type] of Object.entries(PIECE_WORDS)) {
        if (present.has(type)) {
          this.sanIndex.set(word, { move: { kind: 'normal' }, san: PIECE_LABEL[type] });
        }
      }
    }
    if (allowRotate) this.sanIndex.set('rotate', ROTATE_CANDIDATE);
    this.votes.clear();
    this.voterMeta.clear();
    this.round = {
      mode: 'guess',
      candidates: [],
      counts: [],
      endsAt: 0,
      revealIdx: null,
      freeform: true,
      openEnded: true,
      guessKind: kind,
    };
    this.emitRound();
  }

  /** R10 — points at stake for the open guess round's difficulty. */
  private guessAward(round: VoteRound): number {
    return round.guessKind === 'piece' ? 1 : 2;
  }

  /** Shared guess settlement: find (or append) the winning candidate,
   *  award its voters, reveal, schedule the banner clear. */
  private settleGuess(
    matchIdx: (c: VoteCandidate) => boolean,
    fallback: VoteCandidate,
  ): GuessWinner[] {
    const round = this.round;
    if (!round || round.mode !== 'guess' || round.revealIdx !== null) return [];
    let idx = round.candidates.findIndex(matchIdx);
    if (idx === -1) {
      idx = round.candidates.length;
      round.candidates.push(fallback);
      round.counts.push(0);
    }
    const winners: GuessWinner[] = [];
    const award = this.guessAward(round);
    for (const [nick, vIdx] of this.votes) {
      if (vIdx === idx) {
        const meta = this.voterMeta.get(nick);
        const w = { nick, displayName: meta?.displayName ?? nick, color: meta?.color ?? '' };
        winners.push(w);
        this.addPoints(w.nick, w.displayName, w.color, award);
      }
    }
    this.emitScores();
    this.round = { ...round, revealIdx: idx };
    this.emitRound();
    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => {
      this.round = null;
      this.emitRound();
    }, REVEAL_HOLD_MS);
    return winners;
  }

  /**
   * R2 — the streamer moved: resolve the open guess round against the
   * move actually played. Correct guessers score (+2 exact move, +1
   * piece type) and are returned so the App can burst their nicks. The
   * played answer joins the slate even if nobody guessed it — the
   * reveal banner then shows what chat missed.
   */
  resolveGuessRound(played: Move, san: string): GuessWinner[] {
    const round = this.round;
    if (!round || round.mode !== 'guess' || round.revealIdx !== null) return [];
    if (round.guessKind === 'piece') {
      const type = played.from ? this.guessTypeByFrom.get(played.from) : undefined;
      const label = type ? PIECE_LABEL[type] : san;
      return this.settleGuess(
        (c) => c.san === label,
        { move: { kind: 'normal' }, san: label },
      );
    }
    return this.settleGuess(
      (c) =>
        c.move.from === played.from &&
        c.move.to === played.to &&
        (c.move.kind !== 'promotion' || c.move.promotion === played.promotion),
      { move: played, san },
    );
  }

  /** R10 — the streamer rotated the board instead of moving: voters who
   *  typed "rotate" win, at the open round's stake. */
  resolveGuessRotate(): GuessWinner[] {
    return this.settleGuess((c) => c.san === ROTATE_CANDIDATE.san, ROTATE_CANDIDATE);
  }

  /** T6 — abort an open (unrevealed) round: the position changed under
   *  it — streamer moved manually, new game, mode/panel switched off.
   *  A revealed round is left alone; its banner clears itself. */
  cancelRound() {
    const r = this.round;
    if (!r || r.revealIdx !== null) return;
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    this.round = null;
    this.votes.clear();
    this.voterMeta.clear();
    this.emitRound();
  }

  private ingest(msg: TwitchChatMessage) {
    const round = this.round;
    if (!round || round.revealIdx !== null) return;
    let idx: number;
    if (round.freeform) {
      // R10 — moveKey handles chess notation; the plain-word fallback
      // covers "rotate" and the piece-type words, which its charset
      // rejects. Unknown words simply miss the index and are ignored.
      const key = moveKey(msg.text) ?? plainWordKey(msg.text);
      if (!key) return;
      const cand = this.sanIndex.get(key);
      if (!cand) return;
      idx = round.candidates.findIndex((c) => c.san === cand.san);
      if (idx === -1) {
        idx = round.candidates.length;
        round.candidates.push(cand);
        round.counts.push(0);
      }
    } else {
      const m = msg.text.trim().match(/^!([1-4])\b/);
      if (!m) return;
      idx = parseInt(m[1], 10) - 1;
      if (idx >= round.candidates.length) return;
    }
    const prev = this.votes.get(msg.nick);
    if (prev !== undefined) round.counts[prev]--;
    this.votes.set(msg.nick, idx);
    this.voterMeta.set(msg.nick, { displayName: msg.displayName, color: msg.color });
    round.counts[idx]++;
    this.emitRoundThrottled(); // M.13 — coalesce vote-count updates
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

  /** Immediate emit — for state TRANSITIONS (round open / reveal / clear)
   *  that must reach the UI right away. */
  private emitRound() {
    this.emitDirty = false;
    const snapshot = this.round ? { ...this.round, counts: [...this.round.counts] } : null;
    for (const cb of this.roundCbs) cb(snapshot);
  }

  /** Throttled emit — for high-frequency vote COUNT updates. Coalesces
   *  a flood of votes into ~7 UI updates/sec via a shared interval. */
  private emitRoundThrottled() {
    this.emitDirty = true;
    if (this.emitTimer !== null) return;
    this.emitTimer = setInterval(() => {
      if (this.emitDirty) {
        this.emitRound();
      } else {
        // Idle — stop the interval until the next vote arrives.
        if (this.emitTimer !== null) clearInterval(this.emitTimer);
        this.emitTimer = null;
      }
    }, 140);
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

// Dev seam (same pattern as __liveBpm) for manual round inspection.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __moveVoting?: MoveVotingStore }).__moveVoting = moveVoting;
}
