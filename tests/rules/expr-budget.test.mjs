// How far the honest writes to /matches and /users are from Firestore's
// limit of 1000 expressions per request (R-20 of the independent review,
// round 2). Not in test:rules (a few minutes: every probe reloads the
// rules). Run on its own:
//   firebase emulators:exec --only firestore --project demo-subutai
//     "node --import ./tests/rules/register.mjs --test --test-isolation=none tests/rules/expr-budget.test.mjs"
// (EXPR_ONLY=users, matches or create, or a list like matches,create:
// only those writes; EXPR_NAMES=<regex>: only the writes so named.)
// EXPR_HOST=white or black fixes the host's colour; with it a write's K is
// the same on every run (without it, K moves with who moves, host or
// guest). EXPR_COVERAGE=1 measures nothing: it prints, per write, how many
// times each expression and function of the rules was evaluated, from the
// emulator's rule coverage report (EXPR_COVERAGE_OUT=<prefix>: also as JSON).
//
// Method: K no-op conditions (`request.time != null`) go in front of the
// update rule, behind a switch: they are evaluated only once /padflag/on
// exists. So every write is set up by the app's own code under the plain
// rules, the switch goes on, and only the measured write pays for them.
// The largest K under which it still lands is its margin. A rule with
// nothing else behind the switch (calibration) fits K_cal of them, so one
// costs about 1000 / K_cal expressions, and the write itself about
// 1000 - K * 1000 / K_cal (the switch, a few expressions, included).
// A /matches write's K moves between runs by up to 6 on the same rules (the
// host's colour and the position are random, and the rules branch on
// them): take the lowest K of a few runs.
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
const { logReaching, stampLog } = await import('./positions.mjs');

const BASE = readFileSync(process.env.RULES_FILE ?? new URL('../../firestore.rules', import.meta.url), 'utf8')
  .split('\r\n').join('\n');
