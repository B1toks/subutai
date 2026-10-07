// The v1.0.2 client (tag v1.0.2, real src/, see old-client.mjs) against this branch's firestore.rules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Worker } from 'node:worker_threads';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp, collection, doc, getDoc, getDocs, runTransaction, serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';
import { PROJECT_ID, actAs, firestoreFor, terminateAll } from './client-stub.mjs';
import { oldClientSrc } from './old-client.mjs';

const OLD = oldClientSrc();
const from = (p) => import(new URL(p, OLD).href);
const { claimDisplayName, changeDisplayName } = await from('firebase/auth.ts');
const { saveCompletedGame } = await from('firebase/games.ts');
const { createMatch, joinMatch } = await from('firebase/matches.ts');
const { saveMultiplayerGameToGames } = await from('firebase/multiplayerGames.ts');
const { useMultiplayerSync } = await from('components/MultiplayerGameView.tsx');
const { generateLegalMoves } = await from('engine/moves.ts');
// The current client, for the opponent's side of a match (R-7: v1.0.2 cannot join one).
const { joinMatch: joinMatchNow } = await import('../../src/firebase/matches.ts');
const { useMultiplayerSync: useSyncNow } = await import('../../src/components/MultiplayerGameView.tsx');

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); });
after(async () => { await terminateAll(); await env.cleanup(); });

const owner = () => firestoreFor('owner');
const read = async (p) => (await getDoc(doc(owner(), p))).data();
const seed = (p, d) => setDoc(doc(owner(), p), d);
const denied = (p) => assert.rejects(p, (e) => e?.code === 'permission-denied');

function points({ total = 120, moveCount = 12, counted = true } = {}) {
  return { movePoints: total, capturePoints: 0, qualityPoints: 0, rotationPoints: 0, outcomeBonus: 0, total, moveCount,
    captureValueCp: 0, moveQualityCounts: { brilliant: 0, best: 0, good: 0, mistake: 0, blunder: 0 }, counted };
}
function gameLog(n) {
  return { id: 'log', createdAt: new Date().toISOString(), randomSeed: 1, initialTopology: 'A', initialState: null,
    moves: Array.from({ length: n }, (_, i) => ({ san: 'R', move: { kind: 'topologyToggle' }, topology: 'A', timestamp: 1000 + i })) };
}
async function save(uid, { outcome = 'ai-win', total = 120, moveCount = 12, counted = true, gameMode = 'classic', botLevel = 'strong' } = {}) {
  actAs(uid);
  return saveCompletedGame({ uid, displayName: 'Alice', log: gameLog(moveCount * 2), outcome, points: points({ total, moveCount, counted }),
    chess960Id: 'RNBQKBNR', seed: 1, humanColor: 'white', gameMode, durationMs: 61234, botLevel });
}

describe('v1.0.2 profile and saves', () => {
  it('profile: claimDisplayName / changeDisplayName work', async () => {
    actAs('alice');
    await claimDisplayName('alice', 'Alice');
    await changeDisplayName('alice', 'Alice', 'Алиса');
    assert.equal((await read('users/alice')).displayNameLower, 'алиса');
  });
  it('profile (fixed, R-11): a Turkish name with İ is claimed', async () => {
    actAs('ayse');
    await claimDisplayName('ayse', 'İpek');
    assert.equal((await read('users/ayse')).displayName, 'İpek');
  });
  it('profile (fixed, R-11): a legacy profile with no reservation renames', async () => {
    await seed('users/old', { uid: 'old', displayName: 'Oldie', displayNameLower: 'oldie' });
    actAs('old');
    await changeDisplayName('old', 'Oldie', 'Newbie');
    assert.equal((await read('users/old')).displayNameLower, 'newbie');
  });
  it('save: loss, draw, first best (classic) — profile updated', async () => {
    actAs('alice'); await claimDisplayName('alice', 'Alice');
    await save('alice', { outcome: 'ai-win', total: 150 });
    await save('alice', { outcome: 'draw', total: 100 });
    const u = await read('users/alice');
    assert.equal(u.gamesPlayed, 2); assert.equal(u.bestGamePoints, 150);
  });
  it('save: roulette best — profile updated', async () => {
    actAs('alice'); await claimDisplayName('alice', 'Alice');
    await save('alice', { gameMode: 'roulette', total: 300 });
    assert.equal((await read('users/alice')).rouletteBestPoints, 300);
  });
  it('save: practice game — saved, profile untouched', async () => {
    actAs('alice'); await claimDisplayName('alice', 'Alice');
    await save('alice', { botLevel: 'normal', counted: false, outcome: 'human-win' });
    assert.equal((await read('users/alice')).gamesPlayed, undefined);
  });
  it('save: a WIN over Strong — /games saved, the whole profile update refused (gamesPlayed, best, strongWins lost)', async () => {
    actAs('alice'); await claimDisplayName('alice', 'Alice');
    await denied(save('alice', { outcome: 'human-win', total: 400 }));
    const u = await read('users/alice');
    assert.equal(u.gamesPlayed, undefined); assert.equal(u.bestGamePoints, undefined); assert.equal(u.strongWins, undefined);
    const games = await getDocs(collection(owner(), 'games'));
    assert.equal(games.size, 1);
  });
});

