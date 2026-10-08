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
import { createMockUserToken } from '@firebase/util';
import { Timestamp, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { PROJECT_ID, actAs, firestoreFor, terminateAll } from './client-stub.mjs';

const { createMatch, joinMatch } = await import('../../src/firebase/matches.ts');
const { useMultiplayerSync } = await import('../../src/components/MultiplayerGameView.tsx');
const { generateLegalMoves } = await import('../../src/engine/moves.ts');

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync(process.env.RULES_FILE ?? new URL('../../firestore.rules', import.meta.url), 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); });
after(async () => { await terminateAll(); await env.cleanup(); });

const read = async (p) => (await getDoc(doc(firestoreFor('owner'), p))).data();
const denied = (p) => assert.rejects(p, (e) => e?.code === 'permission-denied');
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

async function start(tc, inc = null, mode = 'classic') {
  const H = { uid: 'hana', displayName: 'Hana' }, G = { uid: 'gus', displayName: 'Gus' };
  actAs(H.uid);
  const code = await createMatch(H, mode, tc, inc);
  actAs(G.uid);
  const m0 = await joinMatch(code, G);
  const white = m0.host.color === 'white' ? H.uid : G.uid;
  const black = white === H.uid ? G.uid : H.uid;
  return { code, white, black };
}
/** One legal move by `uid` through the app's hook. */
async function honestMove(uid, code) {
  const h = await hookAs(uid, code);
  await h.sendMove(generateLegalMoves(h.boardState).find((mv) => mv.kind !== 'topologyToggle'));
}
/** Appends to the log, through REST as `uid`, a copy of the last entry
 *  stamped `stamp` (a decimal string: an int64 the JS SDK cannot write, it
 *  sends numbers past 2^53 as doubles), passing the turn to `next`; `patch`
 *  sets more fields, as REST values. Resolves to { status, json }. */
async function restAppend(uid, code, stamp, next, patch = {}) {
  const base = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const name = `projects/${PROJECT_ID}/databases/(default)/documents/matches/${code}`;
  const call = async (url, token, body) => {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };
  const { json: cur } = await call(`${base}/matches/${code}`, 'owner');
  const moves = cur.fields.log.mapValue.fields.moves.arrayValue.values;
  const entry = structuredClone(moves[moves.length - 1]);
  entry.mapValue.fields.timestamp = { integerValue: stamp };
  moves.push(entry);
  cur.fields.currentTurn = { stringValue: next };
  Object.assign(cur.fields, patch);
  const token = createMockUserToken({ sub: uid, user_id: uid }, PROJECT_ID);
  return call(`${base}:commit`, token, {
    writes: [{
      update: { name, fields: cur.fields },
      updateTransforms: ['lastActivity', 'turnStartedAt'].map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })),
    }],
  });
}
/** Runs fn with Date.now() off by skewMs, as on a device whose clock is wrong. */
async function withClock(skewMs, fn) {
  const real = Date.now;
  Date.now = () => real.call(Date) + skewMs;
  try { return await fn(); } finally { Date.now = real; }
}

describe('C: clock forgery in a timed match (5 min)', () => {
  it('C1 DENIED (R-1): a timestamp back-dated 10 min on my own legal-turn move is refused; the honest clock stays full', async () => {
    const { code, white, black } = await start(300);

    // honest White moves through the app
    await honestMove(white, code);
    let m = await read(`matches/${code}`);
    assert.equal(m.currentTurn, black);

    // Black (attacker): take White's honest entry, append a reply whose timestamp is 10 min in the past
    const forged = { ...m.log.moves[0], timestamp: Date.now() - 10 * 60_000 };
    await denied(updateDoc(doc(firestoreFor(black), `matches/${code}`), {
      'log.moves': [...m.log.moves, forged], currentTurn: white, lastActivity: serverTimestamp(), turnStartedAt: serverTimestamp(),
    }));
    m = await read(`matches/${code}`);
    assert.equal(m.log.moves.length, 1);
    const clocks = mpClocks(m);
    assert.ok(clocks.white > 290_000 && clocks.black > 290_000, JSON.stringify(clocks));
  });

  it('C3 DENIED (R-1): the time control is frozen once the match exists, and set only to a real one', async () => {
    const { code, white, black } = await start(null);
    await honestMove(white, code);
    await honestMove(black, code);
    // White on turn; Black (off turn) rewrites the time control
    await denied(updateDoc(doc(firestoreFor(black), `matches/${code}`), { timeControlSec: 1, lastActivity: serverTimestamp() }));
    await denied(updateDoc(doc(firestoreFor(black), `matches/${code}`), { timeIncrementSec: 30, lastActivity: serverTimestamp() }));
    // ...nor on a timed one, nor by the player on turn with a move
    const t = await start(300, 0);
    await denied(updateDoc(doc(firestoreFor(t.white), `matches/${t.code}`), { timeControlSec: 3600, lastActivity: serverTimestamp() }));
    // A host cannot open a match on a 1 s clock (or a 10 min increment) either.
    actAs('hana');
    await denied(createMatch({ uid: 'hana', displayName: 'Hana' }, 'classic', 1, null));
    await denied(createMatch({ uid: 'hana', displayName: 'Hana' }, 'classic', 180, 600));
  });

  it('C2 DENIED (R-7): the flagged attacker stalls by pinging lastActivity — the honest flag claim lands anyway', async () => {
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
    const fiveMinAgo = Timestamp.fromMillis(Date.now() - 300_000);
    await updateDoc(doc(firestoreFor('owner'), `matches/${code}`), { lastActivity: fiveMinAgo, turnStartedAt: fiveMinAgo });
    // attacker pings
    await updateDoc(doc(firestoreFor(black), `matches/${code}`), { lastActivity: serverTimestamp() });
    // honest White claims the flag through the app
    const hw2 = await hookAs(white, code);
    const loser = black === H.uid ? 'host-resign' : 'guest-resign';
    assert.equal(await hw2.writeOutcomeIfFirst(loser, 'flag'), true);
    assert.equal((await read(`matches/${code}`)).outcome, loser);
  });
});

