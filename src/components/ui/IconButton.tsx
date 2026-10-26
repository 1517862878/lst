import type { ButtonHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon
  /** 必填：用作 aria-label（C-2：图标按钮均有 aria-label） */
  label: string
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

/** 图标按钮基元（FRONTEND-WORK §3.1 IconButton，label 必填） */
export function IconButton({
  icon: Icon,
  label,
  size = 'md',
  loading = false,
  className,
  disabled,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn('g-icon-btn', `g-icon-btn-${size}`, className)}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="g-spinner" aria-hidden="true" /> : <Icon aria-hidden="true" />}
    </button>
  )
}
