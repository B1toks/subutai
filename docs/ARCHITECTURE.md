# Architecture

Subutai is a client-only React app. There is no server of its own: the
Firestore rules are the only trust boundary (see `FIRESTORE-RULES.md`).

## Layers

| Folder | What lives there |
|---|---|
| `src/engine`, `src/ai`, `src/analysis`, `src/recording` | Rules of the variant, the bot, scoring, the game log. No React. `scripts/` and `qa/engine` import these by path. The game's search runs on a worker (`src/ai/search.worker.ts`, `searchClient.ts`), the classifier on another. |
| `src/session` | The game on the board as one value: `SessionState`, the pure `step(state, action)` that makes the next one and says what happened, and the store App and the hooks read it from (`session`, `useSession`). An online match's document is followed into it (`online.ts`). No React in `step.ts`; time comes in the action, chance from a seed in the state. |
| `src/session/players` | Who plays each side: the seats, the turns that ask the side to move (`turns.ts`), and the players (here, bot, chat, remote). |
| `src/firebase` | Every Firestore read and write. The document shapes here are what the rules check; `npm run test:rules` runs this code against the emulator. |
| `src/infra` | The app's side of storage: `repos.ts` names the Firestore functions the app calls as interfaces (games, the live match, the lobby, presence, the profile name, the leaderboard, feedback), `firestore/*` hands each call to its `src/firebase` function, `localData.ts` holds every localStorage key and the calls that touch them, and `fakes/*` are in-memory versions for unit tests only. |
| `src/services` | What reacts to the game or works on it outside React: the board's sound and effects bus, the beat combo (started with the streaming integrations), the save queue (`saveQueue.ts`, over a `GamesRepo`). |
| `src/audio` | The game's sound: synths, the controller, ambient music. |
| `src/integrations` | The streaming integrations behind `STREAMING_UI` (`?streaming=1`), loaded only with it and after the first load: `music` (the beat grid and its tempo detection, the mic equalizer, the Spotify playlists), `twitch` (chat, its votes, chat's game). The rest of the app reaches them through `index.ts` only. |
| `src/memory` | Saved games: storage, notation, replay import, the Memory panel, and the hooks that autosave a game and resume one. |
| `src/components` | Components that several parts of the app use (Toast, Tooltip, modals, NamePicker, ClockFace, PlayerRow), and the screens that predate the feature folders (GameReview, MusicDock, Leaderboard, FriendLobby, TwitchPanel, StatsPage, ShowcaseView). |
| `src/app` | The shell: `App.tsx` lives in `src/`, its app-wide hooks here (URL modes, which screen is up, board size and UI scale, phone drawers, welcome and tour, the guards on leaving a game, the room's colours, the adaptive theme, the way back from a screen), the page-wide components (header, status bar, Help, the small dialogs), and the styles of the whole page in `src/app/styles`. |
| `src/features/<name>` | What `App.tsx` used to hold, one folder per feature: hooks, pure helpers with their tests, and CSS. |
| `src/shared` | Types and helpers that two or more features use. |

Features: `game` (board marks, move feedback, bot, roulette, clocks, eval,
board effects, coach, notation), `online` (the live match, its end,
presence), `local` (hot-seat styles), `review` (watching a saved game, shared
games), `endgame` (results, the save queue, the end-of-game sequence),
`music`, `twitch`, `autoplay` (self-play).

## The shell

`App.tsx` calls the hooks, reads the game from the session (an online match
too: the session follows its document), keeps the screen's own state, and
picks a view: stats,
autoplay, review, leaderboard, lobby or the game. Every hook is called
before that choice, so they all stay mounted whatever is on screen: the bot,
the clocks and presence keep running while the leaderboard is open. Game
state never goes into a component that unmounts with its view.

Each hook is a block that stood in App, moved as it was and called where it
stood, so React still runs the effects in the same order. Three things still
depend on that order:

- `useOnlineMatch`, which reseats a reloaded online match and clears its
  resume code, runs before `useResumeGame` checks that code.
- `useGameClocks` resets the flag for a new match before the flag check.
- `useGameResult`, whose completion handler drains the session's events,
  runs before `useSoloFlagFall`, which dispatches the flag fall inside its
  effect: the other way round, a loss on time could be handled with the
  render before it and never reach `finishGame`.

Five groups of App's state live in the hook of the feature that owns them,
with their effects and handlers: the self-play run
(`features/autoplay/useAutoPlay`), the watched game
(`features/review/useWatching`), the screen and the Review's own game
(`app/useScreens`), the end of a solo game
(`features/endgame/useGameResult`: the summary, the save, the 50-move
dialog), and the online match (`features/online/useOnlineMatch`: the match
followed, its outcome, the resume code, the "I resigned" mark). Such a hook
declares the group's `useState`s and refs and returns the group as one
object (`auto`, `result`, `mp` …), which App hands whole to the hooks and
components that read several of its names (`AutoRun`, `SoloSummary`,
`MilestoneDialog`, `useOnlineMatchEnd`, `MatchCompleteDialog`) and reads
single names from where another hook needs one.

Three more groups are state only, with no effects, declared where App
declared them so React's hook slots stay in the same order: the board's own
UI state (`features/game/useBoardUi`: the selection, the rotation preview
and its lock, the coaching tools, the Beat Mode hold, the annotations, the
formation lock and code editor, Load replay), the coach's memory
(`features/game/useCoachState`) and the classifier's marks
(`features/game/useMoveVerdicts`). App passes `ui`, `coach` and `verdicts`
whole; the two effects that follow the board's UI state (the hint reset on
a new position, the code editor's focus) stayed in App where they stood. An effect went with its group only
where it commutes with every effect it crossed: none of them reads or
writes the same state or ref in its body, and neither dispatches to the
session there. Five effects moved that way (the watch autoplay, the
shared-game load, the save queue's and the milestones' two); each commit's
message names the effects crossed and why they commute. What a later hook
must stamp before the group's hook can be called stays App's ref and goes
in as an argument: the three log ids (completed, imported, resumed).

What a move sets off no longer depends on it: the board's sound and effects
listen to events (see How data flows), and `window.subutaiFX` is one object
each hook registers its entries on (`src/services/fxSeam.ts`).

A hook receives what it reads as one object of arguments and returns what
the rest of App reads. Setters and refs it returns never change, so App lists
them in deps arrays where the linter asks; it changes nothing at run time.
Something App declares further down reaches a hook either as a hoisted
function declaration (`startNewGame`) or, for a state setter declared later
(`setMobilePanel`), as a small wrapper that is only called from callbacks.

### What is on screen, and what a click does

The game view's markup is components, each a block that stood in App's
JSX, moved as it was and rendered where it stood: the header
(`src/app/AppHeader`), the banners, the clocks and the roulette panel, the
board (`features/game/BoardTiles`, `BoardOverlays`, `BoardCoords`), the
row under it (`BoardActions`), the right column (`GameSetupPanel`,
`MovesPanel`, `AnalysisPanel`), the status bar and the dialogs. A
component reads the game from the session itself, with `useSession` and the
selectors of `features/game/boardView.ts`, which pick the game App shows
(an online match's while one is played here, else the solo game); what is
not in the session (who is to act, App's own state, a hook's values, a
handler) comes as a prop. None adds an element: the board's tiles and
overlays are fragments, so `.board` keeps its children and the CSS that
targets them. The screens' shells (`key={view}`, `shellRef`) and every lazy
screen with its `Suspense` stay in App.

What a click does is a handler hook: `useBoardInput` (a tile, a promotion,
right-drag arrows), `useRotate`, `useCoachTools`, `useFormation`,
`useResignAndDraw`, `useWatching`, `useReplayImport`,
`useScreenNavigation`. These hold no effects: the only React hook inside is
`useSession`, which reads the game App shows in the same render, as App's
own aliases do; the rest is functions over what App passes from its render,
so where App calls them changes no effect order. App calls each after
everything it reads is declared, the ones that read late values (`layout`,
`canRotate`) just before the view switch. Most of App's other hooks read
the game the same way (`useSession` with the selectors of
`features/game/boardView.ts`) instead of taking the board, the log, the
status or the mode as arguments; none of them imports `session/step.ts`,
which stays out of the chunks the lazy screens share.
Example path, a move on the board: a tile's click in `BoardTiles` calls
`onSquareClick` from `useBoardInput`, which finds the move among the legal
ones and acts it into the session (`turns.act`); the session's new state
re-renders App and every component reading it, `BoardTiles` included, and
the move's sound and effects follow its events (How data flows).

## How data flows

```
 Firestore (/matches, /games, /users)        localStorage (Memory, subutai_*)
        │  snapshot          ▲ writes               ▲              │
        ▼                    │                      │              ▼
 useOnlineMatch ──┐   useOnlineMatchEnd     useMemoryAutosave   useResumeGame
  (follow)        │   useGameSaveQueue
                  ▼
 session (src/session): step(state, action) ◄── session.dispatch(action)
        │ useSession        │ the turns (players/turns.ts)      ▲
        │                   └─► the bot, chat: onTurn ─────────┤
        │ events, state ──► services; integrations (STREAMING_UI, lazy):
        │                   beat combo, chat's game (twitchGame)
        ▼                                                      │
 App.tsx: the game on the board (state, log, legalMoves)       │
        │                                                      │
        ▼                                                      │
 feature hooks (clocks, classifier, effects, coach …) ─────────┤
        │                                                      │
        ▼                                                      │
 the view on screen (board, panels, dialogs) ── a click: turns.act
```

Where the game lives: a solo or hot-seat game is the session (the board, the
log, the status, the roulette turn, the pending promotion, the draw offers,
the clocks); App reads it with `useSession` and changes it only by
dispatching an action. An online game lives in its match document, which
`useMultiplayerSync` reads; each snapshot is a `follow` action, and the
session keeps the document beside the solo game (`state.online`) with what
it makes on the board here (the board, the log, the legal moves, the last
move, the Roulette bag). The document and the board change in one step,
and App reads the game on the board through one set of names (`state`,
`log`, `legalMoves`, `lastMove`), so the board and the hooks do not care
which kind of game it is. The solo game is left as it was and shows again
when the match goes.

A move, from the click to the record. A click on a square calls
`onSquareClick` in App, which finds the move among the legal ones. Solo, it
dispatches `{ type: 'move' }`: `step()` applies it, appends it to the log,
runs the roulette turn and asks whether the game is over, and says what
happened as events (move, capture, check, rotation, promotion, game end).
The services hear them (`src/services`, started in `main.tsx`), and with
`?streaming=1` the integrations too: the beat combo scores the move at once;
the move sound and `useCaptureFx`
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
`gameEnd` event reaches `useGameResult` after the render that shows the
ending (`useSessionEventsAfterCommit`), and it calls `finishGame`, which
scores the game, opens the summary and hands the save to
`useGameSaveQueue`, which runs the save queue
(`src/services/saveQueue.ts`) over `gamesRepo`: one save at a time,
`saveCompletedGame` in `src/firebase/games.ts` writing the game to `/games`
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

## Players

Each side of the game on the board is seated with a player
(`src/session/players`), and `useSeats` chooses them:

| Game | White | Black |
|---|---|---|
| solo vs the bot | the player here (with Twitch: chat, or the player with chat guessing) | the bot |
| hot-seat | the player here | the player here |
| self-play run | the run's bot | the run's bot |
| online match | the remote player on the opponent's side; nobody on mine | |
| a replay being watched, a stopped run | nobody | nobody |

The turns (`turns.ts`) open a turn whenever the board, the phase, the
Roulette bag, the mode or the game changes (a clock tick or a classifier's
verdict is not a new turn), ask the side to move's player with `onTurn`,
and dispatch its answer. A turn that ends first (a move, a resign, a flag,
a new game, a resume, a seat change) aborts the player's signal, and an
answer that comes after that is dropped: what used to clear the bot's
timer by hand.

- **The player here** (`human.ts`) answers by acting: App's click, rotation
  and promotion handlers call `turns.act`, which dispatches at once, in the
  click, and only for a side seated here.
- **The bot** (`bot.ts`) pauses, asks the search worker for the level's
  move, lets the Twitch Predict vote have its say (`moveVoting.gate`), and
  answers; the end of the game is asked after the classifier's verdict.
  Roulette: the spin, then each action of the bag after its pause. The
  self-play bot is the same with a short pause and a label search.
- **Chat** (`chat.ts`) votes the side's move through
  `moveVoting.gateHumanMove`, the one vote pipeline; the player here shares
  the seat, and their move first ends the turn and drops the vote. Guess
  the streamer wraps the player here: the guess opens with the turn and is
  dropped when it ends unrevealed.
- **The remote player** (`remote.ts`) answers nothing here: the opponent's
  moves, and mine once written (`mpSync.sendMove`), arrive in the match
  document, which the session follows.

### A Roulette bag landing (v1.1.6)

A bag lands on the panel one slot every 400 ms, with a beat each, and the
last settles 200 ms before the bag is the side's: the player's spin, the
bot's, and online on both screens when a fresh bag arrives in the match
document. The landing is **session state**, `RouletteReveal` (in
`roulette.reveal`, or `online.reveal` for a match's bag), not UI state or
a player's own timer, because three things must hold for every kind of
spin and only the session sees them all:

- **The turn waits for it.** `turns.ts` opens no turn while a reveal is
  there, so the bot, the auto-spin and the player here cannot act on a bag
  that has not landed, without a check of their own; when it lands, the
  state changes and the turn opens with the bag.
- **A new game is a clean board.** `newGame`, `load` and the mode click
  reset the roulette state, the reveal with it, so nothing of an
  interrupted spin can land on the next board. (v1.1.6 landed the bag in
  Classic after a mode click mid-spin; v1.1.7 fixed that in App.)
- **Online and solo look the same.** `follow` opens the reveal when the
  document's bag goes from none to one; one already there when the match
  is joined or rejoined is shown as it is.

The roll is made when the wheel starts (`spinStart`, `botSpin`), as in
v1.1.6. The clock is not in `step()`, which has none: `session/reveal.ts`
watches the store like the turns do and dispatches `spinSlot` 400 ms after
each beat (timed from the one before, so a busy frame delays a beat without
squeezing the rest) and `spinLand` 200 ms after the last; both name their
reveal by `since`, so a late one for a reveal that is gone is refused.
`services/spinSounds.ts` plays the beat of each `rouletteSlot` event; App
only draws the slots that have landed.

### The streaming integrations

Music and Twitch are `src/integrations`, and nothing of them is in the first
load: `main.tsx` calls `loadStreaming()` (`src/integrations/index.ts`), which
with `STREAMING_UI` fetches `integrations/streaming.ts` as a chunk of its own
and calls its `connect()`, and without the flag does nothing. The rest of
the app reaches them only through `index.ts`: `streaming()` in a handler,
`useStreaming()` in a render (it re-renders once they have loaded), both
null before and without the flag, and every caller then does what the app
did with the flag off. For example, the bot's move in a solo game: the bot
player asks `vote` (`useSeats`), which is `streaming()?.moveVoting.gate(...)`,
and without the integrations its own move; with them, Twitch Predict may
hold it for chat's vote. The music dock and the Twitch panel are lazy
screens that import the integrations' modules directly.

Twitch takes part in the game in two ways, both through the session: chat
can hold a seat (`session/players/chat.ts`, seated by `useSeats` in the
'chatvsbot' mode, or wrapping the player here in 'guess'), and chat's game
(`integrations/twitch/game.ts`) follows the session from `connect()`: a
new log clears the result calls and the leaderboard, the end of the game
scores the calls. The panel only shows it.

## Where to add things

- A new feature: a folder `src/features/<name>` with its hook, helpers and
  tests. Call the hook from App after everything it reads is declared, and
  return only what the rest of App needs. Its stylesheet goes into the
  `src/App.css` index at the place in the cascade its rules need.
- Something new on the game screen: a component in the feature's folder,
  reading the game with `useSession` (`features/game/boardView.ts` for the
  game on the board) and taking as props only what is not in the session.
  Its handlers go in the feature's handler hook (or a new one), not inline
  in App's JSX.
- A new screen: a component, behind `lazy()` if it is heavy, chosen in
  App's view switch. Anything that must outlive the screen stays in a hook
  called before the switch. A failed chunk load is handled by
  `AppErrorBoundary`.
- A new Firestore record: its reads and writes in `src/firebase/<name>.ts`,
  its rules in `firestore.rules` with tests in `tests/rules`, and rules that
  allow it deployed before any client writes it. The app calls it through a
  repository member (`src/infra/repos.ts` and the `firestore/*` module of the
  screen that loads it: one the first screen needs, or a lazy screen's own,
  so no Firestore code moves into the first load).
- A new localStorage setting: its key in `LOCAL_KEYS`
  (`src/infra/localData.ts`), read and written through `localData`.
- Something for streamers (music, Twitch, an overlay): its code in
  `src/integrations/<name>`, what the app needs of it exported from
  `integrations/streaming.ts` (and hooked to the game in its `connect()`),
  and every call from elsewhere through `streaming()` / `useStreaming()`
  with what happens when it is null. Never import it from a first-load
  module: it would put it in everyone's first load (check with the build's
  first-load size).

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

`localStorage` keys `subutai_*` (all in `LOCAL_KEYS`), the console seams `window.subutai*`, the
`data-tour` attributes, CSS class names and the fields of Firestore documents.
Players, saved games and QA scripts depend on them.

## Tests

- `*.test.ts` next to the code, for the pure functions (`npm test`).
- `src/session/step.golden.test.ts` holds `step()` to the game as App's
  handlers played it before the session (`src/session/golden/legacy.ts`):
  30 seeded self-play games per commit (320 in a full gate,
  `GOLDEN_GAMES=320`) and the QA fixtures, compared after every action. A
  rule change shows up there first.
- `scripts/test-*.ts`, `scripts/repro960.ts` and `qa/engine/*` for the engine and the game log (`npx tsx <file>`).
- `npm run test:rules` for the rules, driven by the real client.
- Services that write through a repository are tested with an in-memory one
  (`src/infra/fakes/*`, e.g. the save queue with `memoryGames`); nothing in
  the app imports the fakes, so they never reach the build.
