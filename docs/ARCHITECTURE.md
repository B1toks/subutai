# Architecture

Subutai is a client-only React app. There is no server of its own: the
Firestore rules are the only trust boundary (see `FIRESTORE-RULES.md`).

## Layers

| Folder | What lives there |
|---|---|
| `src/engine`, `src/ai`, `src/analysis`, `src/recording` | Rules of the variant, the bot, scoring, the game log. No React. `scripts/` and `qa/engine` import these by path. |
| `src/firebase` | Every Firestore read and write. The document shapes here are what the rules check; `npm run test:rules` runs this code against the emulator. |
| `src/audio`, `src/music`, `src/twitch`, `src/spotify` | Browser integrations with no UI of their own. |
| `src/memory` | Saved games: storage, notation, replay import, and the Memory panel. |
| `src/components` | Components that several parts of the app use (Toast, Tooltip, modals, NamePicker), and the screens that predate the feature folders (GameReview, MusicDock, Leaderboard, FriendLobby, TwitchPanel, StatsPage, ShowcaseView). |
| `src/app` | The shell: `App.tsx`, which view is on screen, and the styles of the whole page in `src/app/styles`. |
| `src/features/<name>` | What `App.tsx` used to hold, one folder per feature: components, hooks and CSS together. |
| `src/shared` | Types and helpers that two or more features use. |

Features: `game` (board, move input, bot, roulette, clocks, draw offers, eval,
board effects, coach), `local` (hot-seat), `online` (matches, lobby, quick
match), `review`, `leaderboard`, `memory` (saved games, resuming a live game),
`music`, `twitch`, `endgame` (saving, summary, the mate cinematic),
`tutorial` (welcome, tour), `autoplay` (self-play), `showcase` (exhibition).

## The shell

`App.tsx` calls the feature hooks and picks a view: stats, autoplay, review,
leaderboard, lobby or the game. Every hook is called before that choice, so
they all stay mounted whatever is on screen: the bot, the clocks and presence
keep running while the leaderboard is open. Game state never goes into a
component that unmounts with its view.

Hooks are called in a fixed order because React runs effects in that order.
Three things depend on it:

- `useBoardFx`: the capture and rotation effects read `prevBoardRef` before
  the snapshot effect overwrites it.
- `useBoardFx` creates `window.subutaiFX` before `useEndgame` adds `mate` to it.
- `useMultiplayer` clears the resume code before `useLiveSession` reads it.

Functions that an earlier hook needs from a later one (`startNewGame`,
`finishGame`) are passed as refs and updated in a layout effect, which runs
before any `useEffect` in the same commit.

## Styles

`src/App.css` only imports the stylesheets, in one fixed order. That order is
the cascade: at equal specificity the later file wins. A stylesheet sits next
to the code that renders its classes (a component, a feature folder, or
`src/app/styles` for tokens, themes, layout, buttons and breakpoints), but no
component imports it: a lazy chunk would load it late and change which rule
wins. The late files (theme overrides, the top bar and rail, buttons,
responsive rules) come after the features they override, which is also why
one component can have several files (`GameReview.css`,
`GameReview.turning-points.css`): other stylesheets sit between them. A few
files still hold a handful of rules for a neighbour, left where the cascade
has them. Any change of order shows up in `dist/`: the built CSS of a pure
move is byte-identical.

## Things that do not change

`localStorage` keys `subutai_*`, the console seams `window.subutai*`, the
`data-tour` attributes, CSS class names and the fields of Firestore documents.
Players, saved games and QA scripts depend on them.

## Tests

- `*.test.ts` next to the code, for the pure functions (`npm test`).
- `scripts/test-*.ts`, `scripts/repro960.ts` and `qa/engine/*` for the engine and the game log (`npx tsx <file>`).
- `npm run test:rules` for the rules, driven by the real client.
