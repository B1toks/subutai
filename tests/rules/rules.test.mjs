// firestore.rules on the emulator (QA-04, QA-05, QA-06). Run with
// `npm run test:rules` (needs Java 21+ on PATH).
//
// "allowed" tests go through the app's own write paths wherever there is
// one (claimDisplayName, saveCompletedGame, createMatch / joinMatch, Quick
// match, the online-game hook), so a rule that breaks the client fails
// here. "denied" tests are the writes a hand-crafted client could make,
// each breaking one condition. "old client" tests replay what v1.0.2 sends.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Worker } from 'node:worker_threads';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { PROJECT_ID, actAs, firestoreFor, terminateAll } from './client-stub.mjs';

const { claimDisplayName, changeDisplayName, displayNameProblem } = await import('../../src/firebase/auth.ts');
const { saveCompletedGame } = await import('../../src/firebase/games.ts');
const { createMatch, joinMatch } = await import('../../src/firebase/matches.ts');
const { saveMultiplayerGameToGames } = await import('../../src/firebase/multiplayerGames.ts');
const { useMultiplayerSync, writeInactivityForfeit } = await import(
  '../../src/components/MultiplayerGameView.tsx'
);
const { generateLegalMoves } = await import('../../src/engine/moves.ts');
const { drawOfferBlock } = await import('../../src/utils/drawOffer.ts');

// ── harness ────────────────────────────────────────────────────────────

// RULES_FILE runs the same tests against another rules file (say, the
// published one) to see which holes it leaves open.
const RULES = process.env.RULES_FILE ?? new URL('../../firestore.rules', import.meta.url);

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(RULES, 'utf8') },
  });
});
beforeEach(async () => {
  await env.clearFirestore();
});
after(async () => {
  await terminateAll();
  await env.cleanup();
});

const as = (uid) => firestoreFor(uid);
const ago = (ms) => Timestamp.fromMillis(Date.now() - ms);
const MIN = 60_000;

async function read(path) {
  return (await getDoc(doc(as('owner'), path))).data();
}
async function seed(path, data) {
  await setDoc(doc(as('owner'), path), data);
}
async function patch(path, data) {
  await updateDoc(doc(as('owner'), path), data);
}
async function denied(write) {
  await assert.rejects(write, (e) => e?.code === 'permission-denied');
}

// ── profiles and saved games ───────────────────────────────────────────

async function newPlayer(uid, name) {
  actAs(uid);
  await claimDisplayName(uid, name);
}

/** A breakdown computeGamePoints() could give: 5 per move, the rest from
 *  captures (up to 400), then quality (R-4 caps both modes). */
function points({ total = 120, moveCount = 12, counted = true } = {}) {
  const movePoints = Math.min(total, 5 * moveCount);
  const capturePoints = Math.min(400, total - movePoints);
  return {
    movePoints,
    capturePoints,
    qualityPoints: total - movePoints - capturePoints,
    rotationPoints: 0,
    outcomeBonus: 0,
    total,
    moveCount,
    captureValueCp: 0,
    moveQualityCounts: { brilliant: 0, best: 0, good: 0, mistake: 0, blunder: 0 },
    counted,
  };
}

function gameLog(entries) {
  return {
    id: 'log',
    createdAt: new Date().toISOString(),
    randomSeed: 1,
    initialTopology: 'A',
    initialState: null,
    moves: Array.from({ length: entries }, (_, i) => ({
      san: 'R',
      move: { kind: 'topologyToggle' },
      topology: 'A',
      timestamp: 1000 + i,
    })),
  };
}

/** The app's own save (games.ts) of a game against the bot. */
async function saveGame(uid, o = {}) {
  const { outcome = 'ai-win', total = 120, moveCount = 12, counted = true } = o;
  actAs(uid);
  return saveCompletedGame({
    uid,
    displayName: 'Player',
    log: gameLog(moveCount * 2),
    outcome,
    points: points({ total, moveCount, counted }),
    chess960Id: 'RNBQKBNR',
    seed: 1,
    humanColor: 'white',
    gameMode: o.gameMode ?? 'classic',
    durationMs: 60_000,
    botLevel: o.botLevel ?? 'strong',
  });
}

/** A /games doc written past the rules (owner), for attacks that point at it. */
async function seedGame(id, o = {}) {
  await seed(`games/${id}`, {
    playerId: o.playerId ?? 'alice',
    playerName: 'Player',
    chess960Id: 'RNBQKBNR',
    seed: 1,
    humanColor: 'white',
    log: { initialTopology: 'A', moves: [] },
    outcome: o.outcome ?? 'human-win',
    moveCount: o.moveCount ?? 12,
    points: o.points ?? points({ total: o.total ?? 120, counted: o.counted ?? true }),
    gameMode: o.gameMode ?? 'classic',
    botLevel: o.botLevel ?? 'strong',
    vsAI: true,
    createdAt: o.createdAt ?? Timestamp.now(),
  });
}

const me = (uid) => doc(as(uid), 'users', uid);

describe('names: /users and /displayNames (QA-06)', () => {
  it('allowed: a new player claims a name (claimDisplayName)', async () => {
    await newPlayer('alice', 'Alice');
    assert.equal((await read('users/alice')).displayName, 'Alice');
    assert.equal((await read('displayNames/alice')).uid, 'alice');
  });

  it('allowed: Cyrillic and Greek names', async () => {
    await newPlayer('olek', 'Олександр Їжак');
    assert.equal((await read('displayNames/олександр їжак')).uid, 'olek');
    await newPlayer('odos', 'ΟΔΟΣ');
    assert.equal((await read('displayNames/οδος')).uid, 'odos');
  });

  it('allowed: Greek names with a final sigma, Korean, a name with a space (R-5 keeps them)', async () => {
    await newPlayer('nikos', 'Νίκος');
    assert.equal((await read('displayNames/νίκος')).uid, 'nikos');
    await newPlayer('sas', 'ΣΑΣ ΣΟΥ');
    assert.equal((await read('displayNames/σας σου')).uid, 'sas');
    await newPlayer('ji', '김지수');
    await newPlayer('ann', 'Ann Lee-Smith_2');
  });

  it('the name picker (displayNameProblem) refuses exactly the names the rules refuse (R-5)', async () => {
    const take = [
      'Alice', 'Олександр Їжак', '김민수', 'İpek', 'Ayşe', 'µ-man', 'ſam', '-ab-',
      'Νίκος', 'ΟΔΟΣ', 'ΣΑΣ ΣΟΥ', 'Σοφια', 'σας_σου', 'Σσς',
      // past the BMP: two UTF-16 units each, as the rules count them too
      '𠀀𠀀', '𠀀𠀀𠀀', '𠀀'.repeat(10),
    ];
    const refuse = [
      // NFKC turns these into a slug the rules refuse: conjoining jamo,
      // a capital, or letters the shown name does not match
      'ㅋㅋㅋ', 'ﾡﾡﾡ', 'Ａｂｃ', 'ᴬbc', 'ℂat', 'ﬁsh', 'Ⅻ Club', 'ⓐbc', '𝐀𝐁𝐂', 'ϒϒϒ', 'ǅemal',
      // the sigma rule, the shape of the name
      'Νίκοσ', 'νικοσ σας', 'Bo  ss', 'ab', 'a'.repeat(21), '𠀀'.repeat(11), 'a.b.c',
    ];
    const verdicts = [];
    for (const [i, name] of [...take, ...refuse].entries()) {
      const picker = displayNameProblem(name) === null;
      let rules = true;
      try { await newPlayer(`n${i}`, name); } catch (e) {
        assert.equal(e?.code, 'permission-denied', `${name}: ${e}`);
        rules = false;
      }
      verdicts.push({ name, picker, rules });
    }
    assert.deepEqual(verdicts.filter((v) => v.picker !== v.rules), []);
    assert.deepEqual(verdicts.filter((v) => !v.rules).map((v) => v.name), refuse);
  });

  it('allowed: a Turkish name with İ, claimed and renamed (R-11)', async () => {
    await newPlayer('ayse', 'İpek');
    assert.equal((await read('users/ayse')).displayNameLower, 'i̇pek');
    actAs('ayse');
    await changeDisplayName('ayse', 'İpek', 'İPEK İnce');
    assert.equal((await read('users/ayse')).displayName, 'İPEK İnce');
    await changeDisplayName('ayse', 'İPEK İnce', 'Ayşe');
    assert.equal(await read('displayNames/i̇pek i̇nce'), undefined);
  });

  it('allowed: a profile from before the reservations renames (R-11)', async () => {
    await seed('users/old', { uid: 'old', displayName: 'Oldie', displayNameLower: 'oldie' });
    actAs('old');
    await changeDisplayName('old', 'Oldie', 'Newbie');
    assert.equal((await read('users/old')).displayNameLower, 'newbie');
    assert.equal((await read('displayNames/newbie')).uid, 'old');
  });

  it('denied: a reservation of a name the client never writes (İ as I, or İ kept in the slug)', async () => {
    await newPlayer('ayse', 'İpek');
    for (const slug of ['ipek', 'İpek']) {
      const b = writeBatch(as('mal'));
      b.set(doc(as('mal'), 'displayNames', slug), { uid: 'mal', createdAt: serverTimestamp() });
      b.set(me('mal'), { uid: 'mal', displayName: 'İpek', displayNameLower: slug, createdAt: serverTimestamp(), lastActive: serverTimestamp() });
      await denied(b.commit());
    }
  });

  it('allowed: claiming the same name again in another case', async () => {
    await newPlayer('alice', 'Alice');
    actAs('alice');
    await claimDisplayName('alice', 'ALICE');
    assert.equal((await read('users/alice')).displayName, 'ALICE');
  });

  it('allowed: a name change releases the old name (changeDisplayName)', async () => {
    await newPlayer('alice', 'Alice');
    actAs('alice');
    await changeDisplayName('alice', 'Alice', 'Alicia');
    assert.equal((await read('users/alice')).displayNameLower, 'alicia');
    assert.equal(await read('displayNames/alice'), undefined);
    assert.equal((await read('displayNames/alicia')).uid, 'alice');
  });

  it("denied: the profile takes another player's reserved name", async () => {
    await newPlayer('alice', 'Alice');
    await newPlayer('bob', 'Bob');
    await denied(updateDoc(me('alice'), { displayName: 'Bob', displayNameLower: 'bob' }));
  });

  it('denied: the shown name differs from the reserved one', async () => {
    await newPlayer('alice', 'Alice');
    await newPlayer('bob', 'Bob');
    await denied(updateDoc(me('alice'), { displayName: 'Bob' }));
  });

  it("denied: another player's name shown through a slug in capitals", async () => {
    await newPlayer('alice', 'Alice');
    await newPlayer('bob', 'Bob');
    const b = writeBatch(as('bob'));
    b.delete(doc(as('bob'), 'displayNames', 'bob'));
    b.set(doc(as('bob'), 'displayNames', 'ALICE'), { uid: 'bob', createdAt: serverTimestamp() });
    b.update(me('bob'), { displayName: 'Alice', displayNameLower: 'ALICE' });
    await denied(b.commit());
  });

  it('denied: a name with regex syntax in it', async () => {
    await newPlayer('alice', 'Alice');
    await denied(updateDoc(me('alice'), { displayName: 'al.*' }));
  });

  it('denied: a profile under a name nobody reserved', async () => {
    await denied(
      setDoc(me('carol'), {
        uid: 'carol',
        displayName: 'Carol',
        displayNameLower: 'carol',
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp(),
      }),
    );
  });

  it('denied: a new profile that starts with stats', async () => {
    const b = writeBatch(as('carol'));
    b.set(doc(as('carol'), 'displayNames', 'carol'), { uid: 'carol', createdAt: serverTimestamp() });
    b.set(me('carol'), {
      uid: 'carol',
      displayName: 'Carol',
      displayNameLower: 'carol',
      createdAt: serverTimestamp(),
      lastActive: serverTimestamp(),
      gamesPlayed: 500,
    });
    await denied(b.commit());
  });

  it('denied: a second reservation (squatting)', async () => {
    await newPlayer('alice', 'Alice');
    await denied(setDoc(doc(as('alice'), 'displayNames', 'qa-squat'), { uid: 'alice' }));
  });

  it('denied: a new name that keeps the old reservation', async () => {
    await newPlayer('alice', 'Alice');
    const b = writeBatch(as('alice'));
    b.set(doc(as('alice'), 'displayNames', 'alicia'), { uid: 'alice', createdAt: serverTimestamp() });
    b.update(me('alice'), { displayName: 'Alicia', displayNameLower: 'alicia' });
    await denied(b.commit());
  });

  it('denied: releasing the name the profile still shows', async () => {
    await newPlayer('alice', 'Alice');
    await denied(deleteDoc(doc(as('alice'), 'displayNames', 'alice')));
  });

  it('denied: a reservation with fields of its own', async () => {
    await newPlayer('alice', 'Alice');
    await denied(
      setDoc(doc(as('alice'), 'displayNames', 'alice'), { uid: 'alice', createdAt: serverTimestamp(), x: 1 }),
    );
  });
});

