import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Frown, Heart, Meh, Smile, Sparkles } from 'lucide-react';
import { Icon } from './Icon';
import {
  hasAnyContent,
  submitFeedback,
  type FeedbackRating,
} from '../firebase/feedback';

interface FeedbackModalProps {
  playerId: string;
  playerName: string;
  onClose: () => void;
}

const RATINGS: Array<{ value: FeedbackRating; icon: LucideIcon; label: string }> = [
  { value: 'love', icon: Heart, label: 'love' },
  { value: 'good', icon: Smile, label: 'good' },
  { value: 'meh', icon: Meh, label: 'meh' },
  { value: 'bad', icon: Frown, label: 'bad' },
];

export function FeedbackModal({ playerId, playerName, onClose }: FeedbackModalProps) {
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [liked, setLiked] = useState('');
  const [disliked, setDisliked] = useState('');
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

  // Escape closes the modal — but only when we're not in the middle of a write
  // or showing the thanks state. Both states resolve themselves shortly.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting && !submitted) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting, submitted]);

  const canSubmit =
    !submitting &&
    !submitted &&
    hasAnyContent({
      rating: rating ?? undefined,
      liked,
      disliked,
      comment,
    });

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitFeedback({
        type: 'general',
        playerId,
        playerName,
        rating: rating ?? undefined,
        liked: liked.trim() || undefined,
        disliked: disliked.trim() || undefined,
        comment: comment.trim() || undefined,
      });
      if (!mountedRef.current) return;
      setSubmitted(true);
      setTimeout(() => {
        if (!mountedRef.current) return;
        onClose();
      }, 2000);
    } catch (err) {
      console.error('[FeedbackModal] submit failed', err);
      if (!mountedRef.current) return;
      setError('Could not send feedback. Check your connection and retry.');
      setSubmitting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!submitting && !submitted) onClose();
      }}
    >
      <div
        className="modal-dialog feedback-modal-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title">Share your feedback</h2>
        <p className="modal-subtitle">
          All fields optional. Your feedback is private — only the developer can read it.
        </p>

        {submitted ? (
          <div className="feedback-thanks feedback-thanks-large">
            Thanks! <Icon icon={Sparkles} size="md" aria-hidden />
          </div>
        ) : (
          <>
            <div className="feedback-field">
              <label className="feedback-label">How are you finding Subutai?</label>
              <div className="feedback-smileys">
                {RATINGS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    className={`feedback-smiley${rating === r.value ? ' is-selected' : ''}`}
                    onClick={() =>
                      setRating((cur) => (cur === r.value ? null : r.value))
                    }
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
            </div>

            <div className="feedback-field">
              <label className="feedback-label" htmlFor="fb-liked">
                What do you like?
              </label>
              <textarea
                id="fb-liked"
                className="feedback-textarea"
                value={liked}
                maxLength={1000}
                rows={2}
                disabled={submitting}
                onChange={(e) => setLiked(e.target.value)}
              />
            </div>

            <div className="feedback-field">
              <label className="feedback-label" htmlFor="fb-disliked">
                What could be better?
              </label>
              <textarea
                id="fb-disliked"
                className="feedback-textarea"
                value={disliked}
                maxLength={1000}
                rows={2}
                disabled={submitting}
                onChange={(e) => setDisliked(e.target.value)}
              />
            </div>

            <div className="feedback-field">
              <label className="feedback-label" htmlFor="fb-comment">
                Anything else?
              </label>
              <textarea
                id="fb-comment"
                className="feedback-textarea"
                value={comment}
                maxLength={1000}
                rows={2}
                disabled={submitting}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>

            {error && <div className="modal-error">{error}</div>}

            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn modal-btn-secondary"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-btn modal-btn-primary"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {submitting ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