const ANCHORS = {
  users: '      allow update: if isOwner(uid)\n                    && request.resource.data.uid == uid\n',
  matches: '      allow update: if signedIn()\n        && match',
  create: '      allow create: if signedIn()\n                    && request.resource.data.code == code\n',
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
  const verb = target === 'create' ? 'allow create: if ' : 'allow update: if ';
  return r.replace(ANCHORS[target], ANCHORS[target].replace(verb, `${verb}${sw}\n        && `));
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
/** EXPR_HOST=white or black: the host's colour, which the app draws with
 *  Math.random (buildMatchDocPayload). Who moves, host or guest, takes the
 *  rules down other branches (seated, opponentOf, the last clause of the
 *  update rule), so a measurement is only repeatable with it fixed. */
async function createAs(host, ...args) {
  const colour = process.env.EXPR_HOST;
  if (!colour) return createMatch(host, ...args);
  const random = Math.random;
  Math.random = () => (colour === 'white' ? 0.25 : 0.75);
  try { return await createMatch(host, ...args); } finally { Math.random = random; }
}
async function start(mode = 'classic', tc = null) {
  actAs(H.uid);
  const code = await createAs(H, mode, tc, tc ? 2 : null);
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
/** A started match moved to a log that reaches reach.move, the side to move
 *  on turn; in roulette with a bag of `bag` and `left` actions. */
async function at(reach, mode = 'classic', bag = null, left = 2) {
  const c = await start(mode);
  const mover = reach.sideToMove === 'white' ? c.white : c.black;
  await patch(`matches/${c.code}`, {
    chess960Id: reach.key, 'log.moves': stampLog(reach.entries), currentTurn: mover,
    ...(bag ? { rouletteSlots: bag, rouletteActionsLeft: left, usedRouletteSlots: [] } : {}),
  });
  return { ...c, mover, reach };
}
const plays = async (c) => (await hookAs(c.mover, c.code)).sendMove(c.reach.move);
const grew = (c) => async () => (await m(c.code)).log.moves.length === c.reach.entries.length + 1;
const PROMO = () => logReaching('promotion', { promotion: 'queen' });
const CASTLE = () => logReaching('castle');
const EP = () => logReaching('enPassant');
const IN_B = () => logReaching('normal', { rotateFirst: true });
/** The bag that lets the move from the reach be played: its piece type, four times. */
const BAG = { promotion: 'pawn', enPassant: 'pawn', castle: 'king' };
const bagFor = (reach, state) => Array(4).fill(BAG[reach.move.kind] ?? state.pieces[reach.move.from].type);
const { boardAfter } = await import('./positions.mjs');
const firstAction = (reach) => at(reach, 'roulette', bagFor(reach, boardAfter(reach.key, reach.entries)), 2);
const opponent = (c) => (c.mover === c.white ? c.black : c.white);
/** offerDraw, checked: the app's own write must land in setup. */
async function offerOf(uid, code) {
  await (await hookAs(uid, code)).offerDraw();
  assert.equal((await m(code)).drawOffer?.by, uid, 'the draw offer did not land in setup');
}

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

  ['/matches: join (joinMatch)', 'matches', async () => { actAs(H.uid); return { code: await createAs(H, 'classic', 180, 2) }; },
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

  // The draw offer (drawOfferHolds, drawOfferOk). After White's first move Black is on turn.
  ['/matches: draw offer on turn (offerDraw)', 'matches', async () => { const c = await start(); await move(c.white, c.code); return c; },
    async (c) => (await hookAs(c.black, c.code)).offerDraw(), async (c) => (await m(c.code)).drawOffer?.by === c.black],
  ['/matches: draw offer off turn', 'matches', async () => { const c = await start(); await move(c.white, c.code); return c; },
    async (c) => (await hookAs(c.white, c.code)).offerDraw(), async (c) => (await m(c.code)).drawOffer?.by === c.white],
  ['/matches: decline of an offer made on turn, restarts the turn (answerDraw)', 'matches', async () => {
    const c = await start(); await move(c.white, c.code); await offerOf(c.black, c.code); return c;
  }, async (c) => (await hookAs(c.white, c.code)).answerDraw(false), async (c) => (await m(c.code)).drawOffer?.declined === true],
  ['/matches: accept of an offer made on turn', 'matches', async () => {
    const c = await start(); await move(c.white, c.code); await offerOf(c.black, c.code); return c;
  }, async (c) => (await hookAs(c.white, c.code)).answerDraw(true), async (c) => (await m(c.code)).outcome === 'draw'],
  ['/matches: classic move that retires the opponent\'s offer', 'matches', async () => {
    const c = await start(); await move(c.white, c.code); await offerOf(c.white, c.code); return c;
  }, (c) => move(c.black, c.code), async (c) => (await m(c.code)).log.moves.length === 2],
  ['/matches: roulette last action with the mover\'s offer standing', 'matches', async () => {
    const c = await start('roulette'); await spin(c.white, c.code); await (await hookAs(c.white, c.code)).sendRotate();
    await offerOf(c.white, c.code); return c;
  }, async (c) => (await hookAs(c.white, c.code)).sendRotate(), async (c) => (await m(c.code)).currentTurn === c.black],
  ['/matches: inactivity forfeit with a declined offer on the table', 'matches', async () => {
    const c = await start(); await move(c.white, c.code); await offerOf(c.black, c.code);
    await (await hookAs(c.white, c.code)).answerDraw(false);
    await patch(`matches/${c.code}`, { lastActivity: ago(100_000), turnStartedAt: ago(100_000) }); return c;
  }, async (c) => { actAs(c.white); await writeInactivityForfeit(c.code, c.white); }, async (c) => !!(await m(c.code)).outcome],
  ['/matches: inactivity forfeit with a retired offer (offered on turn, then moved)', 'matches', async () => {
    const c = await start(); await move(c.white, c.code); await offerOf(c.black, c.code); await move(c.black, c.code);
    await patch(`matches/${c.code}`, { lastActivity: ago(100_000), turnStartedAt: ago(100_000) }); return c;
  }, async (c) => { actAs(c.black); await writeInactivityForfeit(c.code, c.black); }, async (c) => !!(await m(c.code)).outcome],
  // The entries moveEntryOk reads most of: a castle (two square pairs) and a promotion.
  ['/matches: create (createMatch)', 'create', async () => ({}),
    async (c) => { actAs(H.uid); c.code = await createMatch(H, 'classic', 180, 2); }, async (c) => !!c.code && !!(await m(c.code))],
  ['/matches: classic castle', 'matches', () => at(CASTLE()), plays, (c) => grew(c)()],
  ['/matches: classic promotion', 'matches', () => at(PROMO()), plays, (c) => grew(c)()],
  ['/matches: roulette first action, a promotion from the bag', 'matches', () => at(PROMO(), 'roulette', ['pawn', 'pawn', 'pawn', 'pawn']),
    plays, (c) => grew(c)()],
  ['/matches: roulette first action, a castle', 'matches', () => firstAction(CASTLE()), plays, (c) => grew(c)()],
  ['/matches: roulette first action, an en passant', 'matches', () => firstAction(EP()), plays, (c) => grew(c)()],
  ['/matches: roulette first action, a move in topology B', 'matches', () => firstAction(IN_B()), plays, (c) => grew(c)()],
  ['/matches: roulette first action, a promotion, with the mover\'s offer standing', 'matches', async () => {
    const c = await firstAction(PROMO()); await offerOf(c.mover, c.code); return c;
  }, plays, (c) => grew(c)()],
  ['/matches: roulette first action, a promotion, that retires the opponent\'s offer', 'matches', async () => {
    const c = await firstAction(PROMO()); await offerOf(opponent(c), c.code); return c;
  }, plays, async (c) => (await grew(c)()) && (await m(c.code)).drawOffer === undefined],
  ['/matches: roulette last action, a castle, with the mover\'s offer standing', 'matches', async () => {
    const c = await at(CASTLE(), 'roulette', ['king', 'king', 'king', 'king'], 1); await offerOf(c.mover, c.code); return c;
  }, plays, async (c) => (await m(c.code)).currentTurn !== c.mover],
  ['/matches: roulette last action, a promotion, with the mover\'s offer standing', 'matches', async () => {
    const c = await at(PROMO(), 'roulette', ['pawn', 'pawn', 'pawn', 'pawn'], 1); await offerOf(c.mover, c.code); return c;
  }, plays, async (c) => (await m(c.code)).currentTurn !== c.mover],
  ['/matches: flag claim with a declined offer on the table, 1+2', 'matches', async () => {
    const c = await start('classic', 60); await move(c.white, c.code); await offerOf(c.black, c.code);
    await (await hookAs(c.white, c.code)).answerDraw(false);
    await patch(`matches/${c.code}`, { lastActivity: ago(100_000), turnStartedAt: ago(100_000) }); return c;
  }, async (c) => (await hookAs(c.white, c.code)).writeOutcomeIfFirst(c.loser(c.black), 'flag'), async (c) => !!(await m(c.code)).outcome],
];

// EXPR_COVERAGE=1: no search; each write once with no pads, and the
// emulator's rule coverage (:ruleCoverage) read before and after it: how
// many times each expression and each function was evaluated for that
// write alone.
const COV_URL = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}:ruleCoverage`;
async function coverage() {
  // The report catches up with the writes a little later: read it until
  // two reads 400 ms apart agree.
  let j = null;
  for (let prev = ''; ; await new Promise((r) => setTimeout(r, 400))) {
    const text = await (await fetch(COV_URL)).text();
    if (text === prev) { j = JSON.parse(text); break; }
    prev = text;
  }
  const counts = new Map();
  const walk = (n) => {
    const p = n.sourcePosition;
    // A value of {} is a node the evaluation reached but skipped (the right
    // side of an || that was already true): not evaluated. The emulator
    // evaluates each write twice, so every count is halved.
    const c = (n.values ?? []).reduce((s, v) => s + (v.value && Object.keys(v.value).length ? Number(v.count ?? 0) : 0), 0) / 2;
    if (p) counts.set(`${p.currentOffset}-${p.endOffset}`, { line: p.line, from: p.currentOffset, to: p.endOffset, count: c });
    for (const ch of n.children ?? []) walk(ch);
  };
  for (const n of j.report ?? []) walk(n);
  return { counts, text: j.rules.files[0].content };
}
function coverageDiff(a, b) {
  const lines = b.text.split('\n');
  const fnAt = (line) => {
    for (let i = line - 1; i >= 0; i--) {
      const m = /^\s*function (\w+)\(/.exec(lines[i]);
      if (m) return m[1];
      if (/^\s*(allow|match) /.test(lines[i])) return lines[i].trim().split(':')[0];
    }
    return '?';
  };
  const rows = [];
  for (const [key, e] of b.counts) {
    const d = e.count - (a.counts.get(key)?.count ?? 0);
    if (d > 0) rows.push({ ...e, d, fn: fnAt(e.line), src: b.text.slice(e.from, e.to).replace(/\s+/g, ' ').slice(0, 90) });
  }
  const byFn = new Map();
  for (const r of rows) byFn.set(r.fn, (byFn.get(r.fn) ?? 0) + r.d);
  return { rows: rows.sort((x, y) => y.d - x.d), byFn: [...byFn].sort((x, y) => y[1] - x[1]), total: rows.reduce((s, r) => s + r.d, 0) };
}

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
  const before = process.env.EXPR_COVERAGE ? await coverage() : null;
  try { await act(ctx); } catch (e) { errors.push(String(e?.message ?? e)); } finally { console.error = realError; }
  const cov = before ? coverageDiff(before, await coverage()) : null;
  return { ok: await landed(ctx), limit: errors.some((e) => /1000 expressions|expressions/i.test(e)), errors, cov };
}

// EXPR_ONLY=users (or matches) measures only those writes, after the calibration.
const ONLY = process.env.EXPR_ONLY;

it('expression margin of the honest writes', { timeout: 30 * 60_000 }, async () => {
  const rows = [];
  let perPad = null;
  const NAMES = process.env.EXPR_NAMES ? new RegExp(process.env.EXPR_NAMES) : null;
  for (const c of CASES.filter((c) => (!ONLY || c[1] === 'calib' || ONLY.split(',').includes(c[1]))
    && (!NAMES || c[1] === 'calib' || NAMES.test(c[0])))) {
    if (process.env.EXPR_COVERAGE) {
      if (c[1] === 'calib') continue;
      const r = await probe(c, 0);
      assert.ok(r.ok, `${c[0]} does not land: ${r.errors.join(' | ')}`);
      console.log(`\n## ${c[0]} (host ${process.env.EXPR_HOST ?? 'random'}): ${r.cov.total} evaluations counted`);
      console.log('by function:', r.cov.byFn.slice(0, 15).map(([f, n]) => `${f} ${n}`).join(', '));
      for (const x of r.cov.rows.slice(0, 15)) console.log(`  ${x.d}x L${x.line} [${x.fn}] ${x.src}`);
      if (process.env.EXPR_COVERAGE_OUT) {
        (await import('node:fs')).writeFileSync(`${process.env.EXPR_COVERAGE_OUT}-${CASES.indexOf(c)}.json`, JSON.stringify(r.cov.rows));
      }
      continue;
    }
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
  if (process.env.EXPR_COVERAGE) return;
  console.log(`\none pad ~ ${perPad.toFixed(2)} expressions\n`);
  console.log('| write | K | ~expressions | margin | refused at K+1 by |');
  for (const r of rows) console.log(`| ${r.write} | ${r.k} | ${r.used} | ${r.margin} | ${r.refusedBy} |`);
});
