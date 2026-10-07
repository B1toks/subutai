// Independent attack suite against fix/rules firestore.rules.
// Every write here is what a hand-crafted client (signed in, own uid) can send.
// "ALLOWED" = the bypass works; "DENIED" = the rule holds.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp, addDoc, collection, doc, getDoc, runTransaction, serverTimestamp,
  setDoc, updateDoc, writeBatch, deleteField, deleteDoc,
} from 'firebase/firestore';

const RULES = process.env.RULES_FILE ?? new URL('../../firestore.rules', import.meta.url);
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-subutai',
    firestore: { rules: readFileSync(RULES, 'utf8') },
  });
});
beforeEach(async () => { await env.clearFirestore(); });
after(async () => { await env.cleanup(); });

const as = (uid) => env.authenticatedContext(uid).firestore();
async function admin(fn) { await env.withSecurityRulesDisabled(async (c) => fn(c.firestore())); }
async function read(path) { let d; await admin(async (db) => { d = (await getDoc(doc(db, path))).data(); }); return d; }
async function seed(path, data) { await admin((db) => setDoc(doc(db, path), data)); }
async function allowed(p) { await p; }
async function denied(p) { await assert.rejects(p, (e) => e?.code === 'permission-denied'); }
const ago = (ms) => Timestamp.fromMillis(Date.now() - ms);

/** Name claim exactly as the app's claimDisplayName does it, but with any strings. */
async function claim(uid, displayName, slug) {
  const db = as(uid);
  await runTransaction(db, async (tx) => {
    tx.set(doc(db, 'displayNames', slug), { uid, createdAt: serverTimestamp() });
    tx.set(doc(db, 'users', uid), {
      uid, displayName, displayNameLower: slug, createdAt: serverTimestamp(), lastActive: serverTimestamp(),
    }, { merge: true });
  });
}

function garbageMoves(n) {
  return Array.from({ length: n }, () => ({ san: 'x' }));
}
function fakeGame(uid, { moveCount = 10, outcome = 'human-win', points } = {}) {
  return {
    playerId: uid, playerName: 'Anyone', chess960Id: 'RNBQKBNR', humanColor: 'white',
    outcome, moveCount, log: { moves: garbageMoves(moveCount * 2 - 1) },
    points: points ?? { total: 100, moveCount, counted: true, movePoints: 100, capturePoints: 0,
      qualityPoints: 0, rotationPoints: 0, outcomeBonus: 0 },
    createdAt: serverTimestamp(),
  };
}

