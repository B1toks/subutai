import { useState, type ReactElement } from 'react';

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

/**
 * Sprint 3.4 — theme-styled tooltip replacing the OS-native title=
 * popup on the highest-visibility icon buttons. Lightweight — no
 * external lib, no portal, just an absolutely-positioned span next
 * to the trigger. Shows on hover AND keyboard focus for a11y.
 */
export function Tooltip({
  text,
  side = 'top',
  disabled,
  children,
}: TooltipProps) {
  const [open, setOpen] = useState(false);

  const visible = open && !disabled;

  return (
    <span
      className="tooltip-trigger"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {visible && (
        <span className={`tooltip tooltip-${side}`} role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
}
