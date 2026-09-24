import { useCallback, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  text: string;
  side?: TooltipSide;
  /** Set to true when the wrapped control is disabled / hidden so the
   *  tooltip never appears (otherwise it'd float over an invisible
   *  trigger after a focus event). */
  disabled?: boolean;
  children: ReactElement;
}

const GAP = 8;

/**
 * Sprint 3.4 — theme-styled tooltip replacing the OS-native title= popup
 * on the highest-visibility icon buttons. Shows on hover AND keyboard
 * focus for a11y.
 *
 * V1 — it renders through a PORTAL now, in fixed coordinates measured
 * from the trigger.
 *
 * It used to be an absolutely-positioned span sitting next to the
 * trigger, which is fine until the trigger lives somewhere that clips.
 * The desktop icon rail is `position: fixed` with `overflow-y: auto` — and
 * a box that scrolls on one axis clips the other — so every rail tooltip,
 * which opens to the RIGHT of the rail and therefore outside its box, was
 * cut off at the rail's edge and looked like it was hiding behind the
 * board. No z-index can fix that; the tooltip has to leave the subtree.
 *
 * Position is measured once per open. These tooltips hang off fixed
 * chrome and vanish on mouse-out, so there is nothing to keep in sync;
 * re-measuring on scroll would cost more than it buys.
 */
export function Tooltip({
  text,
  side = 'top',
  disabled,
  children,
}: TooltipProps) {
  /**
   * Open state and the measured anchor travel together: the rect is read
   * in the event that opens the tooltip, while the trigger is already
   * laid out, rather than in an effect afterwards. One state write, no
   * render with the tooltip mounted but unpositioned, and no setState
   * cascade out of a layout effect.
   */
  const [shown, setShown] = useState<{
    left: number;
    top: number;
    side: TooltipSide;
  } | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);

  const open = useCallback(() => {
    if (disabled) return;
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();

    // The icon rail is a horizontal row in the header on narrow screens and
    // a fixed vertical dock on desktop. "Below the icon" is right in the
    // first case and wrong in the second, where it would land on the next
    // icon down — so a rail tooltip points out of the dock instead. This
    // used to be a CSS override on `.header-controls .tooltip`, which
    // stopped applying the moment the tooltip moved to <body>.
    let s: TooltipSide = side;
    if (s === 'bottom' && window.innerWidth >= 721 && el.closest('.header-controls')) {
      s = 'right';
    }

    switch (s) {
      case 'bottom':
        setShown({ left: r.left + r.width / 2, top: r.bottom + GAP, side: s });
        break;
      case 'left':
        setShown({ left: r.left - GAP, top: r.top + r.height / 2, side: s });
        break;
      case 'right':
        setShown({ left: r.right + GAP, top: r.top + r.height / 2, side: s });
        break;
      default:
        setShown({ left: r.left + r.width / 2, top: r.top - GAP, side: s });
    }
  }, [disabled, side]);

  const close = useCallback(() => setShown(null), []);

  return (
    <span
      ref={triggerRef}
      className="tooltip-trigger"
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
    >
      {children}
      {shown && typeof document !== 'undefined'
        ? createPortal(
            <span
              className={`tooltip tooltip-portal tooltip-${shown.side}`}
              role="tooltip"
              style={{ left: `${shown.left}px`, top: `${shown.top}px` }}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
