import { useEffect, useMemo, useRef, useState } from 'react';
import {
  changeDisplayName,
  claimDisplayName,
  isDisplayNameAvailable,
  isValidDisplayName,
  normalizeDisplayName,
} from '../firebase/auth';

type Mode = 'initial' | 'change';

interface NamePickerProps {
  mode: Mode;
  uid: string;
  currentName?: string;
  onComplete: (newName: string) => void;
  onCancel?: () => void;
}

type LocalStatus =
  | { kind: 'idle' }
  | { kind: 'tooShort' }
  | { kind: 'tooLong' }
  | { kind: 'invalidChars' }
  | { kind: 'unchanged' };

type RemoteStatus =
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken' };

type Status = LocalStatus | RemoteStatus;

const CHECK_DEBOUNCE_MS = 400;

function computeLocalStatus(name: string, currentName: string, mode: Mode): LocalStatus | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { kind: 'idle' };
  if (trimmed.length < 3) return { kind: 'tooShort' };
  if (trimmed.length > 20) return { kind: 'tooLong' };
  if (!isValidDisplayName(trimmed)) return { kind: 'invalidChars' };
  if (mode === 'change' && normalizeDisplayName(name) === normalizeDisplayName(currentName)) {
    return { kind: 'unchanged' };
  }
  return null;
}

export function NamePicker({
  mode,
  uid,
  currentName = '',
  onComplete,
  onCancel,
}: NamePickerProps) {
  const [value, setValue] = useState(currentName);
  const [remoteResult, setRemoteResult] = useState<
    { slug: string; status: RemoteStatus } | null
  >(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastQueryRef = useRef<string>('');

  const localStatus = useMemo(
    () => computeLocalStatus(value, currentName, mode),
    [value, currentName, mode],
  );
  const currentSlug = normalizeDisplayName(value);
  const remoteStatus =
    remoteResult && remoteResult.slug === currentSlug ? remoteResult.status : null;
  const status: Status = localStatus ?? remoteStatus ?? { kind: 'checking' };

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    // Local validation fully covers this value — no network call needed.
    // The render path already ignores stale remoteStatus by falling back to
    // localStatus, so we don't clear it here.
    if (localStatus) {
      lastQueryRef.current = '';
      return;
    }

    const trimmedSlug = normalizeDisplayName(value);
    lastQueryRef.current = trimmedSlug;

    const handle = setTimeout(async () => {
      try {
        const available = await isDisplayNameAvailable(value);
        if (lastQueryRef.current !== trimmedSlug) return;
        setRemoteResult({
          slug: trimmedSlug,
          status: available ? { kind: 'available' } : { kind: 'taken' },
        });
      } catch (err) {
        console.error('[NamePicker] availability check failed', err);
        if (lastQueryRef.current !== trimmedSlug) return;
        setRemoteResult(null);
      }
    }, CHECK_DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [value, localStatus]);

  const canSubmit = status.kind === 'available' && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'initial') {
        await claimDisplayName(uid, value);
      } else {
        await changeDisplayName(uid, currentName, value);
      }
      onComplete(value.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'UNKNOWN';
      if (msg === 'DISPLAY_NAME_TAKEN') {
        setRemoteResult({ slug: currentSlug, status: { kind: 'taken' } });
        setError('Someone just grabbed that name — try another.');
      } else {
        setError('Could not save name. Check your connection and retry.');
      }
      setSubmitting(false);
    }
  }

  function statusLabel(): { text: string; tone: 'ok' | 'warn' | 'neutral' } {
    switch (status.kind) {
      case 'idle':
        return { text: '3–20 chars: letters, numbers, space, - or _', tone: 'neutral' };
      case 'tooShort':
        return { text: 'Too short — at least 3 characters', tone: 'warn' };
      case 'tooLong':
        return { text: 'Too long — max 20 characters', tone: 'warn' };
      case 'invalidChars':
        return { text: 'Invalid characters', tone: 'warn' };
      case 'checking':
        return { text: 'Checking…', tone: 'neutral' };
      case 'available':
        return { text: 'Available', tone: 'ok' };
      case 'taken':
        return { text: 'Taken', tone: 'warn' };
      case 'unchanged':
        return { text: 'Same as current name', tone: 'neutral' };
    }
  }

  const label = statusLabel();
  const closable = mode === 'change';

  return (
    <div
      className="modal-backdrop"
      onClick={closable ? onCancel : undefined}
    >
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">
          {mode === 'initial' ? 'Choose your name' : 'Change name'}
        </h2>
        {mode === 'initial' ? (
          <p className="namepicker-tagline">
            Subutai is a chess variant where the board rotates. Your goal:{' '}
            <strong>survive 50 moves</strong> against the AI.
            <br />
            Pick a name to start.
          </p>
        ) : (
          <p className="modal-subtitle">
            Pick a new display name. It has to be unique.
          </p>
        )}

        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            className="modal-input"
            placeholder="e.g. Subutai"
            value={value}
            maxLength={20}
            disabled={submitting}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />

          <div className={`modal-status modal-status-${label.tone}`}>
            {label.text}
          </div>

          {error && <div className="modal-error">{error}</div>}

          <div className="modal-actions">
            {closable && (
              <button
                type="button"
                className="modal-btn modal-btn-secondary"
                onClick={onCancel}
                disabled={submitting}
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="modal-btn modal-btn-primary"
              disabled={!canSubmit}
            >
              {submitting ? 'Saving…' : mode === 'initial' ? 'Continue' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