describe('C: honest players whose device clocks are wrong (R-1 window, 60 s)', () => {
  // [White's skew, Black's skew]: one clock behind and one ahead is the
  // worst case — up to 80 s between two stamps written a second apart.
  const pairs = [
    [+40_000, -40_000], [-40_000, +40_000], [+20_000, -20_000],
    [-20_000, +20_000], [-40_000, -40_000], [+40_000, 0],
  ];
  for (const [ws, bs] of pairs) {
    it(`C4 allowed: White ${ws / 1000} s, Black ${bs / 1000} s — every move lands, stamps never go back`, async () => {
      const { code, white, black } = await start(300);
      for (let ply = 0; ply < 8; ply++) {
        await withClock(ply % 2 === 0 ? ws : bs, () => honestMove(ply % 2 === 0 ? white : black, code));
      }
      const m = await read(`matches/${code}`);
      assert.equal(m.log.moves.length, 8, 'a move was refused');
      const stamps = m.log.moves.map((e) => e.timestamp);
      for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i] >= stamps[i - 1], `stamp ${i} went back`);
      // On either device, neither clock lost more than the gap between the
      // two devices (charged at most once, then max(now, previous) keeps
      // the stamps in step).
      const gap = Math.abs(ws - bs);
      for (const view of [ws, bs]) {
        const clocks = await withClock(view, () => mpClocks(m));
        assert.ok(clocks.white >= 300_000 - gap - 5_000 && clocks.black >= 300_000 - gap - 5_000,
          `view ${view / 1000} s: ${JSON.stringify(clocks)}`);
      }
    });
  }

  it('denied (known limit): with a clock, a device more than 60 s off cannot move at all', async () => {
    const { code, white } = await start(300);
    await withClock(-70_000, () => honestMove(white, code));
    assert.equal((await read(`matches/${code}`)).log.moves.length, 0);
    await withClock(+70_000, () => honestMove(white, code));
    assert.equal((await read(`matches/${code}`)).log.moves.length, 0);
  });

  it('denied: a stamp before the previous one, outside the window, or not a whole number', async () => {
    const { code, white, black } = await start(300);
    await honestMove(white, code);
    const m = await read(`matches/${code}`);
    const prev = m.log.moves[0].timestamp;
    const append = (timestamp) => updateDoc(doc(firestoreFor(black), `matches/${code}`), {
      'log.moves': [...m.log.moves, { ...m.log.moves[0], timestamp }], currentTurn: white, lastActivity: serverTimestamp(), turnStartedAt: serverTimestamp(),
    });
    await denied(append(prev - 1));
    await denied(append(Date.now() + 61_000));
    await denied(append(String(Date.now())));
    await denied(append(Date.now() + 0.5));
    await denied(append(null));
  });

  it('ALLOWED (known limit, R-1 residual): back-dating to the previous stamp charges my thinking time (up to 60 s) to the opponent', async () => {
    const { code, white, black } = await start(300);
    await honestMove(white, code);
    // White moved 50 s ago; Black has been thinking since.
    const m = await read(`matches/${code}`);
    const moves = [{ ...m.log.moves[0], timestamp: Date.now() - 50_000 }];
    await updateDoc(doc(firestoreFor('owner'), `matches/${code}`), { 'log.moves': moves });
    await updateDoc(doc(firestoreFor(black), `matches/${code}`), {
      'log.moves': [...moves, { ...moves[0], timestamp: moves[0].timestamp }], currentTurn: white, lastActivity: serverTimestamp(), turnStartedAt: serverTimestamp(),
    });
    const clocks = mpClocks(await read(`matches/${code}`));
    assert.ok(clocks.black > 299_000, `Black was charged nothing: ${JSON.stringify(clocks)}`);
  });
});