// ── /users: stats and records ──────────────────────────────────────────
describe('U: /users stats', () => {
  beforeEach(async () => { await claim('mallory', 'Mallory', 'mallory'); });

  it('U1 ALLOWED: gamesWon / gamesPlayed +1 per write, 300 writes, no game behind', async () => {
    const db = as('mallory');
    for (let i = 1; i <= 300; i++) {
      await updateDoc(doc(db, 'users/mallory'), { gamesWon: i, gamesPlayed: i });
    }
    const u = await read('users/mallory');
    assert.equal(u.gamesWon, 300);
  });

  it('U2 ALLOWED: longestSurvivalMoves 700 with no game', async () => {
    await allowed(updateDoc(doc(as('mallory'), 'users/mallory'), { longestSurvivalMoves: 700 }));
  });

  it('U3 ALLOWED: strongWins +1 per made-up /games doc, 25 in a row', async () => {
    const db = as('mallory');
    for (let i = 1; i <= 25; i++) {
      const g = await addDoc(collection(db, 'games'), fakeGame('mallory'));
      await updateDoc(doc(db, 'users/mallory'), {
        strongWins: i, lastGameId: g.id, lastGameAt: serverTimestamp(),
      });
    }
    assert.equal((await read('users/mallory')).strongWins, 25);
  });

  it('U4 ALLOWED: bestGamePoints 6010 from a made-up /games doc (moveCount 300, garbage log)', async () => {
    const db = as('mallory');
    const points = { total: 6010, moveCount: 300, counted: true, movePoints: 1500, capturePoints: 400,
      qualityPoints: 3010, rotationPoints: 600, outcomeBonus: 500 };
    const g = await addDoc(collection(db, 'games'), fakeGame('mallory', { moveCount: 300, points }));
    await allowed(updateDoc(doc(db, 'users/mallory'), {
      bestGamePoints: 6010, bestGameId: g.id,
      bestGameSnapshot: { chess960Id: 'RNBQKBNR', moveCount: 300, outcome: 'human-win', createdAt: serverTimestamp() },
    }));
  });

  it('U4b ALLOWED: a 10-move made-up game scores 3110 (every cap at its ceiling)', async () => {
    const db = as('mallory');
    const points = { total: 3110, moveCount: 10, counted: true, movePoints: 1500, capturePoints: 400,
      qualityPoints: 110, rotationPoints: 600, outcomeBonus: 500 };
    await allowed(addDoc(collection(db, 'games'), fakeGame('mallory', { moveCount: 10, points })));
  });

  it('U4c ALLOWED: roulette best 6010 the same way', async () => {
    const db = as('mallory');
    const points = { total: 6010, moveCount: 300, counted: true, movePoints: 1500, capturePoints: 400,
      qualityPoints: 3010, rotationPoints: 600, outcomeBonus: 500 };
    const g = await addDoc(collection(db, 'games'), { ...fakeGame('mallory', { moveCount: 300, points }), gameMode: 'roulette' });
    await allowed(updateDoc(doc(db, 'users/mallory'), {
      rouletteBestPoints: 6010, rouletteBestGameId: g.id,
      rouletteBestSnapshot: { chess960Id: 'RNBQKBNR', moveCount: 300, outcome: 'human-win', createdAt: serverTimestamp() },
    }));
  });

  it('U5 ALLOWED: snapshot durationMs of 1 ms (or negative) copied from the made-up game', async () => {
    const db = as('mallory');
    const g = await addDoc(collection(db, 'games'), { ...fakeGame('mallory'), durationMs: -5 });
    await allowed(updateDoc(doc(db, 'users/mallory'), {
      bestGamePoints: 100, bestGameId: g.id,
      bestGameSnapshot: { chess960Id: 'RNBQKBNR', moveCount: 10, outcome: 'human-win', createdAt: serverTimestamp(), durationMs: -5 },
    }));
  });

  it('U6 ALLOWED: createdAt / lastActive any type or date (profile "member since 1970")', async () => {
    await allowed(updateDoc(doc(as('mallory'), 'users/mallory'), {
      createdAt: Timestamp.fromMillis(0), lastActive: 'whenever',
    }));
  });

  it('U7 ALLOWED: /games playerName is any name (not tied to the reservation)', async () => {
    await allowed(addDoc(collection(as('mallory'), 'games'), { ...fakeGame('mallory', { outcome: 'ai-win' }), playerName: 'Alice' }));
  });

  it('U8 ALLOWED: /games with arbitrary extra fields (no hasOnly)', async () => {
    await allowed(addDoc(collection(as('mallory'), 'games'), { ...fakeGame('mallory'), vsAI: 'yes', junk: 'x'.repeat(500_000) }));
  });

  // closed
  it('U9 DENIED: strongWins +1 re-using an already counted game', async () => {
    const db = as('mallory');
    const g = await addDoc(collection(db, 'games'), fakeGame('mallory'));
    await updateDoc(doc(db, 'users/mallory'), { strongWins: 1, lastGameId: g.id, lastGameAt: serverTimestamp() });
    await denied(updateDoc(doc(db, 'users/mallory'), { strongWins: 2, lastGameId: g.id, lastGameAt: serverTimestamp() }));
  });
  it('U10 DENIED: strongWins down then up again with the same game', async () => {
    const db = as('mallory');
    const g = await addDoc(collection(db, 'games'), fakeGame('mallory'));
    await updateDoc(doc(db, 'users/mallory'), { strongWins: 1, lastGameId: g.id, lastGameAt: serverTimestamp() });
    await updateDoc(doc(db, 'users/mallory'), { strongWins: 0 });
    await denied(updateDoc(doc(db, 'users/mallory'), { strongWins: 1, lastGameId: g.id, lastGameAt: serverTimestamp() }));
  });
  it('U11 DENIED: best pointing at a game of another player', async () => {
    await claim('alice', 'Alice', 'alice');
    const g = await addDoc(collection(as('alice'), 'games'), fakeGame('alice'));
    await denied(updateDoc(doc(as('mallory'), 'users/mallory'), {
      bestGamePoints: 100, bestGameId: g.id,
      bestGameSnapshot: { chess960Id: 'RNBQKBNR', moveCount: 10, outcome: 'human-win', createdAt: serverTimestamp() },
    }));
  });
  it('U12 DENIED: points total over the sum of its parts / a 7-move counted game', async () => {
    const db = as('mallory');
    await denied(addDoc(collection(db, 'games'), fakeGame('mallory', { points: { total: 101, moveCount: 10, counted: true,
      movePoints: 100, capturePoints: 0, qualityPoints: 0, rotationPoints: 0, outcomeBonus: 0 } })));
    await denied(addDoc(collection(db, 'games'), fakeGame('mallory', { moveCount: 7 })));
  });
  it('U13 DENIED: create a profile with stats; remove bestGamePoints', async () => {
    const db = as('eve');
    await denied(runTransaction(db, async (tx) => {
      tx.set(doc(db, 'displayNames', 'eve'), { uid: 'eve', createdAt: serverTimestamp() });
      tx.set(doc(db, 'users', 'eve'), { uid: 'eve', displayName: 'Eve', displayNameLower: 'eve', strongWins: 5 });
    }));
    const g = await addDoc(collection(as('mallory'), 'games'), fakeGame('mallory'));
    await updateDoc(doc(as('mallory'), 'users/mallory'), { bestGamePoints: 100, bestGameId: g.id,
      bestGameSnapshot: { chess960Id: 'RNBQKBNR', moveCount: 10, outcome: 'human-win', createdAt: serverTimestamp() } });
    await denied(updateDoc(doc(as('mallory'), 'users/mallory'), { bestGamePoints: deleteField() }));
  });
});

