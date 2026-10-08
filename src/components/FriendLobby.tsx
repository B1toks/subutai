import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Dices, Users, Zap } from 'lucide-react';
import { Icon } from './Icon';
import {
  createMatch,
  joinMatch,
  normalizeMatchCode,
  subscribeMatch,
  type MatchDoc,
  type MatchGameMode,
} from '../firebase/matches';
import { findQuickMatch, type QuickMatchHandle } from '../firebase/quickMatch';
import { getOnlineCount } from '../firebase/presence';

interface FriendLobbyProps {
  uid: string | null;
  displayName: string | null;
  onBack: () => void;
  /** Called when the second player joins and the match flips to active.
   *  Stage Q.B will wire this to an actual PvP game view; for now App.tsx
   *  just shows an acknowledgement alert. */
  onMatchReady: (match: MatchDoc) => void;
}

type LobbyView =
  | { kind: 'home' }
  | { kind: 'hosted'; code: string; status: 'waiting' | 'active' }
  | { kind: 'joining' }
  // R16 — quick-match states: actively searching the queue, and the honest
  // "nobody around" fallback offer after the 30s window closes.
  | { kind: 'searching' }
  | { kind: 'qm-empty' };

/* R13 — time-control presets: base seconds + Fischer increment. */
interface TimeControl {
  label: string;
  title: string;
  sec: number | null;
  inc: number | null;
}

const TIME_CONTROLS: TimeControl[] = [
  { label: 'No clock', title: 'Untimed match', sec: null, inc: null },
  { label: '3+2', title: '3 minutes + 2s per move', sec: 180, inc: 2 },
  { label: '5+0', title: '5 minutes per player', sec: 300, inc: 0 },
  { label: '10+0', title: '10 minutes per player', sec: 600, inc: 0 },
];