describe('C: no clock, no lower bound (R-1: only the upper end of the window holds everywhere)', () => {
  it('allowed: devices 70 s behind play an untimed classic match', async () => {
    const { code, white, black } = await start(null);
    for (let ply = 0; ply < 4; ply++) {
      await withClock(-70_000, () => honestMove(ply % 2 === 0 ? white : black, code));
    }
    const stamps = (await read(`matches/${code}`)).log.moves.map((e) => e.timestamp);
    assert.equal(stamps.length, 4, 'a move was refused');
    for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i] >= stamps[i - 1], `stamp ${i} went back`);
  });

  it('allowed: a device 70 s behind plays roulette, with no time control and with one (the client runs no clock in roulette)', async () => {
    for (const tc of [null, 300]) {
      const { code, white } = await start(tc, null, 'roulette');
      await withClock(-70_000, async () => { await (await hookAs(white, code)).spinRoulette(); });
      await withClock(-70_000, async () => { await (await hookAs(white, code)).sendRotate(); });
      await withClock(-70_000, async () => { await (await hookAs(white, code)).sendRotate(); });
      assert.equal((await read(`matches/${code}`)).log.moves.length, 2, `tc ${tc}: an action was refused`);
    }
  });

  it('denied (known limit): a device more than 60 s ahead cannot move, with a clock or without, in classic or roulette', async () => {
    for (const [tc, mode] of [[null, 'classic'], [null, 'roulette'], [300, 'roulette']]) {
      const { code, white } = await start(tc, null, mode);
      if (mode === 'roulette') {
        await withClock(+70_000, async () => { await (await hookAs(white, code)).spinRoulette(); });
        await withClock(+70_000, async () => { await (await hookAs(white, code)).sendRotate(); });
      } else {
        await withClock(+70_000, () => honestMove(white, code));
      }
      assert.equal((await read(`matches/${code}`)).log.moves.length, 0, `tc ${tc}, ${mode}: a move landed`);
    }
  });

  it('denied: without a clock a stamp is still a whole number no earlier than the previous one and at most 60 s ahead', async () => {
    const { code, white, black } = await start(null);
    await honestMove(white, code);
    const m = await read(`matches/${code}`);
    const prev = m.log.moves[0].timestamp;
    const append = (timestamp) => updateDoc(doc(firestoreFor(black), `matches/${code}`), {
      'log.moves': [...m.log.moves, { ...m.log.moves[0], timestamp }], currentTurn: white, lastActivity: serverTimestamp(), turnStartedAt: serverTimestamp(),
    });
    await denied(append(prev - 1));
    await denied(append(String(Date.now())));
    await denied(append(null));
    await denied(append(Date.now() + 61_000));
    await denied(append(Date.now() + 10 * 60_000));
    await append(Date.now() + 50_000);
  });

  // A stamp past 2^53 reads back in the JS client as a double; the honest
  // next stamp, max(now, that), is then written as a double and refused
  // (not an int), so the match could not be played on.
  const huge = ['9007199254740992', '9007199254740993', '9223372036854775807'];

  it('denied: a stamp of 2^53 or more, written through REST, in an untimed classic match', async () => {
    const { code, white, black } = await start(null);
    await honestMove(white, code);
    for (const stamp of huge) {
      const res = await restAppend(black, code, stamp, white);
      assert.equal(res.status, 403, `${stamp}: ${JSON.stringify(res.json)}`);
    }
    // the same REST write with an honest stamp lands, and White plays on
    assert.equal((await restAppend(black, code, String(Date.now()), white)).status, 200);
    await honestMove(white, code);
    assert.equal((await read(`matches/${code}`)).log.moves.length, 3);
  });

  it('denied: a stamp of 2^53 or more, written through REST, in roulette (no time control and 300 s)', async () => {
    for (const tc of [null, 300]) {
      const { code, white, black } = await start(tc, null, 'roulette');
      await (await hookAs(white, code)).spinRoulette();
      await (await hookAs(white, code)).sendRotate();
      // White's last action: the bag empties and the turn passes
      const last = {
        rouletteSlots: { nullValue: null },
        rouletteActionsLeft: { integerValue: '0' },
        usedRouletteSlots: { arrayValue: {} },
      };
      for (const stamp of huge) {
        const res = await restAppend(white, code, stamp, black, last);
        assert.equal(res.status, 403, `tc ${tc}, ${stamp}: ${JSON.stringify(res.json)}`);
      }
      assert.equal((await restAppend(white, code, String(Date.now()), black, last)).status, 200, `tc ${tc}`);
      await (await hookAs(black, code)).spinRoulette();
      await (await hookAs(black, code)).sendRotate();
      assert.equal((await read(`matches/${code}`)).log.moves.length, 3, `tc ${tc}`);
    }
  });
});
