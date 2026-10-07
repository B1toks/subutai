// Online clock forgery through client-written move timestamps (fix/rules code).
// Honest moves go through the app's own hook (useMultiplayerSync); the attacker
// writes raw. The clock is computed with the formula of App.tsx mpClocks
// (fix/rules, src/App.tsx:2981-3015), copied verbatim below.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { PROJECT_ID, actAs, firestoreFor, terminateAll } from './client-stub.mjs';

const { createMatch, joinMatch } = await import('../../src/firebase/matches.ts');
const { useMultiplayerSync } = await import('../../src/components/MultiplayerGameView.tsx');
const { generateLegalMoves } = await import('../../src/engine/moves.ts');

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); });
after(async () => { await terminateAll(); await env.cleanup(); });

const read = async (p) => (await getDoc(doc(firestoreFor('owner'), p))).data();
async function hookAs(uid, code) {
  actAs(uid);
  const live = await read(`matches/${code}`);
  let h = null;
  function Probe() { h = useMultiplayerSync(live, uid, () => {}); return null; }
  renderToString(React.createElement(Probe));
  return h;
}
// verbatim from App.tsx mpClocks (fix/rules), live branch with mpNow = Date.now()
function mpClocks(match) {
  const moves = match.log.moves;
  const incMs = (match.timeIncrementSec ?? 0) * 1000;
  let usedWhite = 0, usedBlack = 0;
  for (let i = 1; i < moves.length; i++) {
    const dt = Math.max(0, (moves[i].timestamp ?? 0) - (moves[i - 1].timestamp ?? 0));
    if (i % 2 === 0) usedWhite += dt; else usedBlack += dt;
  }
  const mpNow = Date.now();
  if (moves.length > 0) {
    const live = Math.max(0, mpNow - (moves[moves.length - 1].timestamp ?? mpNow));
    if (moves.length % 2 === 0) usedWhite += live; else usedBlack += live;
  }
  const total = match.timeControlSec * 1000;
  return {
    white: Math.max(0, total + Math.ceil(moves.length / 2) * incMs - usedWhite),
    black: Math.max(0, total + Math.floor(moves.length / 2) * incMs - usedBlack),
  };
}

describe('C: clock forgery in a timed match (5 min)', () => {
  it('C1 a back-dated timestamp on my own legal-turn move empties the honest opponent\'s clock; their client then resigns itself', async () => {
    const H = { uid: 'hana', displayName: 'Hana' }, G = { uid: 'gus', displayName: 'Gus' };
    actAs(H.uid);
    const code = await createMatch(H, 'classic', 300, null);
    actAs(G.uid);
    const m0 = await joinMatch(code, G);
    const white = m0.host.color === 'white' ? H.uid : G.uid;
    const black = white === H.uid ? G.uid : H.uid;

    // honest White moves through the app
    const hw = await hookAs(white, code);
    await hw.sendMove(generateLegalMoves(hw.boardState).find((mv) => mv.kind !== 'topologyToggle'));
    let m = await read(`matches/${code}`);
    assert.equal(m.currentTurn, black);

    // Black (attacker): take White's honest entry, append a reply whose timestamp is 10 min in the past
    const forged = { ...m.log.moves[0], timestamp: Date.now() - 10 * 60_000 };
    await updateDoc(doc(firestoreFor(black), `matches/${code}`), {
      'log.moves': [...m.log.moves, forged], currentTurn: white, lastActivity: serverTimestamp(),
    });
    m = await read(`matches/${code}`);
    const clocks = mpClocks(m);
    console.log('clocks after forged move:', clocks);
    assert.equal(clocks.white, 0, 'White (honest, on turn) shows 0:00');
    assert.ok(clocks.black >= 299_000, 'Black lost no time');

    // honest White's client: mine <= 0 -> resign('flag') (App.tsx:3031-3033) — rules accept it
    const hw2 = await hookAs(white, code);
    assert.equal(await hw2.resign('flag'), true);
    m = await read(`matches/${code}`);
    console.log('outcome:', m.outcome, m.endReason);
    assert.equal(m.endReason, 'flag');
  });

  it('C3 off turn, with no move, the opponent sets timeControlSec to 1 on an UNTIMED match: the honest client now counts down and flags', async () => {
    const H = { uid: 'hana', displayName: 'Hana' }, G = { uid: 'gus', displayName: 'Gus' };
    actAs(H.uid);
    const code = await createMatch(H, 'classic', null, null);
    actAs(G.uid);
    const m0 = await joinMatch(code, G);
    const white = m0.host.color === 'white' ? H.uid : G.uid;
    const black = white === H.uid ? G.uid : H.uid;
    const hw = await hookAs(white, code);
    await hw.sendMove(generateLegalMoves(hw.boardState).find((mv) => mv.kind !== 'topologyToggle'));
    const hb = await hookAs(black, code);
    await hb.sendMove(generateLegalMoves(hb.boardState).find((mv) => mv.kind !== 'topologyToggle'));
    await new Promise((r) => setTimeout(r, 1200));
    // White on turn; Black (off turn) rewrites the time control
    await updateDoc(doc(firestoreFor(black), `matches/${code}`), { timeControlSec: 1, lastActivity: serverTimestamp() });
    const m = await read(`matches/${code}`);
    const c = mpClocks(m);
    console.log('C3 clocks:', c);
    assert.equal(c.white, 0);
  });

  it('C2 the flagged attacker stalls: pings lastActivity every <90 s, the honest flag claim never lands', async () => {
    const H = { uid: 'hana', displayName: 'Hana' }, G = { uid: 'gus', displayName: 'Gus' };
    actAs(H.uid);
    const code = await createMatch(H, 'classic', 60, null);
    actAs(G.uid);
    const m0 = await joinMatch(code, G);
    const white = m0.host.color === 'white' ? H.uid : G.uid;
    const black = white === H.uid ? G.uid : H.uid;
    const hw = await hookAs(white, code);
    await hw.sendMove(generateLegalMoves(hw.boardState).find((mv) => mv.kind !== 'topologyToggle'));
    // Black (attacker) is on turn; pretend 5 min have passed (its 60 s flag is long down)
    await updateDoc(doc(firestoreFor('owner'), `matches/${code}`), { lastActivity: Timestamp.fromMillis(Date.now() - 300_000) });
    // attacker pings
    await updateDoc(doc(firestoreFor(black), `matches/${code}`), { lastActivity: serverTimestamp() });
    // honest White claims the flag through the app
    const hw2 = await hookAs(white, code);
    const loser = black === H.uid ? 'host-resign' : 'guest-resign';
    assert.equal(await hw2.writeOutcomeIfFirst(loser, 'flag'), false);
    assert.equal((await read(`matches/${code}`)).outcome, null);
  });
});
