// How far the honest writes to /matches and /users are from Firestore's
// limit of 1000 expressions per request (R-20 of the independent review,
// round 2). Not in test:rules (a few minutes: every probe reloads the
// rules). Run on its own:
//   firebase emulators:exec --only firestore --project demo-subutai
//     "node --import ./tests/rules/register.mjs --test --test-isolation=none tests/rules/expr-budget.test.mjs"
// (EXPR_ONLY=users or EXPR_ONLY=matches: only those writes.)
//
// Method: K no-op conditions (`request.time != null`) go in front of the
// update rule, behind a switch: they are evaluated only once /padflag/on
// exists. So every write is set up by the app's own code under the plain
// rules, the switch goes on, and only the measured write pays for them.
// The largest K under which it still lands is its margin. A rule with
// nothing else behind the switch (calibration) fits K_cal of them, so one
// costs about 1000 / K_cal expressions, and the write itself about
// 1000 - K * 1000 / K_cal (the switch, a few expressions, included).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, it } from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { PROJECT_ID, actAs, firestoreFor, terminateAll } from './client-stub.mjs';

const { claimDisplayName, changeDisplayName } = await import('../../src/firebase/auth.ts');
const { saveCompletedGame } = await import('../../src/firebase/games.ts');
const { createMatch, joinMatch } = await import('../../src/firebase/matches.ts');
const { useMultiplayerSync, writeInactivityForfeit } = await import('../../src/components/MultiplayerGameView.tsx');
const { generateLegalMoves } = await import('../../src/engine/moves.ts');

const BASE = readFileSync(process.env.RULES_FILE ?? new URL('../../firestore.rules', import.meta.url), 'utf8')
  .split('\r\n').join('\n');
const ANCHORS = {
  users: '      allow update: if isOwner(uid)\n                    && request.resource.data.uid == uid\n',
  matches: '      allow update: if signedIn()\n        && matchKeysOk(request.resource.data)\n',
  calib: '  }\n}\n',
};
for (const a of Object.values(ANCHORS)) assert.equal(BASE.split(a).length, 2, `anchor not unique: ${a}`);

function rulesWith(target, k) {
  const fns = [];
  for (let i = 0; i * 25 < k; i++) {
    const n = Math.min(25, k - i * 25);
    fns.push(`    function pad${i}() { return ${Array(n).fill('request.time != null').join(' && ')}; }\n`);
  }
  const pads = fns.length ? fns.map((_, i) => `pad${i}()`).join(' && ') : 'true';
  const sw = `(!exists(/databases/$(database)/documents/padflag/on) || (${pads}))`;
  const head = '  match /databases/{database}/documents {\n';
  let r = BASE.replace(head, head + fns.join(''));
  if (target === 'calib') {
    return r.replace(ANCHORS.calib, `    match /calib/{id} {\n      allow create: if ${sw};\n    }\n` + ANCHORS.calib);
  }
  return r.replace(ANCHORS[target], ANCHORS[target].replace('allow update: if ', `allow update: if ${sw}\n        && `));
}

let env;
after(async () => { await terminateAll(); await env?.cleanup(); });
const read = async (p) => (await getDoc(doc(firestoreFor('owner'), p))).data();
const patch = (p, data) => updateDoc(doc(firestoreFor('owner'), p), data);
const ago = (ms) => Timestamp.fromMillis(Date.now() - ms);

const H = { uid: 'hana', displayName: 'Hana' };
const G = { uid: 'gus', displayName: 'Gus' };
async function hookAs(uid, code) {
  actAs(uid);
  const live = await read(`matches/${code}`);
  let h = null;
  function Probe() { h = useMultiplayerSync(live, uid, () => {}); return null; }
  renderToString(React.createElement(Probe));
  return h;
}
async function start(mode = 'classic', tc = null) {
  actAs(H.uid);
  const code = await createMatch(H, mode, tc, tc ? 2 : null);
  actAs(G.uid);
  const m = await joinMatch(code, G);
  const white = m.host.color === 'white' ? H.uid : G.uid;
  const black = white === H.uid ? G.uid : H.uid;
  return { code, white, black, loser: (uid) => (uid === H.uid ? 'host-resign' : 'guest-resign') };
}
async function move(uid, code) {
  const h = await hookAs(uid, code);
  await h.sendMove(generateLegalMoves(h.boardState).find((m) => m.kind !== 'topologyToggle'));
}
/** A spin whose bag can move from the start position (the bag is the spinner's word anyway). */
async function spin(uid, code) {
  await (await hookAs(uid, code)).spinRoulette();
  await patch(`matches/${code}`, { rouletteSlots: ['pawn', 'knight', 'pawn', 'knight'] });
}
const m = (code) => read(`matches/${code}`);