describe('stats: /users after a saved game (QA-06)', () => {
  beforeEach(async () => {
    await newPlayer('alice', 'Alice');
    await newPlayer('bob', 'Bob');
  });

  it('allowed: the first counted game sets the stats and the best (saveCompletedGame)', async () => {
    const r = await saveGame('alice', { outcome: 'ai-win', total: 150 });
    const u = await read('users/alice');
    assert.equal(r.isNewBest, true);
    assert.equal(u.gamesPlayed, 1);
    assert.equal(u.gamesWon, 0);
    assert.equal(u.bestGamePoints, 150);
    assert.equal(u.bestGameId, r.gameId);
    assert.equal(u.lastGameId, r.gameId);
    assert.equal(u.bestGameSnapshot.moveCount, 12);
    assert.equal(u.longestSurvivalMoves, 12);
  });

  it('allowed: a later game that is not a best, a draw', async () => {
    await saveGame('alice', { total: 300 });
    const r = await saveGame('alice', { outcome: 'draw', total: 100, moveCount: 30 });
    const u = await read('users/alice');
    assert.equal(r.isNewBest, false);
    assert.equal(u.gamesPlayed, 2);
    assert.equal(u.gamesDrawn, 1);
    assert.equal(u.bestGamePoints, 300);
    assert.equal(u.longestSurvivalMoves, 30);
  });

  it('allowed: wins over Strong count, one each, back to back', async () => {
    await saveGame('alice', { outcome: 'human-win', total: 200 });
    await saveGame('alice', { outcome: 'human-win', total: 100 });
    const u = await read('users/alice');
    assert.equal(u.strongWins, 2);
    assert.equal(u.gamesWon, 2);
  });

  it('allowed: a roulette game updates the roulette group', async () => {
    const r = await saveGame('alice', { gameMode: 'roulette', outcome: 'human-win', total: 400 });
    const u = await read('users/alice');
    assert.equal(u.rouletteGamesPlayed, 1);
    assert.equal(u.rouletteBestGameId, r.gameId);
    assert.equal(u.strongWins, 1);
    assert.equal(u.gamesPlayed, undefined);
  });

  it('allowed: a practice game is saved and leaves the profile alone', async () => {
    const r = await saveGame('alice', { outcome: 'human-win', botLevel: 'casual', counted: false });
    assert.equal((await read(`games/${r.gameId}`)).botLevel, 'casual');
    assert.equal((await read('users/alice')).gamesPlayed, undefined);
  });

  it('allowed: a win saved without a bot level counts as Strong, as the client counts it', async () => {
    actAs('alice');
    await saveCompletedGame({
      uid: 'alice',
      displayName: 'Alice',
      log: gameLog(24),
      outcome: 'human-win',
      points: points(),
      chess960Id: 'RNBQKBNR',
      seed: 1,
      humanColor: 'white',
    });
    assert.equal((await read('users/alice')).strongWins, 1);
  });

  it('allowed: strongWins +1 against a fresh Strong win (5 minutes old)', async () => {
    await seedGame('g1', { createdAt: ago(5 * MIN) });
    await updateDoc(me('alice'), { strongWins: 1, lastGameId: 'g1', lastGameAt: serverTimestamp() });
  });

  it('denied: strongWins +1 with no game behind it', async () => {
    await denied(updateDoc(me('alice'), { strongWins: 1, lastGameAt: serverTimestamp() }));
  });

  it('denied: strongWins +1 against a win already counted', async () => {
    const r = await saveGame('alice', { outcome: 'human-win' });
    await denied(
      updateDoc(me('alice'), { strongWins: 2, lastGameId: r.gameId, lastGameAt: serverTimestamp() }),
    );
  });

  it('denied: strongWins +1 against a win older than 10 minutes', async () => {
    await seedGame('g1', { createdAt: ago(11 * MIN) });
    await denied(updateDoc(me('alice'), { strongWins: 1, lastGameId: 'g1', lastGameAt: serverTimestamp() }));
  });

  it('denied: strongWins +1 against a Normal-bot win, a loss, an uncounted game, or a game of another player', async () => {
    await seedGame('normal', { botLevel: 'normal' });
    await seedGame('loss', { outcome: 'ai-win' });
    await seedGame('short', { counted: false });
    await seedGame('bobs', { playerId: 'bob' });
    for (const id of ['normal', 'loss', 'short', 'bobs']) {
      await denied(updateDoc(me('alice'), { strongWins: 1, lastGameId: id, lastGameAt: serverTimestamp() }));
    }
  });

  it('denied: strongWins +1 that leaves lastGameAt where it was', async () => {
    await seedGame('g1');
    await denied(updateDoc(me('alice'), { strongWins: 1, lastGameId: 'g1' }));
  });

  it('denied: strongWins +2 in one write', async () => {
    await seedGame('g1');
    await denied(updateDoc(me('alice'), { strongWins: 2, lastGameId: 'g1', lastGameAt: serverTimestamp() }));
  });

  // R-14 — /games docs saved before these rules (under v1.0.2 or the
  // bridge) were never held to the date and caps checked at create.
  const year2100 = () => Timestamp.fromDate(new Date('2100-01-01T00:00:00Z'));
  const rouletteBest = (id, total) => ({
    rouletteBestPoints: total,
    rouletteBestGameId: id,
    rouletteBestSnapshot: { outcome: 'human-win', moveCount: 12, chess960Id: 'RNBQKBNR', createdAt: serverTimestamp() },
  });

  it('denied (R-14): strongWins +1 against a win dated 2100', async () => {
    await seedGame('future', { createdAt: year2100() });
    await denied(updateDoc(me('alice'), { strongWins: 1, lastGameId: 'future', lastGameAt: serverTimestamp() }));
  });

  it('denied (R-14): a best from a game dated 2100', async () => {
    await seedGame('future', { total: 150, createdAt: year2100() });
    await denied(
      updateDoc(me('alice'), {
        bestGamePoints: 150,
        bestGameId: 'future',
        bestGameSnapshot: { outcome: 'human-win', moveCount: 12, chess960Id: 'RNBQKBNR', createdAt: serverTimestamp() },
      }),
    );
  });

  it('denied (R-14): a roulette best of 6010, or one with quality or rotation points; allowed at the cap', async () => {
    const p = (o) => ({ ...points({ total: 0 }), movePoints: 60, capturePoints: 400, outcomeBonus: 500, ...o });
    await seedGame('r6010', { gameMode: 'roulette', points: p({ qualityPoints: 5050, total: 6010 }) });
    await seedGame('quality', { gameMode: 'roulette', points: p({ qualityPoints: 10, total: 970 }) });
    await seedGame('rotation', { gameMode: 'roulette', points: p({ rotationPoints: 10, total: 970 }) });
    await seedGame('cap', { gameMode: 'roulette', points: p({ movePoints: 750, total: 1650 }) });
    await denied(updateDoc(me('alice'), rouletteBest('r6010', 6010)));
    await denied(updateDoc(me('alice'), rouletteBest('quality', 970)));
    await denied(updateDoc(me('alice'), rouletteBest('rotation', 970)));
    await updateDoc(me('alice'), rouletteBest('cap', 1650));
  });

  it('denied (R-14): a classic best from a game over the classic caps (move, quality, outcome points, moveCount); allowed at them', async () => {
    const best = (id, total) => ({
      bestGamePoints: total,
      bestGameId: id,
      bestGameSnapshot: { outcome: 'human-win', moveCount: 12, chess960Id: 'RNBQKBNR', createdAt: serverTimestamp() },
    });
    // 12 moves: movePoints up to 60, qualityPoints up to 130, outcomeBonus up to 500
    const p = (o) => ({ ...points({ total: 0 }), ...o });
    await seedGame('moves', { points: p({ movePoints: 1500, total: 1500 }) });
    await seedGame('quality', { points: p({ qualityPoints: 1000, total: 1000 }) });
    await seedGame('bonus', { points: p({ outcomeBonus: 2000, total: 2000 }) });
    await seedGame('count', { points: p({ movePoints: 60, total: 60, moveCount: 300 }) });
    await seedGame('cap', { points: p({ movePoints: 60, capturePoints: 400, qualityPoints: 130, outcomeBonus: 500, total: 1090 }) });
    await denied(updateDoc(me('alice'), best('moves', 1500)));
    await denied(updateDoc(me('alice'), best('quality', 1000)));
    await denied(updateDoc(me('alice'), best('bonus', 2000)));
    await denied(updateDoc(me('alice'), best('count', 60)));
    await updateDoc(me('alice'), best('cap', 1090));
  });

  it('denied: a counter below 0 or up by more than one', async () => {
    await denied(updateDoc(me('alice'), { gamesPlayed: -5 }));
    await denied(updateDoc(me('alice'), { gamesPlayed: 2 }));
    await denied(updateDoc(me('alice'), { gamesWon: 2 }));
    await denied(updateDoc(me('alice'), { rouletteGamesPlayed: 1.5 }));
  });

  it('denied: longestSurvivalMoves over 700 or not whole', async () => {
    await denied(updateDoc(me('alice'), { longestSurvivalMoves: 701 }));
    await denied(updateDoc(me('alice'), { longestSurvivalMoves: 12.5 }));
  });

  it('denied: bestGameSnapshot rewritten on its own ("won in 300 moves")', async () => {
    await saveGame('alice', { total: 150 });
    await denied(
      updateDoc(me('alice'), {
        bestGameSnapshot: { outcome: 'human-win', moveCount: 300, chess960Id: 'RNBQKBNR', createdAt: serverTimestamp() },
      }),
    );
  });

  it('denied: a best whose snapshot does not match its game', async () => {
    await seedGame('g1', { total: 900, outcome: 'ai-win' });
    await denied(
      updateDoc(me('alice'), {
        bestGamePoints: 900,
        bestGameId: 'g1',
        bestGameSnapshot: { outcome: 'human-win', moveCount: 12, chess960Id: 'RNBQKBNR', createdAt: serverTimestamp() },
      }),
    );
  });

  it('denied: bestGameId moved to a game with other points', async () => {
    await saveGame('alice', { total: 150 });
    await seedGame('g1', { total: 90, outcome: 'ai-win' });
    await denied(updateDoc(me('alice'), { bestGameId: 'g1' }));
  });

  it('denied: a best from a practice game, or a classic best from a roulette game', async () => {
    await seedGame('practice', { total: 900, outcome: 'ai-win', botLevel: 'casual', counted: false });
    await seedGame('roul', { total: 900, outcome: 'ai-win', gameMode: 'roulette' });
    for (const id of ['practice', 'roul']) {
      await denied(
        updateDoc(me('alice'), {
          bestGamePoints: 900,
          bestGameId: id,
          bestGameSnapshot: { outcome: 'ai-win', moveCount: 12, chess960Id: 'RNBQKBNR', createdAt: serverTimestamp() },
        }),
      );
    }
  });

  it('denied: lastGameAt back-dated or removed', async () => {
    await saveGame('alice');
    await denied(updateDoc(me('alice'), { lastGameAt: ago(60 * MIN) }));
    await denied(updateDoc(me('alice'), { lastGameAt: deleteField() }));
  });

  it('denied: a /games doc with a client-chosen createdAt', async () => {
    actAs('alice');
    const log = { initialTopology: 'A', moves: gameLog(24).moves };
    await denied(
      addDoc(collection(as('alice'), 'games'), {
        playerId: 'alice',
        playerName: 'Alice',
        chess960Id: 'RNBQKBNR',
        seed: 1,
        humanColor: 'white',
        log,
        outcome: 'human-win',
        moveCount: 12,
        points: points(),
        gameMode: 'classic',
        botLevel: 'strong',
        vsAI: true,
        createdAt: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * MIN),
      }),
    );
  });
});