// ── /displayNames: taking someone else's name ──────────────────────────
describe('N: names', () => {
  beforeEach(async () => { await claim('alice', 'Boss', 'boss'); });

  it('N1 DENIED (R-5): "Boss " (trailing space) under slug "boss " while alice holds "boss"', async () => {
    await denied(claim('mallory', 'Boss ', 'boss '));
  });
  it('N1b DENIED (R-5): " Boss" (leading space); "Bo  ss" (two spaces, shown as one)', async () => {
    await denied(claim('mallory', ' Boss', ' boss'));
    await claim('bob', 'Bo ss', 'bo ss');
    await denied(claim('mallory', 'Bo  ss', 'bo  ss'));
  });
  it('N2 DENIED (R-5): exactly "Boss" under slug "boſs" (U+017F long s, folds to s)', async () => {
    await denied(claim('mallory', 'Boss', 'boſs'));
  });
  // The emulator's regex tables do not fold U+1C80–U+1C88 to Cyrillic, so
  // these were refused here already; the rules now refuse them by name,
  // whatever prod's tables do.
  it('N3 DENIED (R-5): exactly "Олег" under slug with U+1C82 (CYRILLIC SMALL LETTER NARROW O)', async () => {
    await claim('oleg', 'Олег', 'олег');
    await denied(claim('mallory', 'Олег', 'ᲂлег'));
  });
  it('N3b DENIED (R-5): exactly "Стас" via U+1C83 (WIDE ES) and U+1C84 (TALL TE)', async () => {
    await claim('stas', 'Стас', 'стас');
    await denied(claim('mallory', 'Стас', 'ᲃᲄас'));
  });
  it('N3c DENIED (R-5): Greek "Σοφια" via final sigma ς in the slug', async () => {
    await claim('sofia', 'Σοφια', 'σοφια');
    await denied(claim('mallory', 'Σοφια', 'ςοφια'));
  });
  it('N3d DENIED (R-5): "Νίκος" via a word-final σ (the client writes ς there); "Σας Σου" via ς mid-word', async () => {
    await claim('nikos', 'Νίκος', 'νίκος');
    await denied(claim('mallory', 'Νίκος', 'νίκοσ'));
    await denied(claim('mallory', 'ΝΊΚΟΣ', 'νίκοσ'));
    await claim('sas', 'Σας Σου', 'σας σου');
    await denied(claim('mallory', 'Σας Σου', 'σας ςου'));
    await denied(claim('mallory', 'Σας Σου', 'σασ σου'));
  });
  it('N4 DENIED (R-5): Hangul "한" precomposed vs conjoining jamo, or 하 + a final jamo (renders the same)', async () => {
    await claim('han', '한국어', '한국어'); // 한국어
    await denied(claim('mallory', '한국어', '한국어'));
    await denied(claim('mallory', '한국어', '한국어'));
  });
  it('N4b DENIED (R-5): an invisible Hangul filler after the name ("Boss" + U+3164 / U+FFA0 / U+1160 / U+115F)', async () => {
    for (const filler of ['ㅤ', 'ﾠ', 'ᅠ', 'ᅟ']) {
      await denied(claim('mallory', `Boss${filler}`, `boss${filler}`));
    }
  });
  it('N4c DENIED (R-5): every other fold variant a slug could carry, against a name held under the plain letter', async () => {
    // [variant in the slug, the plain lowercase letter, its capital]
    const folds = [
      ['µ', 'μ', 'Μ'], ['ͅ', 'ι', 'Ι'], ['ϐ', 'β', 'Β'],
      ['ϑ', 'θ', 'Θ'], ['ϕ', 'φ', 'Φ'], ['ϖ', 'π', 'Π'],
      ['ϰ', 'κ', 'Κ'], ['ϱ', 'ρ', 'Ρ'], ['ϵ', 'ε', 'Ε'],
      ['ẛ', 'ṡ', 'Ṡ'], ['ι', 'ι', 'Ι'],
      ['ᲀ', 'в', 'В'], ['ᲁ', 'д', 'Д'], ['ᲅ', 'т', 'Т'],
      ['ᲆ', 'ъ', 'Ъ'], ['ᲇ', 'ѣ', 'Ѣ'], ['ᲈ', 'ꙋ', 'Ꙋ'],
    ];
    for (const [variant, plain, cap] of folds) {
      const shown = `${cap}${plain}${plain}`;
      await env.clearFirestore();
      await claim('victim', shown, `${plain}${plain}${plain}`);
      await denied(claim('mallory', shown, `${variant}${plain}${plain}`));
    }
    // Roman numerals and circled letters fold upper onto lower: no slug may carry them.
    await denied(claim('mallory', 'ⅫⅫⅫ', 'ⅻⅻⅻ'));
    await denied(claim('mallory', 'Ⓑoss', 'ⓑoss'));
  });
  it('N5 ALLOWED (known limit): homoglyph "Bоss" (Cyrillic о) — expected, not a rules job', async () => {
    await allowed(claim('mallory', 'Bоss', 'bоss'));
  });
  it('N6 ALLOWED (known limit, R-13 data): legacy profile showing "legacy" with no reservation — anyone takes it', async () => {
    await seed('users/old', { uid: 'old', displayName: 'Legacy', displayNameLower: 'legacy' });
    await allowed(claim('mallory', 'Legacy', 'legacy'));
  });
  it('N7 DENIED (R-5): displayName of 1 or 2 characters (app requires 3), or over 20', async () => {
    await denied(claim('mallory', 'B', 'b'));
    await denied(claim('mallory', 'Bo', 'bo'));
    await denied(claim('mallory', 'B'.repeat(21), 'b'.repeat(21)));
  });
  // closed
  it('N8 DENIED: take "boss" outright / "BOSS" with slug "boss"', async () => {
    await denied(claim('mallory', 'Boss', 'boss'));
    await denied(claim('mallory', 'BOSS', 'boss'));
  });
  it('N9 DENIED: displayName "Boss" with slug "bosś" (non-folding)', async () => {
    await denied(claim('mallory', 'Boss', 'bosś'));
  });
  it('N10 DENIED: a second reservation; deleting alice\'s reservation; name in regex syntax', async () => {
    await claim('mallory', 'Mal', 'mal');
    await denied(setDoc(doc(as('mallory'), 'displayNames/other'), { uid: 'mallory' }));
    await denied(deleteDoc(doc(as('mallory'), 'displayNames/boss')));
    await denied(claim('mallory', 'B.ss', 'boss'));
  });
});

