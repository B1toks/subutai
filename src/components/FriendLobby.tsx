import { useEffect, useRef, useState } from 'react';
import {
  createMatch,
  joinMatch,
  normalizeMatchCode,
  subscribeMatch,
  type MatchDoc,
  type MatchGameMode,
} from '../firebase/matches';

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
  | { kind: 'joining' };

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
  // onMatchReady changes identity on every parent render; storing in a ref
  // keeps the subscribe-effect deps minimal.
  const onMatchReadyRef = useRef(onMatchReady);
  onMatchReadyRef.current = onMatchReady;

  const signedIn = uid !== null && displayName !== null;

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
          {'←'} Back
        </button>
        <h2 className="friend-lobby-title">
          {'\u{1F465}'} Play vs Friend{' '}
          <span className="beta-tag">BETA</span>
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
          <section className="friend-lobby-card">
            <h3>Create a match</h3>
            <p className="friend-lobby-hint">
              Shareable 6-character code. Random chess960 position. Random
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
                  Full chess960. Rotate allowed.
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
                  {'\u{1F3B0}'} Roulette
                </span>
                <span className="friend-lobby-mode-sub">
                  Spin a 4-slot bag. 2 actions per turn: move or rotate.
                </span>
              </label>
            </div>
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
                onChange={(e) =>
                  setJoinCodeInput(
                    e.target.value.toUpperCase().slice(0, 6),
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleJoin();
                }}
                maxLength={6}
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
    </div>
  );
}