async function hookAs(uid, code, hook = useMultiplayerSync) {
  actAs(uid);
  const live = await read(`matches/${code}`);
  let h = null;
  function Probe() { h = hook(live, uid, () => {}); return null; }
  renderToString(React.createElement(Probe));
  return h;
}
/** A match v1.0.2 creates and the CURRENT client joins: a v1.0.2 join is
 *  refused since R-7 (tested below), so the opponent sits on the new app. */
async function start(mode = 'classic', tc = null) {
  const H = { uid: 'hana', displayName: 'Hana' }, G = { uid: 'gus', displayName: 'Gus' };
  actAs(H.uid); const code = await createMatch(H, mode, tc, null);
  actAs(G.uid); const m = await joinMatchNow(code, G);
  const white = m.host.color === 'white' ? H.uid : G.uid;
  return { code, white, black: white === H.uid ? G.uid : H.uid };
}
/** One legal move by whoever is on turn, through the CURRENT client's hook. */
async function play(code) {
  const { currentTurn } = await read(`matches/${code}`);
  const h = await hookAs(currentTurn, code, useSyncNow);
  await h.sendMove(generateLegalMoves(h.boardState).find((x) => x.kind !== 'topologyToggle'));
}
const loserOf = (uid) => (uid === 'hana' ? 'host-resign' : 'guest-resign');

