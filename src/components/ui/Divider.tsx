import { cn } from '@/lib/cn'

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical'
  label?: string
  className?: string
}

/** 分隔线基元（FRONTEND-WORK §3.1 Divider） */
export function Divider({ orientation = 'horizontal', label, className }: DividerProps) {
  if (label) {
    return (
      <div className={cn('g-divider-with-label', className)} role="separator">
        <span className="g-divider-line" aria-hidden="true" />
        <span className="g-divider-label">{label}</span>
        <span className="g-divider-line" aria-hidden="true" />
      </div>
    )
  }
  return (
    <hr className={cn('g-divider', orientation === 'vertical' && 'g-divider-v', className)} />
  )
}