// ── online matches ─────────────────────────────────────────────────────

const HOST = { uid: 'hana', displayName: 'Hana' };
const GUEST = { uid: 'gus', displayName: 'Gus' };

async function match(code) {
  return read(`matches/${code}`);
}

/** The app's own hook (MultiplayerGameView) for `uid`, rendered once on the
 *  server: its write helpers run as they do in the browser. */
async function hookAs(uid, code) {
  actAs(uid);
  const live = await match(code);
  let handle = null;
  function Probe() {
    handle = useMultiplayerSync(live, uid, () => {});
    return null;
  }
  renderToString(React.createElement(Probe));
  return handle;
}

/** createMatch by Hana, joinMatch by Gus — both the app's own. */
async function startMatch(gameMode = 'classic', timeControlSec = null) {
  actAs(HOST.uid);
  const code = await createMatch(HOST, gameMode, timeControlSec, null);
  actAs(GUEST.uid);
  const m = await joinMatch(code, GUEST);
  const white = m.host.color === 'white' ? HOST.uid : GUEST.uid;
  const black = white === HOST.uid ? GUEST.uid : HOST.uid;
  return { code, white, black };
}

/** One legal move by whoever is on turn, through the hook. */
async function playMove(code) {
  const { currentTurn } = await match(code);
  const h = await hookAs(currentTurn, code);
  const move = generateLegalMoves(h.boardState).find((m) => m.kind !== 'topologyToggle');
  await h.sendMove(move);
  return currentTurn;
}

/** The player on turn has been idle `ms`: their turn started that long ago. */
const idle = (code, ms = 100_000) =>
  patch(`matches/${code}`, { lastActivity: ago(ms), turnStartedAt: ago(ms) });
const loserOutcome = (uid) => (uid === HOST.uid ? 'host-resign' : 'guest-resign');