export function FriendLobby({
  uid,
  displayName,
  onBack,
  onMatchReady,
}: FriendLobbyProps) {
  const [view, setView] = useState<LobbyView>({ kind: 'home' });
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [createMode, setCreateMode] = useState<MatchGameMode>('classic');
  // R13 — time-control preset (classic friend matches only).
  const [timeControl, setTimeControl] = useState<TimeControl>(TIME_CONTROLS[0]);
  // onMatchReady changes identity on every parent render; storing in a ref
  // keeps the subscribe-effect deps minimal.
  const onMatchReadyRef = useRef(onMatchReady);
  onMatchReadyRef.current = onMatchReady;

  const signedIn = uid !== null && displayName !== null;

  // R16 — quick match. onlineCount null = unknown (presence rules not
  // deployed / offline): the counter simply hides instead of lying with 0.
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [searchSecs, setSearchSecs] = useState(0);
  const qmHandleRef = useRef<QuickMatchHandle | null>(null);

  useEffect(() => {
    let live = true;
    const refresh = () => {
      void getOnlineCount().then((n) => {
        if (live) setOnlineCount(n);
      });
    };
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  // Elapsed-seconds ticker for the searching screen.
  useEffect(() => {
    if (view.kind !== 'searching') return;
    setSearchSecs(0);
    const id = setInterval(() => setSearchSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [view.kind]);

  // Leaving the lobby mid-search must withdraw the queue entry.
  useEffect(() => {
    return () => qmHandleRef.current?.cancel();
  }, []);

  async function handleQuickMatch() {
    if (!signedIn || busy) return;
    setBusy(true);
    setError(null);
    setView({ kind: 'searching' });
    const handle = findQuickMatch({ uid: uid!, displayName: displayName! });
    qmHandleRef.current = handle;
    try {
      const res = await handle.result;
      switch (res.kind) {
        case 'hosting':
          // We claimed a waiter and host the fresh match — the standard
          // hosted-lobby subscription takes over from here.
          setView({ kind: 'hosted', code: res.code, status: 'waiting' });
          break;
        case 'joined':
          onMatchReadyRef.current(res.match);
          setView({ kind: 'home' });
          break;
        case 'timeout':
          setView({ kind: 'qm-empty' });
          break;
        case 'cancelled':
          setView({ kind: 'home' });
          break;
        case 'unavailable':
          setError('Quick match is not available right now. Try a friend code below.');
          setView({ kind: 'home' });
          break;
      }
    } catch (err) {
      console.error('[lobby] quick match failed', err);
      setError('Quick match failed. Try again or use a friend code.');
      setView({ kind: 'home' });
    } finally {
      qmHandleRef.current = null;
      setBusy(false);
    }
  }

  // Subscribe to the hosted match doc while waiting. When the guest joins
  // (status flips to active) we hand off to the parent.
  useEffect(() => {
    if (view.kind !== 'hosted') return;
    const unsub = subscribeMatch(view.code, (doc) => {
      if (!doc) return;
      if (doc.status === 'active') {
        setView((v) =>
          v.kind === 'hosted' ? { ...v, status: 'active' } : v,
        );
        onMatchReadyRef.current(doc);
      }
    });
    return unsub;
  }, [view.kind === 'hosted' ? view.code : null]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate() {
    if (!signedIn || busy) return;
    setBusy(true);
    setError(null);
    try {
      const code = await createMatch(
        { uid: uid!, displayName: displayName! },
        createMode,
        // Timed roulette doesn't fit the multi-action turn model yet.
        createMode === 'classic' ? timeControl.sec : null,
        createMode === 'classic' ? timeControl.inc : null,
      );
      setView({ kind: 'hosted', code, status: 'waiting' });
    } catch (err) {
      console.error('[lobby] createMatch failed', err);
      setError('Could not create a match. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    if (!signedIn || busy) return;
    const code = normalizeMatchCode(joinCodeInput);
    if (code.length === 0) {
      setError('Enter a match code first.');
      return;
    }
    setBusy(true);
    setError(null);
    setView({ kind: 'joining' });
    try {
      const match = await joinMatch(code, {
        uid: uid!,
        displayName: displayName!,
      });
      onMatchReadyRef.current(match);
      setView({ kind: 'home' });
      setJoinCodeInput('');
    } catch (err) {
      console.error('[lobby] joinMatch failed', err);
      const msg = err instanceof Error ? err.message : 'JOIN_FAILED';
      if (msg === 'MATCH_NOT_FOUND') {
        setError('No match with that code.');
      } else if (msg === 'MATCH_NOT_AVAILABLE') {
        setError('That match is already full or finished.');
      } else if (msg === 'CANNOT_JOIN_OWN_MATCH') {
        setError("You can't join your own match.");
      } else {
        setError('Could not join. Check the code and try again.');
      }
      setView({ kind: 'home' });
    } finally {
      setBusy(false);
    }
  }

  function handleCopy() {
    if (view.kind !== 'hosted') return;
    navigator.clipboard.writeText(view.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="friend-lobby">
      <div className="friend-lobby-header">
        <button
          type="button"
          className="friend-lobby-back"
          onClick={onBack}
          disabled={busy}
        >
          <Icon icon={ArrowLeft} size="sm" aria-hidden /> Back
        </button>
        <h2 className="friend-lobby-title">
          {/* V1 — this screen is quick match + private codes, not just
              friends; the tab that opens it is now labelled "Online". */}
          <Icon icon={Users} size="lg" aria-hidden /> Play online
        </h2>
        <span className="friend-lobby-spacer" />
      </div>

      {!signedIn && (
        <div className="friend-lobby-warning">
          Sign in (pick a display name) before creating or joining a match.
        </div>
      )}

      {view.kind === 'home' && (
        <>
          <section className="friend-lobby-card quick-match-card">
            <h3>
              <Icon icon={Zap} size="sm" aria-hidden /> Quick match
            </h3>
            <p className="friend-lobby-hint">
              Pair up with whoever is searching right now. Classic mode,
              no clock.
              {onlineCount !== null && (
                <span className="quick-match-online">
                  {' '}Online now: <strong>{onlineCount}</strong>
                </span>
              )}
            </p>
            <button
              type="button"
              className="friend-lobby-primary-btn"
              onClick={handleQuickMatch}
              disabled={!signedIn || busy}
            >
              Find an opponent
            </button>
          </section>

          <section className="friend-lobby-card">
            <h3>Create a match</h3>
            <p className="friend-lobby-hint">
              Shareable 6-character code. Random Chess960 position. Random
              side assignment.
            </p>
            <div
              className="friend-lobby-mode-row"
              role="radiogroup"
              aria-label="Game mode"
            >
              <label
                className={`friend-lobby-mode${createMode === 'classic' ? ' is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="lobby-mode"
                  value="classic"
                  checked={createMode === 'classic'}
                  onChange={() => setCreateMode('classic')}
                  disabled={busy}
                />
                <span className="friend-lobby-mode-title">Classic</span>
                <span className="friend-lobby-mode-sub">
                  Full Chess960. Rotate allowed.
                </span>
              </label>
              <label
                className={`friend-lobby-mode${createMode === 'roulette' ? ' is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="lobby-mode"
                  value="roulette"
                  checked={createMode === 'roulette'}
                  onChange={() => setCreateMode('roulette')}
                  disabled={busy}
                />
                <span className="friend-lobby-mode-title">
                  <Icon icon={Dices} size="sm" aria-hidden /> Roulette
                </span>
                <span className="friend-lobby-mode-sub">
                  Spin a 4-slot bag. 2 actions per turn: move or rotate.
                </span>
              </label>
            </div>
            {/* R13 — time-control presets (classic only; roulette's
                multi-action turns don't fit the alternating clock). */}
            {createMode === 'classic' && (
              <div className="friend-lobby-tc-row" role="radiogroup" aria-label="Time control">
                {TIME_CONTROLS.map((tc) => (
                  <button
                    key={tc.label}
                    type="button"
                    role="radio"
                    aria-checked={timeControl === tc}
                    className={`friend-lobby-tc-pill${timeControl === tc ? ' is-selected' : ''}`}
                    onClick={() => setTimeControl(tc)}
                    disabled={busy}
                    title={tc.title}
                  >
                    {tc.label}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="friend-lobby-primary-btn"
              onClick={handleCreate}
              disabled={!signedIn || busy}
            >
              {busy ? 'Creating…' : 'Create new match'}
            </button>
          </section>

          <section className="friend-lobby-card">
            <h3>Or join existing</h3>
            <div className="friend-lobby-join-row">
              <input
                type="text"
                className="friend-lobby-code-input"
                placeholder="Code"
                value={joinCodeInput}
                // No maxLength: it would cut "PXR QRC" to "PXR QR" before the
                // spaces are stripped. Normalise here and cap the clean code.
                onChange={(e) =>
                  setJoinCodeInput(normalizeMatchCode(e.target.value).slice(0, 6))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleJoin();
                }}
                spellCheck={false}
                autoCapitalize="characters"
                aria-label="Match code"
                disabled={!signedIn || busy}
              />
              <button
                type="button"
                className="friend-lobby-secondary-btn"
                onClick={handleJoin}
                disabled={!signedIn || busy}
              >
                Join
              </button>
            </div>
          </section>

          {error && <div className="friend-lobby-error">{error}</div>}
        </>
      )}

      {view.kind === 'hosted' && (
        <section className="friend-lobby-card friend-lobby-hosted">
          <h3>Share this code with your friend</h3>
          <div className="friend-lobby-code-display">
            <span className="friend-lobby-code-text">{view.code}</span>
            <button
              type="button"
              className="friend-lobby-secondary-btn"
              onClick={handleCopy}
            >
              {copied ? 'Copied!' : 'Copy code'}
            </button>
          </div>
          {view.status === 'waiting' ? (
            <p className="friend-lobby-status">
              <span className="friend-lobby-spinner" aria-hidden />
              Waiting for opponent…
            </p>
          ) : (
            <p className="friend-lobby-status friend-lobby-status-ready">
              Opponent joined! Starting…
            </p>
          )}
        </section>
      )}

      {view.kind === 'joining' && (
        <section className="friend-lobby-card">
          <p className="friend-lobby-status">
            <span className="friend-lobby-spinner" aria-hidden />
            Joining match…
          </p>
        </section>
      )}

      {view.kind === 'searching' && (
        <section className="friend-lobby-card">
          <p className="friend-lobby-status">
            <span className="friend-lobby-spinner" aria-hidden />
            Looking for an opponent… {searchSecs}s
          </p>
          <p className="friend-lobby-hint">
            {onlineCount !== null && onlineCount > 1
              ? `${onlineCount} players online right now.`
              : 'Hang tight — the search window is about 30 seconds.'}
          </p>
          <button
            type="button"
            className="friend-lobby-secondary-btn"
            onClick={() => qmHandleRef.current?.cancel()}
          >
            Cancel search
          </button>
        </section>
      )}

      {view.kind === 'qm-empty' && (
        <section className="friend-lobby-card">
          <h3>Nobody around right now</h3>
          <p className="friend-lobby-hint">
            No one joined the queue in time. Honest options while the arena
            fills up:
          </p>
          <div className="quick-match-fallback-row">
            <button
              type="button"
              className="friend-lobby-primary-btn"
              onClick={onBack}
            >
              Play the bot (same board)
            </button>
            <button
              type="button"
              className="friend-lobby-secondary-btn"
              onClick={() => setView({ kind: 'home' })}
            >
              Invite a friend by code
            </button>
          </div>
          <button
            type="button"
            className="friend-lobby-secondary-btn"
            onClick={handleQuickMatch}
            disabled={busy}
          >
            Search again
          </button>
        </section>
      )}
    </div>
  );
}
