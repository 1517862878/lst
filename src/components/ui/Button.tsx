import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** 加载中：禁用点击并显示 spinner（内部用 aria-busy 标记） */
  loading?: boolean
  icon?: ReactNode
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'g-btn-primary',
  secondary: 'g-btn-secondary',
  ghost: 'g-btn-ghost',
  danger: 'g-btn-danger',
}

const sizeClass: Record<ButtonSize, string> = {
  sm: 'g-btn-sm',
  md: 'g-btn-md',
  lg: 'g-btn-lg',
}

/** 全站按钮基元（FRONTEND-WORK §3.1 Button） */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn('g-btn', variantClass[variant], sizeClass[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="g-spinner" aria-hidden="true" />
      ) : (
        icon && <span className="g-btn-icon">{icon}</span>
      )}
      {children}
    </button>
  )
}
