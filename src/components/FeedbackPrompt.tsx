import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Frown, Heart, Meh, Smile, Sparkles } from 'lucide-react';
import { Icon } from './Icon';
import {
  hasAnyContent,
  submitFeedback,
  type FeedbackGameContext,
  type FeedbackRating,
} from '../firebase/feedback';

interface FeedbackPromptProps {
  playerId: string;
  playerName: string;
  /** null when the underlying /games save failed — we still collect the
   *  signal, just without binding it to a specific game document. */
  gameId: string | null;
  gameContext: FeedbackGameContext;
  onSubmitted?: () => void;
}

const RATINGS: Array<{ value: FeedbackRating; icon: LucideIcon; label: string }> = [
  { value: 'love', icon: Heart, label: 'love' },
  { value: 'good', icon: Smile, label: 'good' },
  { value: 'meh', icon: Meh, label: 'meh' },
  { value: 'bad', icon: Frown, label: 'bad' },
];

export function FeedbackPrompt({
  playerId,
  playerName,
  gameId,
  gameContext,
  onSubmitted,
}: FeedbackPromptProps) {
  const [visible, setVisible] = useState(true);
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (!visible) return null;

  const canSubmit =
    !submitting &&
    !submitted &&
    hasAnyContent({ rating: rating ?? undefined, comment });

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitFeedback({
        type: 'game',
        playerId,
        playerName,
        rating: rating ?? undefined,
        comment: comment.trim() || undefined,
        gameId: gameId ?? undefined,
        gameContext,
      });
      if (!mountedRef.current) return;
      setSubmitted(true);
      // Hide the block after the thank-you fades.
      setTimeout(() => {
        if (!mountedRef.current) return;
        setVisible(false);
        onSubmitted?.();
      }, 2000);
    } catch (err) {
      console.error('[FeedbackPrompt] submit failed', err);
      if (!mountedRef.current) return;
      setError('Could not send feedback. Please retry.');
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="feedback-thanks">
        Thanks! <Icon icon={Sparkles} size="sm" aria-hidden />
      </div>
    );
  }

  return (
    <div className="feedback-prompt">
      <div className="feedback-title">How was this game?</div>

      <div className="feedback-smileys">
        {RATINGS.map((r) => (
          <button
            key={r.value}
            type="button"
            className={`feedback-smiley${rating === r.value ? ' is-selected' : ''}`}
            onClick={() => setRating((cur) => (cur === r.value ? null : r.value))}
            disabled={submitting}
            aria-pressed={rating === r.value}
            title={r.label}
          >
            <span className="feedback-smiley-glyph">
              <Icon icon={r.icon} size="lg" strokeWidth={1.75} aria-hidden />
            </span>
            <span className="feedback-smiley-label">{r.label}</span>
          </button>
        ))}
      </div>

      <div className={`feedback-comment-wrap${rating ? ' is-open' : ''}`}>
        <textarea
          className="feedback-textarea"
          placeholder="Tell us more (optional)"
          value={comment}
          maxLength={1000}
          rows={3}
          onChange={(e) => setComment(e.target.value)}
          disabled={submitting}
        />
      </div>

      {error && <div className="modal-error feedback-error">{error}</div>}

      <div className="feedback-actions">
        <button
          type="button"
          className="modal-btn modal-btn-primary"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {submitting ? 'Sending…' : 'Send feedback'}
        </button>
        <button
          type="button"
          className="feedback-skip-link"
          onClick={() => setVisible(false)}
          disabled={submitting}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
