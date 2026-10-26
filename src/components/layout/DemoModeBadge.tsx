import { cn } from '@/lib/cn'

export interface DemoModeBadgeProps {
  variant?: 'footer' | 'card'
  reason?: string
  className?: string
}

/** 演示模式角标（ROADMAP 5.5 第 3 条：示例作品卡片右上角"示例"角标） */
export function DemoModeBadge({ variant = 'card', reason, className }: DemoModeBadgeProps) {
  return (
    <span
      className={cn('g-demo-badge', variant === 'footer' && 'g-demo-badge-footer', className)}
      title={reason}
    >
      示例
    </span>
  )
}