describe('online: /matches (QA-04, QA-05)', () => {
  it('allowed: create, join, and moves that pass the turn (classic)', async () => {
    const { code, white, black } = await startMatch();
    let m = await match(code);
    assert.equal(m.status, 'active');
    assert.equal(m.currentTurn, white);
    await playMove(code);
    m = await match(code);
    assert.equal(m.log.moves.length, 1);
    assert.equal(m.currentTurn, black);
    await playMove(code);
    m = await match(code);
    assert.equal(m.log.moves.length, 2);
    assert.equal(m.currentTurn, white);
  });

  it('allowed: the join and every move stamp turnStartedAt with server time (R-7)', async () => {
    const { code } = await startMatch();
    let m = await match(code);
    assert.ok(m.turnStartedAt instanceof Timestamp);
    const joined = m.turnStartedAt.toMillis();
    await new Promise((r) => setTimeout(r, 20));
    await playMove(code);
    m = await match(code);
    assert.ok(m.turnStartedAt.toMillis() > joined);
  });

  it('allowed (R-7): the player on turn touches the match without moving; the forfeit and the flag claim still land', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code); // Black on turn
    await idle(code);
    await updateDoc(doc(as(black), 'matches', code), { lastActivity: serverTimestamp() });
    actAs(white);
    await writeInactivityForfeit(code, white);
    assert.equal((await match(code)).outcome, loserOutcome(black));

    const timed = await startMatch('classic', 60);
    await playMove(timed.code);
    await idle(timed.code);
    await updateDoc(doc(as(timed.black), 'matches', timed.code), { lastActivity: serverTimestamp() });
    const ok = await (await hookAs(timed.white, timed.code)).writeOutcomeIfFirst(loserOutcome(timed.black), 'flag');
    assert.equal(ok, true);
  });

  it('allowed (R-7): a match from before turnStartedAt counts from lastActivity until its next move sets it', async () => {
    const { code, white, black } = await startMatch();
    await patch(`matches/${code}`, { turnStartedAt: deleteField() });
    await playMove(code);
    assert.ok((await match(code)).turnStartedAt instanceof Timestamp);
    await patch(`matches/${code}`, { turnStartedAt: deleteField(), lastActivity: ago(100_000) });
    actAs(white);
    await writeInactivityForfeit(code, white);
    assert.equal((await match(code)).outcome, loserOutcome(black));
  });

  it('denied (R-7): turnStartedAt moved without a move, back-dated with one, removed, or set at create', async () => {
    const { code, white, black } = await startMatch();
    const fs = (uid) => doc(as(uid), 'matches', code);
    await denied(updateDoc(fs(white), { turnStartedAt: serverTimestamp(), lastActivity: serverTimestamp() }));
    await denied(updateDoc(fs(black), { turnStartedAt: deleteField(), lastActivity: serverTimestamp() }));
    const m = await match(code);
    const entry = { move: { kind: 'topologyToggle' }, san: 'R', topology: 'A', timestamp: Date.now() };
    await denied(updateDoc(fs(white), {
      'log.moves': [...m.log.moves, entry], currentTurn: black, turnStartedAt: ago(10 * MIN), lastActivity: serverTimestamp(),
    }));
    await denied(updateDoc(fs(white), {
      'log.moves': [...m.log.moves, entry], currentTurn: black, lastActivity: serverTimestamp(),
    }));
    await denied(
      setDoc(doc(as(HOST.uid), 'matches', 'ZZZZZZ'), {
        code: 'ZZZZZZ', chess960Id: 'RNBQKBNR', seed: 1, host: { ...HOST, color: 'white' }, guest: null,
        status: 'waiting', currentTurn: '', log: { initialTopology: 'A', moves: [] }, outcome: null,
        createdAt: serverTimestamp(), lastActivity: serverTimestamp(), turnStartedAt: serverTimestamp(),
      }),
    );
  });

  it('denied (R-7): a null, a string or a number put in turnStartedAt of a match from before the field', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code); // Black on turn
    await patch(`matches/${code}`, { turnStartedAt: deleteField() });
    for (const v of [null, 'now', 0]) {
      await denied(updateDoc(doc(as(black), 'matches', code), { turnStartedAt: v, lastActivity: serverTimestamp() }));
    }
    await patch(`matches/${code}`, { lastActivity: ago(100_000) });
    actAs(white);
    await writeInactivityForfeit(code, white);
    assert.equal((await match(code)).outcome, loserOutcome(black));
  });

  it('allowed (R-7): a null turnStartedAt left from the bridge rules reads as absent — the forfeit counts from lastActivity', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code); // Black on turn
    await patch(`matches/${code}`, { turnStartedAt: null, lastActivity: ago(100_000) });
    actAs(white);
    await writeInactivityForfeit(code, white);
    assert.equal((await match(code)).outcome, loserOutcome(black));
  });

  it('allowed: a rotation in classic passes the turn', async () => {
    const { code, white, black } = await startMatch();
    // Classic sendRotate hands off to sendMove without awaiting it.
    await (await hookAs(white, code)).sendRotate();
    let m;
    for (let i = 0; (m = await match(code)).log.moves.length === 0 && i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(m.log.moves.length, 1);
    assert.equal(m.currentTurn, black);
  });

  it('allowed: roulette — spin, an action that keeps the turn, one that passes it', async () => {
    const { code, white, black } = await startMatch('roulette');
    await (await hookAs(white, code)).spinRoulette();
    assert.equal((await match(code)).rouletteActionsLeft, 2);
    await (await hookAs(white, code)).sendRotate();
    let m = await match(code);
    assert.equal(m.log.moves.length, 1);
    assert.equal(m.currentTurn, white);
    await (await hookAs(white, code)).sendRotate();
    m = await match(code);
    assert.equal(m.log.moves.length, 2);
    assert.equal(m.currentTurn, black);
  });

  it('denied (R-8): roulette state written off turn, a spin that is not one, actions that do not run down', async () => {
    const { code, white, black } = await startMatch('roulette');
    const ref = (uid) => doc(as(uid), 'matches', code);
    const spin = (uid, o = {}) =>
      updateDoc(ref(uid), {
        rouletteSlots: ['pawn', 'pawn', 'pawn', 'pawn'],
        rouletteActionsLeft: 2,
        usedRouletteSlots: [],
        rouletteSpinsByPlayer: { [uid]: 1 },
        rouletteSpinCount: 1,
        lastActivity: serverTimestamp(),
        ...o,
      });
    await denied(spin(black)); // off turn
    await denied(spin(white, { rouletteActionsLeft: 5 }));
    await denied(spin(white, { rouletteSlots: ['queen', 'queen', 'queen', 'dragon'] }));
    await denied(spin(white, { rouletteSlots: ['queen', 'queen'] }));
    await denied(spin(white, { rouletteSpinCount: 7 }));
    await denied(spin(white, { rouletteSpinsByPlayer: { [white]: 1, [black]: 9 } }));
    await (await hookAs(white, code)).spinRoulette();
    await denied(spin(white, { rouletteSpinsByPlayer: { [white]: 2 }, rouletteSpinCount: 2 })); // bag already full

    const stamp = { lastActivity: serverTimestamp(), turnStartedAt: serverTimestamp() };
    const entry = () => ({ move: { kind: 'topologyToggle' }, san: 'R', topology: 'A', timestamp: Date.now() });
    await denied(updateDoc(ref(white), { 'log.moves': [entry()], ...stamp })); // actions stay at 2
    await denied(updateDoc(ref(white), { 'log.moves': [entry()], rouletteActionsLeft: 1, usedRouletteSlots: [7], ...stamp }));
    await denied(updateDoc(ref(white), { 'log.moves': [entry()], rouletteActionsLeft: 1, rouletteSlots: ['queen', 'queen', 'queen', 'queen'], ...stamp }));
    await denied(updateDoc(ref(white), { 'log.moves': [entry()], rouletteActionsLeft: 1, currentTurn: black, ...stamp }));
    await denied(updateDoc(ref(black), { rouletteSlots: null, rouletteActionsLeft: 0, lastActivity: serverTimestamp() }));
    await (await hookAs(white, code)).sendRotate(); // the honest first action
    const m = await match(code);
    assert.equal(m.rouletteActionsLeft, 1);
    // the last action must end the turn and empty the bag
    await denied(updateDoc(ref(white), { 'log.moves': [...m.log.moves, entry()], rouletteActionsLeft: 0, ...stamp }));
    await denied(updateDoc(ref(white), { 'log.moves': [...m.log.moves, entry()], currentTurn: black, rouletteActionsLeft: 0, ...stamp }));
  });

  it('denied (M6): a field a match does not have, at the top or in log / guest, the initial topology, roulette state in classic', async () => {
    const { code, white } = await startMatch();
    const ref = doc(as(white), 'matches', code);
    await denied(updateDoc(ref, { clock: { whiteMs: 1 }, lastActivity: serverTimestamp() }));
    await denied(updateDoc(ref, { 'log.note': 'x', lastActivity: serverTimestamp() }));
    await denied(updateDoc(ref, { 'log.initialTopology': 'B', lastActivity: serverTimestamp() }));
    await denied(updateDoc(ref, { rouletteActionsLeft: 2, lastActivity: serverTimestamp() }));
    actAs(HOST.uid);
    const fresh = await createMatch(HOST);
    await denied(
      updateDoc(doc(as(GUEST.uid), 'matches', fresh), {
        guest: { ...GUEST, color: (await match(fresh)).host.color === 'white' ? 'black' : 'white', rating: 3000 },
        status: 'active',
        currentTurn: (await match(fresh)).host.color === 'white' ? HOST.uid : GUEST.uid,
        lastActivity: serverTimestamp(),
        turnStartedAt: serverTimestamp(),
      }),
    );
    await denied(
      setDoc(doc(as(HOST.uid), 'matches', 'ZZZZZZ'), {
        code: 'ZZZZZZ', chess960Id: 'RNBQKBNR', seed: 1, host: { ...HOST, color: 'white' }, guest: null,
        status: 'waiting', currentTurn: '', log: { initialTopology: 'A', moves: [] }, outcome: null,
        rouletteActionsLeft: 2, createdAt: serverTimestamp(), lastActivity: serverTimestamp(),
      }),
    );
  });

  it('allowed: resign, and both players save the match to /games', async () => {
    const { code, white } = await startMatch();
    await playMove(code);
    assert.equal(await (await hookAs(white, code)).resign(), true);
    const m = await match(code);
    assert.equal(m.outcome, loserOutcome(white));
    assert.equal(m.endReason, 'resign');
    for (const uid of [HOST.uid, GUEST.uid]) {
      actAs(uid);
      await saveMultiplayerGameToGames(m, uid);
      assert.equal((await read(`games/mp-${code}-${uid}`)).playerId, uid);
    }
  });

  it('allowed: my own flag fall (resign("flag"))', async () => {
    const { code, white } = await startMatch('classic', 60);
    await playMove(code);
    assert.equal(await (await hookAs(white, code)).resign('flag'), true);
    assert.equal((await match(code)).endReason, 'flag');
  });

  it("allowed: the opponent's flag claim once the flagged side is 90 s idle", async () => {
    const { code, white, black } = await startMatch('classic', 60);
    await playMove(code); // Black is on the clock now
    await idle(code);
    const ok = await (await hookAs(white, code)).writeOutcomeIfFirst(loserOutcome(black), 'flag');
    assert.equal(ok, true);
    const m = await match(code);
    assert.equal(m.outcome, loserOutcome(black));
    assert.equal(m.endReason, 'flag');
  });

  it("denied: the opponent's flag claim before 90 s (writeOutcomeIfFirst says false, the app retries)", async () => {
    const { code, white, black } = await startMatch('classic', 60);
    await playMove(code);
    const ok = await (await hookAs(white, code)).writeOutcomeIfFirst(loserOutcome(black), 'flag');
    assert.equal(ok, false);
    assert.equal((await match(code)).outcome, null);
  });

  it('allowed: the inactivity forfeit after 90 s (writeInactivityForfeit), untimed', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code);
    await idle(code);
    actAs(white);
    await writeInactivityForfeit(code, white);
    const m = await match(code);
    assert.equal(m.outcome, loserOutcome(black));
    assert.equal(m.endReason, 'inactive');
  });

  it('allowed: the inactivity forfeit of a White who never moves, timed', async () => {
    const { code, white, black } = await startMatch('classic', 300);
    await idle(code);
    actAs(black);
    await writeInactivityForfeit(code, black);
    assert.equal((await match(code)).outcome, loserOutcome(white));
  });

  it('allowed: mate / draw written by a player after a move', async () => {
    const { code, black } = await startMatch();
    await playMove(code);
    assert.equal(await (await hookAs(black, code)).writeOutcomeIfFirst('draw'), true);
    const m = await match(code);
    assert.equal(m.outcome, 'draw');
    assert.equal(m.endReason, undefined);
  });

  it("denied: a win written at move 0 (QA-05, RGUASJ)", async () => {
    const { code, white } = await startMatch();
    await denied(
      updateDoc(doc(as(white), 'matches', code), {
        status: 'completed',
        outcome: 'black-win',
        lastActivity: serverTimestamp(),
      }),
    );
  });

  it('denied: a move that keeps the turn (QA-05, 5N4BP3)', async () => {
    const { code, white } = await startMatch();
    const m = await match(code);
    await denied(
      updateDoc(doc(as(white), 'matches', code), {
        'log.moves': [...m.log.moves, { move: { kind: 'topologyToggle' }, san: 'R', topology: 'A', timestamp: Date.now() }],
        lastActivity: serverTimestamp(),
        turnStartedAt: serverTimestamp(),
      }),
    );
  });

  it('denied: an append that also rewrites an earlier move (R-2)', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code);
    await playMove(code);
    const m = await match(code);
    const forged = { ...m.log.moves[0], san: 'Qxf7#' };
    const next = { ...m.log.moves[1], timestamp: Date.now() };
    await denied(
      updateDoc(doc(as(white), 'matches', code), {
        'log.moves': [forged, m.log.moves[1], next],
        currentTurn: black,
        lastActivity: serverTimestamp(),
        turnStartedAt: serverTimestamp(),
      }),
    );
    await denied(
      updateDoc(doc(as(black), 'matches', code), {
        'log.moves': [forged, m.log.moves[1]],
        lastActivity: serverTimestamp(),
      }),
    );
  });

  it('denied: taking the turn without a move', async () => {
    const { code, black } = await startMatch();
    await denied(
      updateDoc(doc(as(black), 'matches', code), { currentTurn: black, lastActivity: serverTimestamp() }),
    );
  });

  it("denied: writing the opponent's resignation before 90 s", async () => {
    const { code, white, black } = await startMatch();
    await playMove(code);
    await denied(
      updateDoc(doc(as(white), 'matches', code), {
        status: 'completed',
        outcome: loserOutcome(black),
        lastActivity: serverTimestamp(),
      }),
    );
  });

  it('denied: the player on turn calling the waiting opponent idle', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code); // Black on turn, thinking 100 s
    await idle(code);
    await denied(
      updateDoc(doc(as(black), 'matches', code), {
        status: 'completed',
        outcome: loserOutcome(white),
        endReason: 'inactive',
        lastActivity: serverTimestamp(),
      }),
    );
  });

  it('denied: a match ended with no outcome, or brought back', async () => {
    const { code, white } = await startMatch();
    await playMove(code);
    const fs = as(white);
    await denied(updateDoc(doc(fs, 'matches', code), { status: 'completed', lastActivity: serverTimestamp() }));
    await denied(updateDoc(doc(fs, 'matches', code), { status: 'waiting', lastActivity: serverTimestamp() }));
    await (await hookAs(white, code)).resign();
    await denied(updateDoc(doc(fs, 'matches', code), { status: 'active', lastActivity: serverTimestamp() }));
  });

  it('denied: back-dating lastActivity to cut the 90 s short', async () => {
    const { code, white } = await startMatch();
    await denied(updateDoc(doc(as(white), 'matches', code), { lastActivity: ago(10 * MIN) }));
  });

  it('denied: turning a classic match into roulette', async () => {
    const { code, white } = await startMatch();
    await denied(
      updateDoc(doc(as(white), 'matches', code), { gameMode: 'roulette', lastActivity: serverTimestamp() }),
    );
  });

  it('denied: an endReason that lies about who ended it', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code);
    await idle(code);
    // The opponent may forfeit Black now, but not as "resigned".
    await denied(
      updateDoc(doc(as(white), 'matches', code), {
        status: 'completed',
        outcome: loserOutcome(black),
        endReason: 'resign',
        lastActivity: serverTimestamp(),
      }),
    );
    // Nor resign as "inactive".
    await denied(
      updateDoc(doc(as(black), 'matches', code), {
        status: 'completed',
        outcome: loserOutcome(black),
        endReason: 'inactive',
        lastActivity: serverTimestamp(),
      }),
    );
  });

  it('denied: an endReason without its outcome, changed afterwards, or on a new match', async () => {
    const { code, white } = await startMatch();
    await playMove(code);
    await denied(
      updateDoc(doc(as(white), 'matches', code), { endReason: 'flag', lastActivity: serverTimestamp() }),
    );
    await denied(
      updateDoc(doc(as(white), 'matches', code), {
        status: 'completed',
        outcome: 'draw',
        endReason: 'flag',
        lastActivity: serverTimestamp(),
      }),
    );
    await (await hookAs(white, code)).resign();
    await denied(
      updateDoc(doc(as(white), 'matches', code), { endReason: 'flag', lastActivity: serverTimestamp() }),
    );
    await denied(
      setDoc(doc(as(HOST.uid), 'matches', 'ZZZZZZ'), {
        code: 'ZZZZZZ',
        chess960Id: 'RNBQKBNR',
        seed: 1,
        host: { ...HOST, color: 'white' },
        guest: null,
        status: 'waiting',
        currentTurn: '',
        log: { initialTopology: 'A', moves: [] },
        outcome: null,
        endReason: 'resign',
        createdAt: serverTimestamp(),
        lastActivity: serverTimestamp(),
      }),
    );
  });

  it('denied: a join that hands the first move to Black, leaves it to nobody, or writes an outcome', async () => {
    actAs(HOST.uid);
    const code = await createMatch(HOST);
    const m = await match(code);
    const guestColor = m.host.color === 'white' ? 'black' : 'white';
    const black = guestColor === 'black' ? GUEST.uid : HOST.uid;
    const white = black === GUEST.uid ? HOST.uid : GUEST.uid;
    const join = { guest: { ...GUEST, color: guestColor }, status: 'active', lastActivity: serverTimestamp() };
    await denied(updateDoc(doc(as(GUEST.uid), 'matches', code), { ...join, currentTurn: black }));
    await denied(updateDoc(doc(as(GUEST.uid), 'matches', code), join));
    await denied(
      updateDoc(doc(as(GUEST.uid), 'matches', code), { ...join, currentTurn: white, outcome: 'draw' }),
    );
  });
});

