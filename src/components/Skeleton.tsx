import type { CSSProperties } from 'react';

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  rounded?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Sprint 3.4 — async-fetch placeholder. Renders a shimmering rectangle
 * sized to the supplied width/height; pass `rounded` for full pill
 * radius. Inherits theme colours via --bg-mid / --bg-elevated.
 */
export function Skeleton({
  width,
  height,
  rounded,
  className,
  style,
}: SkeletonProps) {
  const cls = ['skeleton', rounded ? 'is-rounded' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={cls}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        ...style,
      }}
      aria-hidden
    />
  );
}
