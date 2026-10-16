# Architecture

Subutai is a client-only React app. There is no server of its own: the
Firestore rules are the only trust boundary (see `FIRESTORE-RULES.md`).

## Layers

| Folder | What lives there |
|---|---|
| `src/engine`, `src/ai`, `src/analysis`, `src/recording` | Rules of the variant, the bot, scoring, the game log. No React. `scripts/` and `qa/engine` import these by path. |
| `src/session` | The game on the board as one value: `SessionState`, the pure `step(state, action)` that makes the next one and says what happened, and the store App and the hooks read it from (`session`, `useSession`). No React in `step.ts`; time comes in the action, chance from a seed in the state. |
| `src/firebase` | Every Firestore read and write. The document shapes here are what the rules check; `npm run test:rules` runs this code against the emulator. |
| `src/audio`, `src/music`, `src/twitch`, `src/spotify` | Browser integrations with no UI of their own. |
| `src/memory` | Saved games: storage, notation, replay import, the Memory panel, and the hooks that autosave a game and resume one. |
| `src/components` | Components that several parts of the app use (Toast, Tooltip, modals, NamePicker, ClockFace, PlayerRow), and the screens that predate the feature folders (GameReview, MusicDock, Leaderboard, FriendLobby, TwitchPanel, StatsPage, ShowcaseView). |
| `src/app` | The shell: `App.tsx` lives in `src/`, its app-wide hooks here (URL modes, board size and UI scale, phone drawers, welcome and tour, the guards on leaving a game, the room's colours, the adaptive theme), and the styles of the whole page in `src/app/styles`. |
| `src/features/<name>` | What `App.tsx` used to hold, one folder per feature: hooks, pure helpers with their tests, and CSS. |
| `src/shared` | Types and helpers that two or more features use. |

Features: `game` (board marks, move feedback, bot, roulette, clocks, eval,
board effects, coach, notation), `online` (the live match, its end,
presence), `local` (hot-seat styles), `review` (watching a saved game, shared
games), `endgame` (results, the save queue, the end-of-game sequence),
`music`, `twitch`, `autoplay` (self-play).

## The shell

`App.tsx` calls the hooks, reads the game from the session (and an online
game from its match), keeps the screen's own state, and picks a view: stats,
autoplay, review, leaderboard, lobby or the game. Every hook is called
before that choice, so they all stay mounted whatever is on screen: the bot,
the clocks and presence keep running while the leaderboard is open. Game
state never goes into a component that unmounts with its view.

Each hook is a block that stood in App, moved as it was and called where it
stood, so React still runs the effects in the same order. Two things still
depend on that order:

- `useOnlineMatch`, which reseats a reloaded online match and clears its
  resume code, runs before `useResumeGame` checks that code.
- `useGameClocks` resets the flag for a new match before the flag check.

What a move sets off no longer depends on it: the board's sound and effects
listen to events (see How data flows), and `window.subutaiFX` is one object
each hook registers its entries on (`src/services/fxSeam.ts`).

A hook receives what it reads as one object of arguments and returns what
the rest of App reads. Setters and refs it returns never change, so App lists
them in deps arrays where the linter asks; it changes nothing at run time.
Something App declares further down reaches a hook either as a hoisted
function declaration (`startNewGame`) or, for a state setter declared later
(`setMobilePanel`), as a small wrapper that is only called from callbacks.

## How data flows

```
 Firestore (/matches, /games, /users)        localStorage (Memory, subutai_*)
        │  snapshot          ▲ writes               ▲              │
        ▼                    │                      │              ▼
 useOnlineMatch ──┐   useOnlineMatchEnd     useMemoryAutosave   useResumeGame
                  │   useGameSaveQueue
                  ▼
 session (src/session): step(state, action) ◄── session.dispatch(action)
        │ useSession                                        ▲
        ▼                                                   │
 App.tsx: read-side aliases (state, log, legalMoves)        │
        │                                                   │
        ▼                                                   │
 feature hooks (bot, clocks, classifier, effects, coach …) ─┤
        │                                                   │
        ▼                                                   │
 the view on screen (board, panels, dialogs) ── a click ────┘
```

Where the game lives: a solo or hot-seat game is the session (the board, the
log, the status, the roulette turn, the pending promotion, the draw offers,
the clocks); App reads it with `useSession` and changes it only by
dispatching an action. An online game lives in its match document;
`useOnlineMatch` subscribes to it and App reads it through the same names
(`state`, `log`, `legalMoves`, `lastMove`), so the board and the hooks do
not care which kind of game it is.

A move, from the click to the record. A click on a square calls
`onSquareClick` in App, which finds the move among the legal ones. Solo, it
dispatches `{ type: 'move' }`: `step()` applies it, appends it to the log,
runs the roulette turn and asks whether the game is over, and says what
happened as events (move, capture, check, rotation, promotion, game end).
The services hear them (`src/services`, started in `main.tsx`): the
beat combo scores the move at once; the move sound and `useCaptureFx`
(spark, strobe, dust) act after the render that shows the move
(`useBoardEventsAfterCommit`), so they are timed from what is on screen. A watched replay stepping one move on
plays that move out too, as a replayed event (actor `replay`) that
nothing counting or recording play looks at. An online match's moves,
both sides', come out of the session too: each snapshot of the match
document is a `follow` action (`src/session/online.ts`), and a move
appended to it plays out as a `remote` event. The new session opens the next turn
(`src/session/players/turns.ts`): a side seated with the bot is asked for
its answer, which it finds after a pause on the search worker
(`src/ai/search.worker.ts`); a side seated here answers by acting
(`turns.act`). The new session re-renders the board, and the effects that
still follow state run: `commitAnalysis` from `useClassifier` records the
classifier's verdict, `useMemoryAutosave` snapshots the game. When a move,
a flag fall, a resignation or an agreed draw ends the game, the session's
`gameEnd` event reaches App after the render that shows the ending
(`useSessionEventsAfterCommit`), and App calls `finishGame`, which scores
it and hands the save to `useGameSaveQueue`;
`saveCompletedGame` in `src/firebase/games.ts` writes the game to `/games`
and updates the player's `/users` profile in a transaction. Online, the
click goes to `mpSync.sendMove`, which appends the move to
`/matches/{code}` in a transaction stamped with server time; the rules
check whose turn it is, and the opponent receives the new document through
the same subscription.
`useOnlineMatchEnd` writes the outcome and each player saves their own
`/games` record.

Three things still follow the game's state rather than its events, on
purpose:

- **The endgame scene** (`useEndgame`). It starts in layout effects on
  `gameStatus`, before the browser paints the render that first shows the
  ending: that render also carries the summary (and Local's "Game over"
  card), and a start after the paint let the summary show for a frame or
  more before the cut covered it (N-2). Events are handled in a passive
  effect after the commit, with no promise to run before the paint; and an
  online ending is the match document's, which sends no event.
- **The coach** (`useCoachNudges`). Its nudges are triggered by the
  search's evaluation of the position, which lands some time after the move
  (and is `null` until then), not by the move: a move event carries no
  evaluation to judge.
- **The game-start ping** (`useGameStartPing`). It records a solo game the
  first time the player is signed in and its log has a move, once per log
  id. That covers a game resumed from Memory or a reload, which load
  without events, and a sign-in in the middle of a game; driven by move
  events it would miss both, which would change what is recorded.

## Where to add things

- A new feature: a folder `src/features/<name>` with its hook, helpers and
  tests. Call the hook from App after everything it reads is declared, and
  return only what the rest of App needs. Its stylesheet goes into the
  `src/App.css` index at the place in the cascade its rules need.
- A new screen: a component, behind `lazy()` if it is heavy, chosen in
  App's view switch. Anything that must outlive the screen stays in a hook
  called before the switch. A failed chunk load is handled by
  `AppErrorBoundary`.
- A new Firestore record: its reads and writes in `src/firebase/<name>.ts`,
  its rules in `firestore.rules` with tests in `tests/rules`, and rules that
  allow it deployed before any client writes it.

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
- `src/session/step.golden.test.ts` holds `step()` to the game as App's
  handlers played it before the session (`src/session/golden/legacy.ts`):
  320 seeded self-play games and the QA fixtures, compared after every
  action. A rule change shows up there first.
- `scripts/test-*.ts`, `scripts/repro960.ts` and `qa/engine/*` for the engine and the game log (`npx tsx <file>`).
- `npm run test:rules` for the rules, driven by the real client.
