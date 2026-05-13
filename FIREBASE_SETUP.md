# Firebase Setup

Subutai uses Firebase Anonymous Auth + Firestore on the free Spark plan
for player accounts, saved games, and the leaderboard. The chess engine
itself works fully offline; only the multiplayer-feel features (display
names, saved games, leaderboard, replay) require Firebase.

## 1. Create the project

1. Go to https://console.firebase.google.com and create a new project.
2. Plan: **Spark** (free) is enough — no Cloud Functions needed.

## 2. Enable Anonymous Authentication

1. Firebase Console -> **Authentication** -> **Get started**.
2. **Sign-in method** -> **Anonymous** -> Enable -> Save.

Email/Google/etc. are NOT used. Each browser gets a fresh anonymous UID
on first load, persisted in IndexedDB.

## 3. Create the Firestore database

1. Firebase Console -> **Firestore Database** -> **Create database**.
2. Pick a region close to your players (e.g. `europe-west3`). This
   choice is permanent.
3. Start in **production mode** (locked rules). We replace the rules
   in step 5.

## 4. Wire the client

1. Project Settings -> **Your apps** -> Web app icon (`</>`).
2. Copy the `firebaseConfig` object.
3. Paste it into `src/firebase/client.ts` (replace the existing
   `firebaseConfig` block).

`src/firebase/client.ts` initialises one `app`, one `auth`, one `db`
instance — all other modules import from there.

## 5. Publish security rules

The repo ships rules in `firestore.rules` (project root).

**Manual path (no CLI required):**

1. Open `firestore.rules` in this repo, copy the entire contents.
2. Firebase Console -> Firestore Database -> **Rules** tab.
3. Paste, click **Publish**.

**CLI path (optional):**

```bash
npm install -g firebase-tools
firebase login
firebase use <your-project-id>
firebase deploy --only firestore:rules
```

`firebase.json` is not committed — if you go CLI, create a minimal one:

```json
{ "firestore": { "rules": "firestore.rules" } }
```

## 6. Verify

1. `npm run dev`
2. First load -> NamePicker modal -> pick a name -> Submit.
3. Firebase Console -> Authentication -> Users: one anonymous user.
4. Firestore Console -> Data tab: `users/{uid}` and
   `displayNames/{slug}` documents exist.
5. Finish a game (>= 10 moves) -> `games/` collection grows by one and
   the user doc gains `bestGamePoints`, `bestGameSnapshot`, etc.

## Collections

| Collection       | Purpose                                                   |
|------------------|-----------------------------------------------------------|
| `users/{uid}`    | Player profile, lifetime stats, best-game snapshot        |
| `displayNames/`  | Slug-keyed uniqueness index for case-insensitive names    |
| `games/{id}`    | One document per completed game (vs AI), slim replay log  |
| `feedback/{id}`  | Per-game and general feedback (private to the author)     |

## Reviewing feedback

Feedback is stored in the `feedback/` collection. Each document is
private — security rules let only the author read their own entry, but
the owner of the Firebase project always has full read access through
the Console.

1. Firebase Console -> Firestore Database
2. Click the `feedback` collection
3. Sort by `createdAt` descending in the query bar
4. Click each document to read the comments

Filter by type:
- `type: 'game'` — tied to a specific completed game; `gameId` and
  `gameContext` (outcome, moveCount, points, chess960Id) are populated.
- `type: 'general'` — submitted via the header feedback button. Has
  `liked`, `disliked`, and `comment` fields (any subset).

Each document includes `playerId` and `playerName` so you can correlate
multiple feedback entries from the same user.

## Quotas (Spark plan)

- 50K reads / 20K writes / 20K deletes per day.
- 1 GiB total storage.
- Leaderboard pagination is 25 entries per page; one Show-more click is
  ~25 reads. The full-table count for the user rank uses
  `getCountFromServer`, which costs 1 read per query regardless of count.

## What is NOT used

- Cloud Functions (not available on Spark).
- Cloud Messaging / Hosting / Storage.
- Email / Google / phone sign-in providers.