const pts = (o = {}) => ({ movePoints: 60, capturePoints: 0, qualityPoints: 0, rotationPoints: 0, outcomeBonus: 0, total: 60,
  moveCount: 12, captureValueCp: 0, moveQualityCounts: { brilliant: 0, best: 0, good: 0, mistake: 0, blunder: 0 }, counted: true, ...o });
const log = { id: 'log', createdAt: new Date().toISOString(), randomSeed: 1, initialTopology: 'A', initialState: null,
  moves: Array.from({ length: 24 }, (_, i) => ({ san: 'R', move: { kind: 'topologyToggle' }, topology: 'A', timestamp: 1000 + i })) };
const win = (gameMode, points) => saveCompletedGame({ uid: 'pia', displayName: 'Pia', log, outcome: 'human-win', points,
  chess960Id: 'RNBQKBNR', seed: 1, humanColor: 'white', gameMode, durationMs: 61234, botLevel: 'strong' });
const u = () => read('users/pia');
async function newPlayer() { actAs('pia'); await claimDisplayName('pia', 'Pia'); }

// [name, target, setup() -> ctx, act(ctx), landed(ctx) -> bool]
const CASES = [
  ['calibration: the switch and the pads alone', 'calib', async () => {}, async () => {
    actAs('cal'); await setDoc(doc(firestoreFor('cal'), 'calib/x'), { a: 1 });
  }, async () => !!(await read('calib/x'))],

  ['/users: Strong win, classic, new best (saveCompletedGame)', 'users', newPlayer,
    async () => win('classic', pts({ total: 60 })), async () => (await u())?.strongWins === 1 && (await u()).bestGamePoints === 60],
  ['/users: second Strong win in a row, new best (lastGameAt set)', 'users', async () => { await newPlayer(); await win('classic', pts({ total: 60 })); },
    async () => win('classic', pts({ total: 61, capturePoints: 1 })), async () => (await u())?.strongWins === 2],
  ['/users: Strong win, roulette, new best', 'users', newPlayer,
    async () => win('roulette', pts({ outcomeBonus: 500, total: 560 })), async () => (await u())?.rouletteBestPoints === 560],
  ['/users: rename to a Greek name with a final sigma (changeDisplayName)', 'users', newPlayer,
    async () => { actAs('pia'); await changeDisplayName('pia', 'Pia', 'Νίκος Σοφίας'); }, async () => (await u())?.displayName === 'Νίκος Σοφίας'],

  ['/matches: join (joinMatch)', 'matches', async () => { actAs(H.uid); return { code: await createMatch(H, 'classic', 180, 2) }; },
    async (c) => { actAs(G.uid); await joinMatch(c.code, G); }, async (c) => (await m(c.code)).status === 'active'],
  ['/matches: classic move, 3+2 clock', 'matches', () => start('classic', 180),
    (c) => move(c.white, c.code), async (c) => (await m(c.code)).log.moves.length === 1],
  ['/matches: classic move, no clock, 40th move', 'matches', async () => {
    const c = await start(); for (let i = 0; i < 39; i++) await move(i % 2 ? c.black : c.white, c.code); return c;
  }, (c) => move(c.black, c.code), async (c) => (await m(c.code)).log.moves.length === 40],
  ['/matches: roulette spin', 'matches', () => start('roulette'),
    async (c) => (await hookAs(c.white, c.code)).spinRoulette(), async (c) => (await m(c.code)).rouletteActionsLeft === 2],
  ['/matches: roulette first action, a piece from the bag', 'matches', async () => { const c = await start('roulette'); await spin(c.white, c.code); return c; },
    (c) => move(c.white, c.code), async (c) => (await m(c.code)).usedRouletteSlots?.length === 1],
  ['/matches: roulette last action, passes the turn', 'matches', async () => {
    const c = await start('roulette'); await spin(c.white, c.code); await (await hookAs(c.white, c.code)).sendRotate(); return c;
  }, async (c) => (await hookAs(c.white, c.code)).sendRotate(), async (c) => (await m(c.code)).currentTurn === c.black],
  ['/matches: resign', 'matches', async () => { const c = await start(); await move(c.white, c.code); return c; },
    async (c) => (await hookAs(c.black, c.code)).resign(), async (c) => !!(await m(c.code)).outcome],
  ['/matches: flag claim by the opponent, 90 s after the turn started', 'matches', async () => {
    const c = await start('classic', 60); await move(c.white, c.code);
    await patch(`matches/${c.code}`, { lastActivity: ago(100_000), turnStartedAt: ago(100_000) }); return c;
  }, async (c) => (await hookAs(c.white, c.code)).writeOutcomeIfFirst(c.loser(c.black), 'flag'), async (c) => !!(await m(c.code)).outcome],
  ['/matches: inactivity forfeit (writeInactivityForfeit)', 'matches', async () => {
    const c = await start(); await move(c.white, c.code);
    await patch(`matches/${c.code}`, { lastActivity: ago(100_000), turnStartedAt: ago(100_000) }); return c;
  }, async (c) => { actAs(c.white); await writeInactivityForfeit(c.code, c.white); }, async (c) => !!(await m(c.code)).outcome],
  ['/matches: mate written by writeOutcomeIfFirst', 'matches', async () => { const c = await start(); await move(c.white, c.code); return c; },
    async (c) => (await hookAs(c.white, c.code)).writeOutcomeIfFirst('white-win'), async (c) => !!(await m(c.code)).outcome],
];

