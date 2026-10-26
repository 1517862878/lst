import { cn } from '@/lib/cn'

export type SkeletonVariant = 'text' | 'circle' | 'rect'

export interface SkeletonProps {
  variant?: SkeletonVariant
  width?: number | string
  height?: number | string
  className?: string
}

/** 骨架屏基元（FRONTEND-WORK §3.1 Skeleton；形状与真实内容一致防 CLS） */
export function Skeleton({ variant = 'text', width, height, className }: SkeletonProps) {
  const style: React.CSSProperties = {}
  if (width !== undefined) style.width = typeof width === 'number' ? `${width}px` : width
  if (height !== undefined) style.height = typeof height === 'number' ? `${height}px` : height

  return (
    <span
      className={cn('g-skeleton', `g-skeleton-${variant}`, className)}
      style={style}
      aria-hidden="true"
    />
  )
}
