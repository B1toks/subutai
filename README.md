# Subutai — Kinetic Chess

A **Chess 960 variant** with dynamically rotating 2×2 board segments and custom castling. Built as the technical implementation for **[Lucid Dreams 2026](https://www.lucid-dreams.at/2026-projekte/projekt-027)** — FH St. Pölten's annual interactive media exhibition.

♟ **Live:** [b1toks.github.io/subutai](https://b1toks.github.io/subutai/)
✦ **Exhibition:** [Lucid Dreams · Projekt 027](https://www.lucid-dreams.at/2026-projekte/projekt-027)

---

## What it does

- Plays a custom chess variant where 2×2 segments of the board rotate mid-game, forcing players to re-read the position on every turn
- Chess 960 starting layout — back rank shuffled per game
- Custom castling rules adapted to the rotation mechanic
- All standard rules + segment-rotation logic + global state synchronization

## Tech

- **React 18** + **TypeScript**
- **Vite** — dev server + build
- **Tailwind CSS** + **ShadCN UI** — interface chrome
- Pure-state board representation (no DOM-driven game state)

## Run locally

```bash
git clone https://github.com/B1toks/subutai.git
cd subutai
npm install
npm run dev
```

## My role

Joined the project as **Technical Lead** for the front-end implementation, working with an international 5-person team at FH St. Pölten. Owned the technical architecture and most of the implementation — segment-rotation math, custom castling, state sync.

The repository is forked from **[vschetinger/subutai](https://github.com/vschetinger/subutai)** (the originating team space) where ongoing collaboration happens.

---

Built by **Oleksandr Honchar** with the FH St. Pölten EPS team · [honchar.dev](https://www.honchar.dev) · [LinkedIn](https://www.linkedin.com/in/honchar-oleksandr/)