describe('v1.0.2 online', () => {
  it('BREAKS (R-7): joinMatch is refused — it does not stamp turnStartedAt', async () => {
    actAs('hana'); const code = await createMatch({ uid: 'hana', displayName: 'Hana' }, 'classic', null, null);
    actAs('gus'); await denied(joinMatch(code, { uid: 'gus', displayName: 'Gus' }));
    assert.equal((await read(`matches/${code}`)).status, 'waiting');
  });
  it('BREAKS (R-7): its moves are refused — they do not stamp turnStartedAt (the hook shows "Move failed")', async () => {
    const { code, white } = await start();
    const h = await hookAs(white, code);
    await h.sendMove(generateLegalMoves(h.boardState).find((x) => x.kind !== 'topologyToggle'));
    assert.equal((await read(`matches/${code}`)).log.moves.length, 0);
  });
  it('roulette: the spin works; BREAKS (R-7): its actions (appends) are refused', async () => {
    const { code, white } = await start('roulette');
    await (await hookAs(white, code)).spinRoulette();
    assert.equal((await read(`matches/${code}`)).rouletteActionsLeft, 2);
    await (await hookAs(white, code)).sendRotate();
    assert.equal((await read(`matches/${code}`)).log.moves.length, 0);
  });
  it('resign, and both save the match to /games', async () => {
    const { code, white } = await start();
    await play(code);
    assert.equal(await (await hookAs(white, code)).resign(), true);
    const m = await read(`matches/${code}`);
    for (const uid of ['hana', 'gus']) { actAs(uid); await saveMultiplayerGameToGames(m, uid); }
    assert.equal((await getDocs(collection(owner(), 'games'))).size, 2);
  });
  it('own flag fall (resign) works', async () => {
    const { code, white } = await start('classic', 60);
    await play(code);
    assert.equal(await (await hookAs(white, code)).resign(), true);
  });
  it('mate/draw write by writeOutcomeIfFirst works', async () => {
    const { code, white } = await start();
    await play(code);
    await (await hookAs(white, code)).writeOutcomeIfFirst('white-win');
    assert.equal((await read(`matches/${code}`)).outcome, 'white-win');
  });
  it('BREAKS: opponent flag claim < 90 s after the last move — refused, v1.0.2 does not retry (flagFiredRef), timed match after move 1 has no watchdog -> stays active', async () => {
    const { code, white, black } = await start('classic', 60);
    await play(code); // black on the clock, black's client gone
    await (await hookAs(white, code)).writeOutcomeIfFirst(loserOf(black));
    assert.equal((await read(`matches/${code}`)).outcome, null);
  });
  it('inactivity forfeit transaction (copy of v1.0.2 watchdog write) after 90 s, untimed', async () => {
    const { code, white, black } = await start();
    await play(code);
    // v1.0.2 waits 90 s from lastActivity, never earlier than the rules' turnStartedAt.
    const ago100 = Timestamp.fromMillis(Date.now() - 100_000);
    await updateDoc(doc(owner(), `matches/${code}`), { lastActivity: ago100, turnStartedAt: ago100 });
    actAs(white);
    const db = firestoreFor(white);
    await runTransaction(db, async (tx) => {
      const ref = doc(db, 'matches', code);
      await tx.get(ref);
      tx.update(ref, { status: 'completed', outcome: loserOf(black), lastActivity: serverTimestamp() });
    });
    assert.equal((await read(`matches/${code}`)).outcome, loserOf(black));
  });
  it('BREAKS (R-7): Quick match — the claimer hosts, the waiter\'s joinMatch is refused and it reports a timeout', async () => {
    const run = (uid, displayName) => new Promise((res, rej) => {
      const w = new Worker(new URL('./actor.mjs', import.meta.url), { workerData: { uid, displayName, src: OLD.href }, execArgv: ['--import', new URL('./register.mjs', import.meta.url).href] });
      w.once('message', res); w.once('error', rej);
    });
    const a = run('qa1', 'Qone');
    await new Promise((r) => setTimeout(r, 1500));
    const b = run('qb2', 'Qtwo');
    const [ra, rb] = await Promise.all([a, b]);
    console.log('quick match:', ra, rb);
    assert.equal(rb.kind, 'hosting');
    assert.equal(ra.kind, 'timeout');
  });
});

describe('extra (rules level)', () => {
  it('any signed-in user lists every match (friend codes enumerable)', async () => {
    await start();
    const s = await getDocs(collection(firestoreFor('stranger'), 'matches'));
    assert.equal(s.size, 1);
  });
  it('mm_queue entry with createdAt in 1970 (sorts first forever)', async () => {
    await setDoc(doc(firestoreFor('troll'), 'mm_queue/troll'), { uid: 'troll', displayName: 'Troll', matchCode: null, createdAt: Timestamp.fromMillis(0) });
  });
  it('mm_queue owner resets matchCode to null after being claimed (bait)', async () => {
    await setDoc(doc(firestoreFor('troll'), 'mm_queue/troll'), { uid: 'troll', displayName: 'Troll', matchCode: null, createdAt: serverTimestamp() });
    await updateDoc(doc(firestoreFor('victim'), 'mm_queue/troll'), { matchCode: 'ABCDEF', claimedBy: 'victim' });
    await updateDoc(doc(firestoreFor('troll'), 'mm_queue/troll'), { matchCode: null });
  });
  it('roulette DENIED (R-8): off turn, the opponent poisons the bag (4 kings, 0 actions left)', async () => {
    const { code, black } = await start('roulette');
    await denied(updateDoc(doc(firestoreFor(black), `matches/${code}`), { rouletteSlots: ['king', 'king', 'king', 'king'], rouletteActionsLeft: 0, lastActivity: serverTimestamp() }));
  });
});
