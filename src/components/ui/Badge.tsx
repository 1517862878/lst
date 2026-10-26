import { cn } from '@/lib/cn'

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'
export type BadgeSize = 'sm' | 'md'

export interface BadgeProps {
  tone?: BadgeTone
  size?: BadgeSize
  className?: string
  children: React.ReactNode
}

const toneClass: Record<BadgeTone, string> = {
  neutral: 'g-badge-neutral',
  info: 'g-badge-info',
  success: 'g-badge-success',
  warning: 'g-badge-warning',
  danger: 'g-badge-danger',
}

/** 徽标基元：分类/难度/许可/状态（FRONTEND-WORK §3.1 Badge；不只靠颜色区分，内含文字） */
export function Badge({ tone = 'neutral', size = 'md', className, children }: BadgeProps) {
  return (
    <span className={cn('g-badge', toneClass[tone], size === 'sm' && 'g-badge-sm', className)}>
      {children}
    </span>
  )
}