// ── draw offers ────────────────────────────────────────────────────────

const offerAs = async (uid, code) => (await hookAs(uid, code)).offerDraw();
const answerAs = async (uid, code, accept) => (await hookAs(uid, code)).answerDraw(accept);
const stamp = async (code) => (await match(code)).lastActivity.toMillis();
const turnStart = async (code) => (await match(code)).turnStartedAt.toMillis();

/** A move appended by a client that knows nothing about draw offers: the
 *  drawOffer field left as it is, the rest as the app writes it. */
async function bareMove(code) {
  const m = await match(code);
  const h = await hookAs(m.currentTurn, code);
  const move = generateLegalMoves(h.boardState).find((x) => x.kind !== 'topologyToggle');
  const last = m.log.moves[m.log.moves.length - 1]?.timestamp ?? 0;
  await updateDoc(doc(as(m.currentTurn), 'matches', code), {
    'log.moves': [...m.log.moves, { move, san: 'x', topology: 'A', timestamp: Math.max(Date.now(), last) }],
    currentTurn: m.currentTurn === m.host.uid ? m.guest.uid : m.host.uid,
    lastActivity: serverTimestamp(),
    turnStartedAt: serverTimestamp(),
  });
}

const accept = { status: 'completed', outcome: 'draw', endReason: 'agreement' };
/** An offer as a hand-crafted client would write it, server time and all. */
const offerWrite = (drawOffer) => ({ drawOffer, lastActivity: serverTimestamp() });
/** The opponent's forfeit claim for `loser`, as a hand-crafted client writes it. */
const claim = (loser, endReason) => ({
  status: 'completed',
  outcome: loserOutcome(loser),
  ...(endReason ? { endReason } : {}),
  lastActivity: serverTimestamp(),
});

