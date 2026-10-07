/* Draw by agreement: the offer rules both Local (hot-seat) and Online use
 * (src/utils/drawOffer.ts). One offer at a time, retired by any move, and
 * a side that offered may not offer again until it has moved itself.
 * Online, a declined offer stays marked until the next move: one offer
 * per ply.
 *
 * Run: npx tsx scripts/test-draw-offer.ts
 */
import {
  NO_DRAW_OFFERS,
  canAnswerDraw,
  canOfferDraw,
  declineDraw,
  drawOfferBlock,
  drawTableAfterMove,
  offerDraw,
  standingDrawOffer,
  type DrawTable,
} from '../src/utils/drawOffer';

type Color = 'white' | 'black';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const empty: DrawTable<Color> = NO_DRAW_OFFERS;

// --- Standing ---------------------------------------------------------
check('no offer stands', standingDrawOffer(null, 4), null);
check('an absent field stands for nothing', standingDrawOffer(undefined, 4), null);
check('an offer stands at its own ply', standingDrawOffer({ by: 'white', atPly: 4 }, 4), { by: 'white', atPly: 4 });
check('any move retires it', standingDrawOffer({ by: 'white', atPly: 4 }, 5), null);
check('an offer from a later ply than the log is not standing', standingDrawOffer({ by: 'white', atPly: 6 }, 5), null);

// --- Offering ---------------------------------------------------------
check('no offer before the first move', drawOfferBlock(empty, 'white', 0), 'no-moves');
check('offer after a move', canOfferDraw(empty, 'white', 1), true);
check('black may offer on white\'s turn', canOfferDraw(empty, 'black', 2), true);

const w4 = offerDraw(empty, 'white', 4);
check('the offer is recorded at the ply', w4.offer, { by: 'white', atPly: 4 });
check('the offering side waits for its own move', w4.waiting, ['white']);
check('white cannot offer twice', drawOfferBlock(w4, 'white', 4), 'offered');
check('one at a time: black answers instead of offering', drawOfferBlock(w4, 'black', 4), 'answer');
check('a blocked offer changes nothing', offerDraw(w4, 'black', 4), w4);

// --- Answering --------------------------------------------------------
check('black may answer white\'s offer', canAnswerDraw(w4.offer, 'black', 4), true);
check('white cannot answer its own offer', canAnswerDraw(w4.offer, 'white', 4), false);
check('nobody answers a retired offer', canAnswerDraw(w4.offer, 'black', 5), false);
check('white declining its own offer changes nothing', declineDraw(w4, 'white', 4), w4);

const declined = declineDraw(w4, 'black', 4);
check('decline clears the offer', declined.offer, null);
check('after a decline white still has to move first', drawOfferBlock(declined, 'white', 4), 'move-first');
check('the decline does not stop black offering', canOfferDraw(declined, 'black', 4), true);

// --- Moves ------------------------------------------------------------
// White offered on its own turn and was declined; black moving does not
// count as white's move.
const afterBlack = drawTableAfterMove(declined, 'black');
check('the opponent\'s move does not free white', drawOfferBlock(afterBlack, 'white', 5), 'move-first');
const afterWhite = drawTableAfterMove(afterBlack, 'white');
check('white\'s own move frees white', canOfferDraw(afterWhite, 'white', 6), true);

// White offers on BLACK's turn (just after its own move). Black moves
// instead of answering: the offer is gone, white still has not moved.
const offBlackTurn = offerDraw(empty, 'white', 3);
const blackIgnored = drawTableAfterMove(offBlackTurn, 'black');
check('moving instead of answering retires the offer', blackIgnored.offer, null);
check('nothing is left to answer', canAnswerDraw(blackIgnored.offer, 'black', 4), false);
check('white waits for its next move', drawOfferBlock(blackIgnored, 'white', 4), 'move-first');
check('black may offer now', canOfferDraw(blackIgnored, 'black', 4), true);

// The offering side moving retires its own offer too.
const ownMove = drawTableAfterMove(w4, 'white');
check('white moving retires its own offer', ownMove.offer, null);
check('and white may offer again later', canOfferDraw(ownMove, 'white', 6), true);

// Roulette: a turn can be two actions by the same side.
const r = offerDraw(empty, 'black', 6);
const r1 = drawTableAfterMove(r, 'white');
check('roulette: white\'s first action retires black\'s offer', standingDrawOffer(r1.offer, 7), null);
check('roulette: black still has to move', drawOfferBlock(r1, 'black', 7), 'move-first');
const r2 = drawTableAfterMove(r1, 'white');
check('roulette: white\'s second action does not free black', drawOfferBlock(r2, 'black', 8), 'move-first');
check('roulette: black\'s first action frees black', canOfferDraw(drawTableAfterMove(r2, 'black'), 'black', 9), true);

check('a move with nothing on the table returns the same table', drawTableAfterMove(empty, 'white') === empty, true);

// --- Online seats are uids -------------------------------------------
const uidTable: DrawTable<string> = offerDraw(NO_DRAW_OFFERS, 'uid-host', 2);
check('uid seat: the guest may answer', canAnswerDraw(uidTable.offer, 'uid-guest', 2), true);
check('uid seat: the host may not answer itself', canAnswerDraw(uidTable.offer, 'uid-host', 2), false);

// --- Online: a decline marks the offer, one offer per ply --------------
// The match doc keeps a declined offer until the next move; the rules let
// nobody offer at a ply that already had one.
const declinedOnline: DrawTable<string> = {
  offer: { by: 'uid-host', atPly: 2, declined: true },
  waiting: [],
};
check('a declined offer does not stand', standingDrawOffer(declinedOnline.offer, 2), null);
check('nobody answers a declined offer', canAnswerDraw(declinedOnline.offer, 'uid-guest', 2), false);
check('the player who declined may not offer at that ply', drawOfferBlock(declinedOnline, 'uid-guest', 2), 'declined');
check('the player who offered may not either', drawOfferBlock(declinedOnline, 'uid-host', 2), 'declined');
check('the own lock speaks first', drawOfferBlock({ ...declinedOnline, waiting: ['uid-host'] }, 'uid-host', 2), 'move-first');
check('after a move either may offer', canOfferDraw(declinedOnline, 'uid-guest', 3), true);

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nALL PASS');
