import { Handshake } from 'lucide-react';
import { Icon } from '../../components/Icon';

/** A draw offer as the player it is made to sees it: in place of that
 *  player's own row, so the board does not move when it appears. */
export function DrawOfferPrompt({
  text,
  onAnswer,
  disabled = false,
}: {
  text: string;
  onAnswer: (accept: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="draw-offer-prompt" role="group" aria-label="Draw offer">
      <Icon icon={Handshake} size="md" aria-hidden />
      <span className="draw-offer-text" role="status">{text}</span>
      <button
        type="button"
        className="mp-btn mp-btn-primary"
        onClick={() => onAnswer(true)}
        disabled={disabled}
      >
        Accept
      </button>
      <button
        type="button"
        className="mp-btn mp-btn-secondary"
        onClick={() => onAnswer(false)}
        disabled={disabled}
      >
        Decline
      </button>
    </div>
  );
}