/** One probe: rules with K pads on target, fresh data, set up, switch on, the write. */
async function probe([, target, setup, act, landed], k) {
  await env?.cleanup();
  await terminateAll();
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: rulesWith(target, k) } });
  await env.clearFirestore();
  const ctx = await setup();
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'padflag/on'), { on: true }));
  const errors = [];
  const realError = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  try { await act(ctx); } catch (e) { errors.push(String(e?.message ?? e)); } finally { console.error = realError; }
  return { ok: await landed(ctx), limit: errors.some((e) => /1000 expressions|expressions/i.test(e)), errors };
}

// EXPR_ONLY=users (or matches) measures only those writes, after the calibration.
const ONLY = process.env.EXPR_ONLY;

it('expression margin of the honest writes', { timeout: 30 * 60_000 }, async () => {
  const rows = [];
  let perPad = null;
  for (const c of CASES.filter((c) => !ONLY || c[1] === 'calib' || c[1] === ONLY)) {
    const zero = await probe(c, 0);
    assert.ok(zero.ok, `${c[0]} does not land with no pads: ${zero.errors.join(' | ')}`);
    let lo = 0, hi = 1000; // lo lands, hi does not
    let atHi = await probe(c, hi);
    assert.ok(!atHi.ok, `${c[0]} lands with ${hi} pads`);
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      const r = await probe(c, mid);
      if (r.ok) lo = mid; else { hi = mid; atHi = r; }
    }
    if (c[1] === 'calib') perPad = 1000 / lo;
    const used = Math.round(1000 - lo * perPad);
    rows.push({ write: c[0], k: lo, used, margin: 1000 - used, refusedBy: atHi.limit ? 'expression limit' : atHi.errors[0]?.slice(0, 120) });
    console.log(JSON.stringify(rows.at(-1)));
  }
  console.log(`\none pad ~ ${perPad.toFixed(2)} expressions\n`);
  console.log('| write | K | ~expressions | margin | refused at K+1 by |');
  for (const r of rows) console.log(`| ${r.write} | ${r.k} | ${r.used} | ${r.margin} | ${r.refusedBy} |`);
});