describe('online: draw offers', () => {
  it('allowed: an offer and a decline (the app’s own); the decline marks the offer and leaves the turn alone', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code); // Black on turn: White offers on the opponent's turn
    const t0 = await stamp(code);
    const turn0 = await turnStart(code);
    await offerAs(white, code);
    let m = await match(code);
    assert.deepEqual(m.drawOffer, { by: white, atPly: 1 });
    const t1 = m.lastActivity.toMillis();
    assert.ok(t1 > t0);
    assert.equal(m.turnStartedAt.toMillis(), turn0); // R-7: an offer is not a move
    await answerAs(black, code, false);
    m = await match(code);
    assert.deepEqual(m.drawOffer, { by: white, atPly: 1, declined: true });
    assert.equal(m.status, 'active');
    assert.equal(m.outcome, null);
    assert.ok(m.lastActivity.toMillis() > t1);
    assert.equal(m.turnStartedAt.toMillis(), turn0); // Black's own turn: no restart
  });

  it('allowed: an accept ends the match, a draw by agreement, and both players save it to /games', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code);
    await offerAs(black, code); // Black offers on its own turn
    await answerAs(white, code, true);
    const m = await match(code);
    assert.equal(m.status, 'completed');
    assert.equal(m.outcome, 'draw');
    assert.equal(m.endReason, 'agreement');
    assert.deepEqual(m.drawOffer, { by: black, atPly: 1 }); // the accepted offer stays
    for (const uid of [HOST.uid, GUEST.uid]) {
      actAs(uid);
      await saveMultiplayerGameToGames(m, uid);
      assert.equal((await read(`games/mp-${code}-${uid}`)).outcome, 'draw');
    }
  });

  it('allowed: any move retires the offer, and the app’s move clears the field, a declined one too', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code);
    await offerAs(white, code);
    assert.deepEqual((await match(code)).drawOffer, { by: white, atPly: 1 });
    await playMove(code); // Black moves instead of answering
    assert.equal((await match(code)).drawOffer, undefined);
    await denied(updateDoc(doc(as(black), 'matches', code), { ...accept, lastActivity: serverTimestamp() }));
    await offerAs(black, code); // White on turn
    await answerAs(white, code, false);
    assert.equal((await match(code)).drawOffer.declined, true);
    await playMove(code);
    assert.equal((await match(code)).drawOffer, undefined);
  });

  it('allowed: the offering player’s own move retires its offer too', async () => {
    const { code, white } = await startMatch();
    await playMove(code);
    await playMove(code); // White on turn
    await offerAs(white, code);
    assert.deepEqual((await match(code)).drawOffer, { by: white, atPly: 2 });
    await playMove(code); // White moves without waiting for an answer
    assert.equal((await match(code)).drawOffer, undefined);
  });

  it('allowed: a move that leaves the field alone retires the offer all the same, and a new one replaces it', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code);
    await offerAs(white, code);
    await bareMove(code); // retired, the field still there
    const m = await match(code);
    assert.equal(m.log.moves.length, 2);
    assert.deepEqual(m.drawOffer, { by: white, atPly: 1 });
    await denied(updateDoc(doc(as(black), 'matches', code), { ...accept, lastActivity: serverTimestamp() }));
    await offerAs(black, code);
    assert.deepEqual((await match(code)).drawOffer, { by: black, atPly: 2 });
  });

  it('allowed (R-7): offering on turn and waiting past 90 s does not forfeit; the decline starts the turn over', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code); // Black on turn
    await idle(code); // Black's turn started 100 s ago
    const turn0 = await turnStart(code);
    await offerAs(black, code); // Black offers on turn and waits for the answer
    assert.deepEqual((await match(code)).drawOffer, { by: black, atPly: 1 });
    assert.equal(await turnStart(code), turn0); // the offer does not restart the turn
    actAs(white);
    await writeInactivityForfeit(code, white); // the app holds its claim
    assert.equal((await match(code)).outcome, null);
    for (const reason of ['inactive', 'flag', null]) {
      await denied(updateDoc(doc(as(white), 'matches', code), claim(black, reason)));
    }
    await idle(code, 10 * MIN); // the answer takes ten minutes: still held
    await denied(updateDoc(doc(as(white), 'matches', code), claim(black, 'inactive')));
    await answerAs(white, code, false);
    const m = await match(code);
    assert.deepEqual(m.drawOffer, { by: black, atPly: 1, declined: true });
    assert.equal(m.turnStartedAt.toMillis(), m.lastActivity.toMillis()); // stamped by the decline
    assert.ok(m.turnStartedAt.toMillis() > Date.now() - MIN);
    actAs(white);
    await writeInactivityForfeit(code, white); // 90 s from the decline: not yet
    assert.equal((await match(code)).outcome, null);
    await denied(updateDoc(doc(as(white), 'matches', code), claim(black, 'inactive')));
    // One offer per half-move: Black cannot put the hold back on.
    await denied(updateDoc(doc(as(black), 'matches', code), offerWrite({ by: black, atPly: 1 })));
    await offerAs(black, code);
    assert.equal((await match(code)).drawOffer.declined, true);
    await idle(code); // 90 s after the decline, no move
    actAs(white);
    await writeInactivityForfeit(code, white);
    const end = await match(code);
    assert.equal(end.outcome, loserOutcome(black));
    assert.equal(end.endReason, 'inactive');
  });

  it('allowed: the hold is only for the player on turn; an offer off turn changes nothing for the forfeit', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code); // Black on turn
    await offerAs(white, code); // White offers on Black's turn
    await idle(code);
    actAs(white);
    await writeInactivityForfeit(code, white); // Black idle 90 s: the offer does not shield Black
    assert.equal((await match(code)).outcome, loserOutcome(black));
  });

  it('allowed: the flag claim and resign with an offer on the table', async () => {
    // Black on the clock offers and leaves: the claim waits for White's answer.
    const flag = await startMatch('classic', 60);
    await playMove(flag.code);
    await offerAs(flag.black, flag.code);
    await idle(flag.code);
    const h = await hookAs(flag.white, flag.code);
    assert.equal(await h.writeOutcomeIfFirst(loserOutcome(flag.black), 'flag'), false);
    await answerAs(flag.white, flag.code, false);
    await idle(flag.code);
    assert.equal(await (await hookAs(flag.white, flag.code)).writeOutcomeIfFirst(loserOutcome(flag.black), 'flag'), true);
    assert.equal((await match(flag.code)).endReason, 'flag');

    // A flag falls on its own player's screen: that one ends it at once.
    const own = await startMatch('classic', 60);
    await playMove(own.code);
    await offerAs(own.black, own.code);
    assert.equal(await (await hookAs(own.black, own.code)).resign('flag'), true);
    assert.equal((await match(own.code)).endReason, 'flag');

    const res = await startMatch();
    await playMove(res.code);
    await offerAs(res.white, res.code);
    assert.deepEqual((await match(res.code)).drawOffer, { by: res.white, atPly: 1 });
    assert.equal(await (await hookAs(res.white, res.code)).resign(), true);
    assert.equal((await match(res.code)).endReason, 'resign');
  });

  it('allowed: roulette — an offer between actions, retired by the next one', async () => {
    const { code, white, black } = await startMatch('roulette');
    await (await hookAs(white, code)).spinRoulette();
    await (await hookAs(white, code)).sendRotate(); // first of White's two actions
    await offerAs(black, code);
    assert.deepEqual((await match(code)).drawOffer, { by: black, atPly: 1 });
    await (await hookAs(white, code)).sendRotate(); // second action
    const m = await match(code);
    assert.equal(m.drawOffer, undefined);
    assert.equal(m.currentTurn, black);
  });

  it("denied: an offer in the other player's name, or by someone not in the match", async () => {
    const { code, white, black } = await startMatch();
    await playMove(code);
    await denied(updateDoc(doc(as(white), 'matches', code), offerWrite({ by: black, atPly: 1 })));
    await denied(updateDoc(doc(as(black), 'matches', code), offerWrite({ by: white, atPly: 1 })));
    await denied(updateDoc(doc(as('mallory'), 'matches', code), offerWrite({ by: 'mallory', atPly: 1 })));
    await denied(updateDoc(doc(as('mallory'), 'matches', code), offerWrite({ by: white, atPly: 1 })));
  });

  it('denied: an offer at another ply than the log, or before the first move', async () => {
    const { code, white } = await startMatch();
    await denied(updateDoc(doc(as(white), 'matches', code), offerWrite({ by: white, atPly: 0 })));
    await playMove(code);
    for (const atPly of [0, 2, '1', 1.5]) {
      await denied(updateDoc(doc(as(white), 'matches', code), offerWrite({ by: white, atPly })));
    }
  });

  it('denied: an offer, or a decline, on a match that is waiting or over', async () => {
    actAs(HOST.uid);
    const waiting = await createMatch(HOST);
    await denied(updateDoc(doc(as(HOST.uid), 'matches', waiting), offerWrite({ by: HOST.uid, atPly: 0 })));
    const resigned = await startMatch();
    await playMove(resigned.code);
    await (await hookAs(resigned.white, resigned.code)).resign();
    await denied(updateDoc(doc(as(resigned.white), 'matches', resigned.code), offerWrite({ by: resigned.white, atPly: 1 })));
    await offerAs(resigned.black, resigned.code); // the app does not try
    assert.equal((await match(resigned.code)).drawOffer, undefined);
    // A draw by agreement is over too: no new offer, no late decline.
    const { code, white, black } = await startMatch();
    await playMove(code);
    await offerAs(black, code);
    await answerAs(white, code, true);
    await denied(updateDoc(doc(as(white), 'matches', code), offerWrite({ by: white, atPly: 1 })));
    await denied(
      updateDoc(doc(as(white), 'matches', code), offerWrite({ by: black, atPly: 1, declined: true })),
    );
  });

  it('denied: a new match that comes with a draw offer', async () => {
    await denied(
      setDoc(doc(as(HOST.uid), 'matches', 'ZZZZZZ'), {
        code: 'ZZZZZZ',
        chess960Id: 'RNBQKBNR',
        seed: 1,
        host: { ...HOST, color: 'white' },
        guest: null,
        status: 'waiting',
        currentTurn: '',
        log: { initialTopology: 'A', moves: [] },
        outcome: null,
        drawOffer: { by: HOST.uid, atPly: 0 },
        createdAt: serverTimestamp(),
        lastActivity: serverTimestamp(),
      }),
    );
  });

  it('denied: a second offer while one stands', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code);
    await offerAs(white, code);
    await denied(updateDoc(doc(as(black), 'matches', code), offerWrite({ by: black, atPly: 1 })));
    await denied(updateDoc(doc(as('mallory'), 'matches', code), offerWrite({ by: 'mallory', atPly: 1 })));
  });

  it('denied: a repeated offer — one per half-move, for both players, and the declined record stays until a move', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code);
    await offerAs(white, code);
    await answerAs(black, code, false);
    const declined = { by: white, atPly: 1, declined: true };
    // Neither the player who offered nor the one who declined offers again at this ply.
    await denied(updateDoc(doc(as(white), 'matches', code), offerWrite({ by: white, atPly: 1 })));
    await denied(updateDoc(doc(as(black), 'matches', code), offerWrite({ by: black, atPly: 1 })));
    // The record cannot be dropped, taken back or rewritten without a move.
    for (const uid of [white, black]) {
      await denied(updateDoc(doc(as(uid), 'matches', code), { drawOffer: deleteField(), lastActivity: serverTimestamp() }));
      await denied(updateDoc(doc(as(uid), 'matches', code), { drawOffer: null, lastActivity: serverTimestamp() }));
      await denied(updateDoc(doc(as(uid), 'matches', code), offerWrite({ by: white, atPly: 1 })));
      await denied(updateDoc(doc(as(uid), 'matches', code), offerWrite({ ...declined, by: black })));
    }
    // The app says why and writes nothing.
    const h = await hookAs(black, code);
    await h.offerDraw();
    assert.deepEqual((await match(code)).drawOffer, declined);
    assert.equal(drawOfferBlock(h.drawTable, black, 1), 'declined');
    // After the next move an offer is allowed again.
    await playMove(code);
    await offerAs(white, code);
    assert.deepEqual((await match(code)).drawOffer, { by: white, atPly: 2 });
  });

  it('denied: an offer that does anything else (another field, a move, fields of its own, a declined one)', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code);
    await denied(
      updateDoc(doc(as(white), 'matches', code), { ...offerWrite({ by: white, atPly: 1 }), rouletteActionsLeft: 2 }),
    );
    await denied(updateDoc(doc(as(white), 'matches', code), offerWrite({ by: white, atPly: 1, note: 'x' })));
    await denied(updateDoc(doc(as(white), 'matches', code), offerWrite({ by: white, atPly: 1, declined: true })));
    await denied(updateDoc(doc(as(white), 'matches', code), offerWrite({ by: white, atPly: 1, declined: false })));
    const m = await match(code);
    await denied(
      updateDoc(doc(as(black), 'matches', code), {
        'log.moves': [...m.log.moves, { move: { kind: 'topologyToggle' }, san: 'R', topology: 'A', timestamp: Date.now() }],
        currentTurn: white,
        turnStartedAt: serverTimestamp(),
        drawOffer: { by: black, atPly: 2 },
        lastActivity: serverTimestamp(),
      }),
    );
  });

  it('denied (R-7): an offer that restarts the turn, a decline that restarts a turn it did not hold or keeps one it did', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code); // Black on turn
    await denied(
      updateDoc(doc(as(black), 'matches', code), { ...offerWrite({ by: black, atPly: 1 }), turnStartedAt: serverTimestamp() }),
    );
    await denied(
      updateDoc(doc(as(white), 'matches', code), { ...offerWrite({ by: white, atPly: 1 }), turnStartedAt: serverTimestamp() }),
    );
    // White's offer on Black's turn held nothing: its decline restarts nothing.
    await offerAs(white, code);
    await denied(
      updateDoc(doc(as(black), 'matches', code), {
        ...offerWrite({ by: white, atPly: 1, declined: true }),
        turnStartedAt: serverTimestamp(),
      }),
    );
    // Black's offer on its own turn held the 90 s: its decline restarts them.
    const held = await startMatch();
    await playMove(held.code);
    await offerAs(held.black, held.code);
    await denied(
      updateDoc(doc(as(held.white), 'matches', held.code), offerWrite({ by: held.black, atPly: 1, declined: true })),
    );
    await denied(
      updateDoc(doc(as(held.white), 'matches', held.code), {
        ...offerWrite({ by: held.black, atPly: 1, declined: true }),
        turnStartedAt: ago(5 * MIN),
      }),
    );
  });

  it('denied: the offering player withdrawing, declining or accepting its own offer', async () => {
    const { code, white } = await startMatch();
    await playMove(code);
    await offerAs(white, code);
    await denied(updateDoc(doc(as(white), 'matches', code), { drawOffer: deleteField(), lastActivity: serverTimestamp() }));
    await denied(updateDoc(doc(as(white), 'matches', code), offerWrite({ by: white, atPly: 1, declined: true })));
    await denied(updateDoc(doc(as(white), 'matches', code), { ...accept, lastActivity: serverTimestamp() }));
  });

  it("denied: agreement with no offer, a retired or declined offer, a resign outcome, a move, or the offer's record changed", async () => {
    const { code, white, black } = await startMatch();
    await playMove(code);
    await denied(updateDoc(doc(as(black), 'matches', code), { ...accept, lastActivity: serverTimestamp() }));
    await offerAs(white, code);
    await denied(
      updateDoc(doc(as(black), 'matches', code), {
        status: 'completed',
        outcome: loserOutcome(black),
        endReason: 'agreement',
        lastActivity: serverTimestamp(),
      }),
    );
    await denied(
      updateDoc(doc(as(black), 'matches', code), { ...accept, endReason: 'resign', lastActivity: serverTimestamp() }),
    );
    const m = await match(code);
    await denied(
      updateDoc(doc(as(black), 'matches', code), {
        ...accept,
        'log.moves': [...m.log.moves, { move: { kind: 'topologyToggle' }, san: 'R', topology: 'A', timestamp: Date.now() }],
        currentTurn: white,
        turnStartedAt: serverTimestamp(),
        lastActivity: serverTimestamp(),
      }),
    );
    await denied(
      updateDoc(doc(as(black), 'matches', code), { ...accept, drawOffer: deleteField(), lastActivity: serverTimestamp() }),
    );
    await denied(
      updateDoc(doc(as(black), 'matches', code), {
        ...accept,
        drawOffer: { by: white, atPly: 1, declined: true },
        lastActivity: serverTimestamp(),
      }),
    );
    await answerAs(black, code, false);
    await denied(updateDoc(doc(as(black), 'matches', code), { ...accept, lastActivity: serverTimestamp() }));
    await bareMove(code); // Black moves: the declined record is left behind, retired
    await offerAs(white, code); // White on turn offers at ply 2 ...
    await bareMove(code); // ... and moves on: retired, the field left behind
    await denied(updateDoc(doc(as(black), 'matches', code), { ...accept, lastActivity: serverTimestamp() }));
    // Nor is a retired offer declined: there is nothing left to answer.
    await denied(updateDoc(doc(as(black), 'matches', code), offerWrite({ by: white, atPly: 2, declined: true })));
  });

  it('denied: agreement written onto a match that is already over', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code);
    await offerAs(black, code);
    // A board draw lands first (R-3: the rules cannot see the board) ...
    await updateDoc(doc(as(white), 'matches', code), {
      status: 'completed',
      outcome: 'draw',
      lastActivity: serverTimestamp(),
    });
    // ... and its end cannot be relabelled afterwards.
    await denied(updateDoc(doc(as(white), 'matches', code), { endReason: 'agreement', lastActivity: serverTimestamp() }));
  });

  it('denied: an offer or a decline without the server time', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code);
    await denied(updateDoc(doc(as(white), 'matches', code), { drawOffer: { by: white, atPly: 1 } }));
    await offerAs(white, code);
    assert.deepEqual((await match(code)).drawOffer, { by: white, atPly: 1 });
    await denied(updateDoc(doc(as(black), 'matches', code), { drawOffer: { by: white, atPly: 1, declined: true } }));
  });

  it('denied (R-2, R-1, names): a draw write that also rewrites the history, the clock or a player', async () => {
    const { code, white, black } = await startMatch('classic', 300);
    await playMove(code);
    await playMove(code); // White on turn, two moves in the log
    const m = await match(code);
    const rewritten = [{ ...m.log.moves[0], san: 'Qxf7#' }, m.log.moves[1]];
    const sneak = [
      { 'log.moves': rewritten }, // R-2
      { timeControlSec: 3600 }, // R-1
      { timeIncrementSec: 30 }, // R-1
      { 'host.displayName': 'Imposter' }, // names
      { 'guest.displayName': 'Imposter' },
      { currentTurn: black },
    ];
    for (const extra of sneak) {
      await denied(updateDoc(doc(as(white), 'matches', code), { ...offerWrite({ by: white, atPly: 2 }), ...extra }));
    }
    await offerAs(white, code); // White offers on its own turn
    for (const extra of sneak) {
      await denied(
        updateDoc(doc(as(black), 'matches', code), {
          ...offerWrite({ by: white, atPly: 2, declined: true }),
          turnStartedAt: serverTimestamp(),
          ...extra,
        }),
      );
      await denied(updateDoc(doc(as(black), 'matches', code), { ...accept, lastActivity: serverTimestamp(), ...extra }));
    }
    // What the draw writes did: the offer, nothing else.
    const after = await match(code);
    assert.deepEqual(after.log.moves, m.log.moves);
    assert.equal(after.timeControlSec, 300);
    assert.deepEqual([after.host, after.guest], [m.host, m.guest]);
    // The honest decline and the next move still pass the clock checks (R-1).
    await answerAs(black, code, false);
    await playMove(code);
    const next = await match(code);
    assert.equal(next.log.moves.length, 3);
    assert.ok(next.log.moves[2].timestamp >= next.log.moves[1].timestamp);
  });
});