// ── /matches ───────────────────────────────────────────────────────────
async function activeMatch({ mode = 'classic', moves = 0, turn = 'host' } = {}) {
  await seed('matches/ABC123', {
    code: 'ABC123', host: { uid: 'host', displayName: 'Host', color: 'white' },
    guest: { uid: 'guest', displayName: 'Guest', color: 'black' },
    chess960Id: 'RNBQKBNR', seed: 1, status: 'active', gameMode: mode,
    currentTurn: turn, outcome: null,
    log: { initialTopology: 'A', moves: Array.from({ length: moves }, (_, i) => ({ san: `m${i}` })) },
    createdAt: ago(5 * 60_000), lastActivity: ago(5_000), turnStartedAt: ago(5_000),
  });
}
const m = (uid) => doc(as(uid), 'matches/ABC123');

describe('M: matches', () => {
  it('M1 DENIED (R-2): the player NOT on turn rewrites the whole move history (same length)', async () => {
    await activeMatch({ moves: 4, turn: 'host' });
    await denied(updateDoc(m('guest'), {
      'log.moves': [{ san: 'f3' }, { san: 'e5' }, { san: 'g4' }, { san: 'Qh4#' }],
      lastActivity: serverTimestamp(),
    }));
    assert.equal((await read('matches/ABC123')).log.moves[3].san, 'm3');
  });
  it('M1b DENIED (R-2): on own turn, append one move AND rewrite earlier ones', async () => {
    await activeMatch({ moves: 2, turn: 'host' });
    await denied(updateDoc(m('host'), {
      'log.moves': [{ san: 'X' }, { san: 'Y' }, { san: 'Z', timestamp: Date.now() }], currentTurn: 'guest', lastActivity: serverTimestamp(),
    }));
    // The same append over the untouched history goes through.
    await allowed(updateDoc(m('host'), {
      'log.moves': [{ san: 'm0' }, { san: 'm1' }, { san: 'Z', timestamp: Date.now() }], currentTurn: 'guest', lastActivity: serverTimestamp(), turnStartedAt: serverTimestamp(),
    }));
  });
  it('M2 ALLOWED: claim "white-win" (no mate) after one move, on the opponent\'s turn', async () => {
    await activeMatch({ moves: 1, turn: 'guest' });
    await allowed(updateDoc(m('host'), { outcome: 'white-win', status: 'completed', lastActivity: serverTimestamp() }));
  });
  it('M3 ALLOWED: "draw" any time after one move, by the losing side', async () => {
    await activeMatch({ moves: 1, turn: 'guest' });
    await allowed(updateDoc(m('guest'), { outcome: 'draw', status: 'completed', lastActivity: serverTimestamp() }));
  });
  it('M4 DENIED (R-7): stalling — a no-op write by the player on turn no longer holds off the forfeit claim', async () => {
    await activeMatch({ moves: 2, turn: 'host' });
    await seed('matches/ABC123', { ...(await read('matches/ABC123')), lastActivity: ago(120_000), turnStartedAt: ago(120_000) });
    // host on turn, idle 120 s, touches the doc without moving:
    await allowed(updateDoc(m('host'), { lastActivity: serverTimestamp() }));
    await allowed(updateDoc(m('guest'), { outcome: 'host-resign', endReason: 'inactive', status: 'completed', lastActivity: serverTimestamp() }));
    // ...nor by moving turnStartedAt itself
    await activeMatch({ moves: 2, turn: 'host' });
    await denied(updateDoc(m('host'), { turnStartedAt: serverTimestamp(), lastActivity: serverTimestamp() }));
  });
  it('M4b allowed, harmless since R-7: a no-op write by either player moves lastActivity only', async () => {
    await activeMatch({ moves: 2, turn: 'host' });
    const before = (await read('matches/ABC123')).turnStartedAt;
    await allowed(updateDoc(m('guest'), { lastActivity: serverTimestamp() }));
    assert.deepEqual((await read('matches/ABC123')).turnStartedAt, before);
  });
  it('M5 DENIED (R-8): roulette — no action without a spin; two actions per spin, and the second ends the turn', async () => {
    await activeMatch({ mode: 'roulette', moves: 0, turn: 'host' });
    const stamp = { lastActivity: serverTimestamp(), turnStartedAt: serverTimestamp() };
    const move = (i) => ({ san: `h${i}`, timestamp: Date.now() });
    await denied(updateDoc(m('host'), { 'log.moves': [move(1)], ...stamp }));
    await allowed(updateDoc(m('host'), {
      rouletteSlots: ['pawn', 'pawn', 'knight', 'king'], rouletteActionsLeft: 2, usedRouletteSlots: [],
      rouletteSpinsByPlayer: { host: 1 }, rouletteSpinCount: 1, lastActivity: serverTimestamp(),
    }));
    const one = [move(1)];
    await allowed(updateDoc(m('host'), { 'log.moves': one, rouletteActionsLeft: 1, usedRouletteSlots: [0], ...stamp }));
    const two = [...one, move(2)];
    await denied(updateDoc(m('host'), { 'log.moves': two, rouletteActionsLeft: 1, ...stamp }));
    await denied(updateDoc(m('host'), { 'log.moves': two, rouletteActionsLeft: 0, ...stamp }));
    await allowed(updateDoc(m('host'), {
      'log.moves': two, currentTurn: 'guest', rouletteSlots: null, rouletteActionsLeft: 0, usedRouletteSlots: [], ...stamp,
    }));
    await denied(updateDoc(m('host'), { 'log.moves': [...two, move(3)], ...stamp }));
    assert.equal((await read('matches/ABC123')).log.moves.length, 2);
  });
  it('M6 DENIED (M6): unchecked fields — either player writes anything else on the doc (clock, spin, junk)', async () => {
    await activeMatch({ moves: 2, turn: 'host' });
    await denied(updateDoc(m('guest'), {
      clock: { whiteMs: 0, blackMs: 999999999 }, spin: 'anything', junk: 'x', 'log.initialTopology': 'B',
      lastActivity: serverTimestamp(),
    }));
    await denied(updateDoc(m('guest'), { junk: 'x', lastActivity: serverTimestamp() }));
    await denied(updateDoc(m('guest'), { 'log.initialTopology': 'B', lastActivity: serverTimestamp() }));
    await denied(updateDoc(m('guest'), { 'log.extra': 1, lastActivity: serverTimestamp() }));
  });
  it('M7 ALLOWED: join with the same colour as the host', async () => {
    await seed('matches/ABC123', {
      code: 'ABC123', host: { uid: 'host', displayName: 'Host', color: 'white' }, guest: null,
      chess960Id: 'RNBQKBNR', seed: 1, status: 'waiting', gameMode: 'classic', currentTurn: 'host', outcome: null,
      log: { initialTopology: 'A', moves: [] }, createdAt: ago(1000), lastActivity: ago(1000),
    });
    await allowed(updateDoc(m('guest'), {
      guest: { uid: 'guest', displayName: 'Guest', color: 'white' }, status: 'active', currentTurn: 'host',
      lastActivity: serverTimestamp(), turnStartedAt: serverTimestamp(),
    }));
  });
  it('M8 ALLOWED: host joins own match as guest (same uid in both seats)', async () => {
    await seed('matches/ABC123', {
      code: 'ABC123', host: { uid: 'host', displayName: 'Host', color: 'white' }, guest: null,
      chess960Id: 'RNBQKBNR', seed: 1, status: 'waiting', gameMode: 'classic', currentTurn: 'host', outcome: null,
      log: { initialTopology: 'A', moves: [] }, createdAt: ago(1000), lastActivity: ago(1000),
    });
    await allowed(updateDoc(m('host'), {
      guest: { uid: 'host', displayName: 'Host2', color: 'black' }, status: 'active', currentTurn: 'host',
      lastActivity: serverTimestamp(), turnStartedAt: serverTimestamp(),
    }));
  });
  it('M9 ALLOWED: in a timed match, the opponent ends it after 90 s of thinking (clock not seen)', async () => {
    await activeMatch({ moves: 2, turn: 'host' });
    await seed('matches/ABC123', { ...(await read('matches/ABC123')), lastActivity: ago(91_000), turnStartedAt: ago(91_000), timeControlSec: 600 });
    await allowed(updateDoc(m('guest'), { outcome: 'host-resign', endReason: 'flag', status: 'completed', lastActivity: serverTimestamp() }));
  });
  // closed
  it('M10 DENIED: classic — a move that keeps the turn; a move off turn; two moves at once', async () => {
    await activeMatch({ moves: 0, turn: 'host' });
    await denied(updateDoc(m('host'), { 'log.moves': [{ san: 'a', timestamp: Date.now() }], lastActivity: serverTimestamp(), turnStartedAt: serverTimestamp() }));
    await denied(updateDoc(m('guest'), { 'log.moves': [{ san: 'a', timestamp: Date.now() }], currentTurn: 'host', lastActivity: serverTimestamp(), turnStartedAt: serverTimestamp() }));
    await denied(updateDoc(m('host'), { 'log.moves': [{ san: 'a', timestamp: Date.now() }, { san: 'b', timestamp: Date.now() }], currentTurn: 'guest', lastActivity: serverTimestamp(), turnStartedAt: serverTimestamp() }));
  });
  it('M11 DENIED: opponent resignation before 90 s; the player on turn calling the other idle', async () => {
    await activeMatch({ moves: 2, turn: 'host' });
    await denied(updateDoc(m('guest'), { outcome: 'host-resign', status: 'completed', lastActivity: serverTimestamp() }));
    await seed('matches/ABC123', { ...(await read('matches/ABC123')), lastActivity: ago(200_000) });
    await denied(updateDoc(m('host'), { outcome: 'guest-resign', status: 'completed', lastActivity: serverTimestamp() }));
  });
  it('M12 DENIED: back-dated lastActivity; outcome changed after the end; third party writes', async () => {
    await activeMatch({ moves: 2, turn: 'host' });
    await denied(updateDoc(m('guest'), { lastActivity: ago(200_000) }));
    await denied(updateDoc(m('mallory'), { 'log.moves': [{ san: 'm0' }, { san: 'm1' }, { san: 'b', timestamp: Date.now() }], lastActivity: serverTimestamp(), turnStartedAt: serverTimestamp() }));
    await updateDoc(m('host'), { outcome: 'host-resign', status: 'completed', lastActivity: serverTimestamp() });
    await denied(updateDoc(m('host'), { outcome: 'white-win', lastActivity: serverTimestamp() }));
  });
  it('M13 DENIED: shrinking the log (undo a move)', async () => {
    await activeMatch({ moves: 3, turn: 'host' });
    await denied(updateDoc(m('host'), { 'log.moves': [{ san: 'a' }, { san: 'b' }], lastActivity: serverTimestamp() }));
  });
});

// ── /mm_queue (Quick match) ────────────────────────────────────────────
describe('Q: quick match queue', () => {
  it('Q1 ALLOWED: anyone stamps any matchCode on a waiting player (steer them into a chosen / dead match)', async () => {
    await seed('mm_queue/alice', { uid: 'alice', displayName: 'Alice', matchCode: null, createdAt: ago(1000) });
    await allowed(updateDoc(doc(as('mallory'), 'mm_queue/alice'), { matchCode: 'ZZZZZZ', claimedBy: 'mallory' }));
  });
});
