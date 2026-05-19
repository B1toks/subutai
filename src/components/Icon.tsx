import type { ComponentProps } from 'react';
import type { LucideIcon } from 'lucide-react';

export type IconSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_MAP: Record<IconSize, number> = {
  sm: 14,
  md: 18,
  lg: 24,
  xl: 36,
};

type IconProps = Omit<ComponentProps<LucideIcon>, 'size' | 'ref'> & {
  icon: LucideIcon;
  size?: IconSize | number;
  strokeWidth?: number;
};

/**
 * Sprint 3.1 — thin wrapper around any lucide-react icon component.
 * Accepts the icon as a prop (not a string) so the consumer's explicit
 * import keeps tree-shaking working. Centralises sizing (sm 14 / md 18
 * / lg 24 / xl 36) and stroke weight defaults; everything else passes
 * through to the underlying Lucide component, which inherits color via
 * currentColor.
 */
export function Icon({
  icon: Component,
  size = 'md',
  strokeWidth = 2,
  ...rest
}: IconProps) {
  const px = typeof size === 'number' ? size : SIZE_MAP[size];
  return <Component size={px} strokeWidth={strokeWidth} {...rest} />;
}
