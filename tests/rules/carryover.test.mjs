// Independent review, round 2: what a /games doc written under the rules
// live today (main = the bridge, for /games) is worth once firestore.rules
// @ 18ed6ad is published. Phase 1 writes as a player under BRIDGE_RULES,
// phase 2 reloads FINAL_RULES on the same emulator data and uses it.
// Runs from tests/rules/ of a fix/rules copy, like round2.test.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

const BRIDGE = process.env.BRIDGE_RULES ?? new URL('../../firestore.bridge.rules', import.meta.url);
const FINAL = process.env.FINAL_RULES ?? new URL('../../firestore.rules', import.meta.url);
const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-subutai';
const load = (f) => initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync(f, 'utf8') } });
let env;
after(async () => { await env?.cleanup(); });

const over = { movePoints: 1500, capturePoints: 400, qualityPoints: 3010, rotationPoints: 600, outcomeBonus: 500,
  total: 6010, moveCount: 300, counted: true };
const game = (createdAt) => ({
  playerId: 'mallory', playerName: 'Mallory', chess960Id: 'RNBQKBNR', humanColor: 'white', outcome: 'human-win',
  moveCount: 300, log: { initialTopology: 'A', moves: Array.from({ length: 599 }, () => ({})) }, points: over,
  gameMode: 'roulette', botLevel: 'strong', createdAt,
});
const snap = { chess960Id: 'RNBQKBNR', moveCount: 300, outcome: 'human-win', createdAt: serverTimestamp() };

describe('carry-over: /games planted before the final rules', () => {
  it('B1 phase 1 (bridge / today\'s prod rules): plant a game dated 2100 and one over the roulette cap', async () => {
    env = await load(BRIDGE);
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await setDoc(doc(db, 'users/mallory'), { uid: 'mallory', displayName: 'Mallory', displayNameLower: 'mallory' });
      await setDoc(doc(db, 'displayNames/mallory'), { uid: 'mallory' });
    });
    const db = env.authenticatedContext('mallory').firestore();
    await setDoc(doc(db, 'games/FUTURE'), game(Timestamp.fromDate(new Date('2100-01-01T00:00:00Z'))));
    await setDoc(doc(db, 'games/NOW'), game(serverTimestamp()));
  });

  it('B2 phase 2 (final rules): the 2100 game backs strongWins +1 on every write, and roulette best 6010', async () => {
    await env.cleanup();
    env = await load(FINAL);
    const db = env.authenticatedContext('mallory').firestore();
    const outcome = {};
    for (let i = 1; i <= 5; i++) {
      try {
        await updateDoc(doc(db, 'users/mallory'), { strongWins: i, lastGameId: 'FUTURE', lastGameAt: serverTimestamp() });
        outcome.strongWins = i;
      } catch (e) { outcome.strongWinsError = e.code; break; }
    }
    for (const id of ['NOW', 'FUTURE']) {
      try {
        await updateDoc(doc(db, 'users/mallory'), { rouletteBestPoints: 6010, rouletteBestGameId: id, rouletteBestSnapshot: snap });
        outcome[`best_${id}`] = 'allowed';
      } catch (e) { outcome[`best_${id}`] = e.code; }
    }
    let u;
    await env.withSecurityRulesDisabled(async (c) => { u = (await getDoc(doc(c.firestore(), 'users/mallory'))).data(); });
    console.log('carry-over under', String(FINAL), JSON.stringify(outcome), 'profile:', u.strongWins, u.rouletteBestPoints);
    if (process.env.EXPECT_FIXED) {
      assert.equal(outcome.strongWins, undefined); assert.notEqual(outcome.best_NOW, 'allowed'); assert.notEqual(outcome.best_FUTURE, 'allowed');
    } else {
      assert.equal(outcome.strongWins, 5); assert.equal(outcome.best_NOW, 'allowed');
    }
  });
});