describe('Quick match (two players at once)', () => {
  function player(uid, displayName) {
    const w = new Worker(new URL('./actor.mjs', import.meta.url), { workerData: { uid, displayName } });
    const result = new Promise((resolve, reject) => {
      w.once('message', resolve);
      w.once('error', reject);
    });
    return { w, result };
  }

  it('allowed: a waiting player is claimed and joins (findQuickMatch)', async () => {
    const waiter = player('wendy', 'Wendy');
    for (let i = 0; !(await read('mm_queue/wendy')); i++) {
      assert.ok(i < 100, 'the waiter never queued');
      await new Promise((r) => setTimeout(r, 100));
    }
    const claimer = player('carl', 'Carl');
    try {
      const [w, c] = await Promise.all([waiter.result, claimer.result]);
      assert.equal(c.kind, 'hosting');
      assert.deepEqual(w, { kind: 'joined', code: c.code });
      const m = await match(c.code);
      assert.equal(m.status, 'active');
      assert.equal(m.host.uid, 'carl');
      assert.equal(m.guest.uid, 'wendy');
    } finally {
      await Promise.all([waiter.w.terminate(), claimer.w.terminate()]);
    }
  });
});

// ── what v1.0.2 sends ──────────────────────────────────────────────────

describe('old client (v1.0.2)', () => {
  /** saveCompletedGame as it was: same /games doc, profile patch without lastGameId. */
  async function oldSave(uid, outcome) {
    const fs = as(uid);
    const ref = await addDoc(collection(fs, 'games'), {
      playerId: uid,
      playerName: 'Alice',
      chess960Id: 'RNBQKBNR',
      seed: 1,
      humanColor: 'white',
      log: { initialTopology: 'A', moves: gameLog(24).moves },
      outcome,
      moveCount: 12,
      points: points(),
      gameMode: 'classic',
      vsAI: true,
      createdAt: serverTimestamp(),
      botLevel: 'strong',
    });
    await runTransaction(fs, async (tx) => {
      const cur = (await tx.get(me(uid))).data();
      const p = {
        lastGameAt: serverTimestamp(),
        lastActive: serverTimestamp(),
        gamesPlayed: (cur.gamesPlayed ?? 0) + 1,
        gamesWon: (cur.gamesWon ?? 0) + (outcome === 'human-win' ? 1 : 0),
        gamesDrawn: cur.gamesDrawn ?? 0,
        longestSurvivalMoves: Math.max(cur.longestSurvivalMoves ?? 0, 12),
      };
      if (outcome === 'human-win') p.strongWins = (cur.strongWins ?? 0) + 1;
      tx.update(me(uid), p);
    });
  }

  beforeEach(async () => {
    await newPlayer('alice', 'Alice');
  });

  it('still works: a game that is not a Strong win', async () => {
    await oldSave('alice', 'ai-win');
    assert.equal((await read('users/alice')).gamesPlayed, 1);
  });

  it('BREAKS: a Strong win — the game is saved, its profile stats are refused', async () => {
    await denied(oldSave('alice', 'human-win'));
    assert.equal((await read('users/alice')).gamesPlayed, undefined);
  });

  it('still works: resign and the 90 s forfeit without endReason', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code);
    await idle(code);
    await updateDoc(doc(as(white), 'matches', code), {
      status: 'completed',
      outcome: loserOutcome(black),
      lastActivity: serverTimestamp(),
    });
    const second = await startMatch();
    await updateDoc(doc(as(second.white), 'matches', second.code), {
      status: 'completed',
      outcome: loserOutcome(second.white),
      lastActivity: serverTimestamp(),
    });
  });

  it('still works: resign, the forfeit and a board draw with a draw offer on the table', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code);
    await offerAs(white, code);
    assert.deepEqual((await match(code)).drawOffer, { by: white, atPly: 1 });
    await idle(code);
    await updateDoc(doc(as(white), 'matches', code), {
      status: 'completed',
      outcome: loserOutcome(black),
      lastActivity: serverTimestamp(),
    });
    const second = await startMatch();
    await playMove(second.code);
    await offerAs(second.black, second.code);
    assert.deepEqual((await match(second.code)).drawOffer, { by: second.black, atPly: 1 });
    await updateDoc(doc(as(second.white), 'matches', second.code), {
      status: 'completed',
      outcome: 'draw',
      lastActivity: serverTimestamp(),
    });
  });

  it("BREAKS: the opponent's flag claim before 90 s (it does not retry)", async () => {
    const { code, white, black } = await startMatch('classic', 60);
    await playMove(code);
    await denied(
      updateDoc(doc(as(white), 'matches', code), {
        status: 'completed',
        outcome: loserOutcome(black),
        lastActivity: serverTimestamp(),
      }),
    );
  });
});

