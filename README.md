# Subutai — Auxetic Chess960

A **Chess960 variant** with dynamically rotating 2×2 board segments and custom castling. Built as the technical implementation for **[Lucid Dreams 2026](https://www.lucid-dreams.at/2026-projekte/projekt-027)** — FH St. Pölten's annual interactive media exhibition.

♟ **Live:** [subutai.honchar.dev](https://subutai.honchar.dev/)
✦ **Exhibition:** [Lucid Dreams · Projekt 027](https://www.lucid-dreams.at/2026-projekte/projekt-027)

---

## What it does

- Plays a custom chess variant where 2×2 segments of the board rotate mid-game, forcing players to re-read the position on every turn
- Chess960 starting layout — back rank shuffled per game
- Custom castling rules adapted to the rotation mechanic
- All standard rules + segment-rotation logic + global state synchronization

## Playing

- **Bot strength** — Casual / Normal / Strong. Strong is the full engine and the only level that counts for the leaderboard; the lighter levels are for learning the rotation mechanic and are saved as practice games.
- **Time control** — None / 1 / 3 / 10 min per side against the bot. Clocks start on the first move; running out of time loses the game.
- **Modes** — Classic (checkmate wins, rotation costs a tempo) and Roulette (spin a bag of piece types, two actions per turn, capture the king).
- **Opponents** — the engine, a friend by 6-letter code (or Quick match), or hot-seat on one device.
- **Themes** — Adaptive (default: Neon while the board is in topology A, Wood Light in B), Neon, Wood, Wood Light, Fantasy. The theme button sits in the settings tray at the bottom of the left rail.

## Streaming & interactive layer

Subutai doubles as a stream toy — the audience plays along and the board reacts to music.

### Twitch chat modes

Open the Twitch panel, connect a channel, and pick a mode. Candidate moves are drawn on the board as colored dashed arrows (`!1` green, `!2` red, `!3` yellow, `!4` blue); the arrow thickens with its share of the vote.

- **Predict** — the engine picks its move; chat votes which of `!1`–`!4` is the real one. Correct guessers score.
- **Vs streamer** — chat votes 4 candidate moves; the top vote becomes the AI's move.
- **Vs bot** — chat plays the human side, typing any legal move (`e4`, `Nf3`, `O-O`, `e2e4`); the majority is played.
- **Guess** — while *you* think, chat types the move they expect you to make. The moment you move, everyone who called it scores +2 and their names flash over the board.

### Music & beat sync

The music dock loads a Spotify/track URL, a local file, or captures tab/mic audio, detects BPM (histogram → essentia.js → TempoCNN neural net), and locks a beat grid. Turn on **Beat Mode** to snap moves to the beat. First-time controls explain themselves with a one-line coach-mark. Dock the Twitch and music panels into the layout and the board slides over to make room.

### Endgame scenes

Every finished game ends with a short full-screen scene, then the summary. The scene is always about *your* king:

- **Victory** — your king is lifted off its square, crowned, and the screen freezes on **VICTORY**.
- **Defeat** — your king is lifted and topples; **DEFEAT**.
- **Draw** — two hands meet in the middle.

A checkmate closes an iris on the king first and hands over to the scene; a flag fall, a resignation or a captured king start with a beat of dimmed stillness. It plays the same way against the bot and in an online match (there it also covers a resignation, a flag fall and an inactivity forfeit), and it is skipped when spectating and with *reduce motion* on. In hot-seat there is no "you", so the scene follows the winner's king. The result is decided by the game, not by how it was going: a win from a lost position and a win from the first move get the same scene.

To play one on demand, open the browser DevTools console and run:

```js
subutaiVictory()        // red theme
subutaiVictory('blue')  // electric-blue theme
subutaiDefeat()
subutaiDraw()
subutaiEndgame('victory', { full: true }) // with the checkmate iris in front
```

## Tech

- **React 19** + **TypeScript**
- **Vite** — dev server + build
- **essentia.js** (WASM) + **TensorFlow.js** — live BPM / TempoCNN tempo detection
- Pure-state board representation (no DOM-driven game state)

## Run locally

```bash
git clone https://github.com/B1toks/subutai.git
cd subutai
npm install
npm run dev
```

## Backend (optional)

Display names, saved games, the leaderboard, and the feedback collector use Firebase (Anonymous Auth + Firestore) on the free Spark plan. The chess engine, classifier, and eval bar work fully offline without it. See [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) for the setup walkthrough.

`firestore.rules` validates every write (field shapes, size caps, leaderboard numbers must be backed by a saved game, match logs are append-only and turn-owned). Deploy them with `npx firebase-tools deploy --only firestore:rules` after any change. Publishing the site (`npm run deploy`) does not publish the rules; a release that changes `firestore.rules` needs that command as a separate step.

## Security notes

- Production builds ship a Content-Security-Policy `<meta>` tag (injected by the Vite plugin in `vite.config.ts`); dev builds don't, so Vite HMR keeps working. If a new third-party integration is added, extend the policy there.
- The Firebase web API key is public by design; restrict it by HTTP referrer in the Google Cloud console.
- Audit, open items and the launch checklist: [docs/SECURITY-AUDIT-2026-09.md](./docs/SECURITY-AUDIT-2026-09.md), [docs/LAUNCH-CHECKLIST-V1.md](./docs/LAUNCH-CHECKLIST-V1.md).

## My role

Joined the project as **Technical Lead** for the front-end implementation, working with an international 5-person team at FH St. Pölten. Owned the technical architecture and most of the implementation — segment-rotation math, custom castling, state sync.

The repository is forked from **[vschetinger/subutai](https://github.com/vschetinger/subutai)** (the originating team space) where ongoing collaboration happens.

---

Built by **Oleksandr Honchar** with the FH St. Pölten EPS team · [honchar.dev](https://www.honchar.dev) · [LinkedIn](https://www.linkedin.com/in/honchar-oleksandr/)