// ── what the rules still cannot tell ───────────────────────────────────

describe('known limits (allowed, by design or by what rules can see)', () => {
  beforeEach(async () => {
    await newPlayer('alice', 'Alice');
  });

  it('a counter +1 per write with no game behind it', async () => {
    await updateDoc(me('alice'), { gamesPlayed: 1 });
    await updateDoc(me('alice'), { gamesPlayed: 2 });
  });

  it('longestSurvivalMoves up to 700 with no game behind it', async () => {
    await updateDoc(me('alice'), { longestSurvivalMoves: 700 });
  });

  it('a made-up Strong win in /games counts once (rules cannot replay chess)', async () => {
    actAs('alice');
    const ref = await addDoc(collection(as('alice'), 'games'), {
      playerId: 'alice',
      playerName: 'Alice',
      chess960Id: 'RNBQKBNR',
      seed: 1,
      humanColor: 'white',
      log: { initialTopology: 'A', moves: gameLog(24).moves },
      outcome: 'human-win',
      moveCount: 12,
      points: points(),
      gameMode: 'classic',
      botLevel: 'strong',
      vsAI: true,
      createdAt: serverTimestamp(),
    });
    await updateDoc(me('alice'), { strongWins: 1, lastGameId: ref.id, lastGameAt: serverTimestamp() });
    await denied(updateDoc(me('alice'), { strongWins: 2, lastGameId: ref.id, lastGameAt: serverTimestamp() }));
  });

  it('QA-05 stays open online (R-3 not done): after one move either player writes a win or a draw, on either turn', async () => {
    const { code, white } = await startMatch();
    await playMove(code); // Black on turn, no mate anywhere
    await updateDoc(doc(as(white), 'matches', code), {
      status: 'completed',
      outcome: 'white-win',
      lastActivity: serverTimestamp(),
    });
    assert.equal((await match(code)).outcome, 'white-win');
  });

  it('in a timed match the opponent can end it after 90 s idle, clock or not', async () => {
    const { code, white, black } = await startMatch('classic', 600);
    await playMove(code);
    await idle(code);
    await updateDoc(doc(as(white), 'matches', code), {
      status: 'completed',
      outcome: loserOutcome(black),
      endReason: 'inactive',
      lastActivity: serverTimestamp(),
    });
  });

  it('a seated player may stamp lastActivity with a write that changes nothing else (harmless since R-7: the forfeit still comes)', async () => {
    const { code, white, black } = await startMatch();
    await playMove(code); // Black on turn
    await idle(code);
    await updateDoc(doc(as(black), 'matches', code), { lastActivity: serverTimestamp() });
    actAs(white);
    await writeInactivityForfeit(code, white);
    assert.equal((await match(code)).outcome, loserOutcome(black));
  });

  it('a name NFKC changes (fullwidth letters) cannot be claimed', async () => {
    actAs('fw');
    await assert.rejects(claimDisplayName('fw', 'ＡＢＣ'), (e) => e?.code === 'permission-denied');
  });
});
