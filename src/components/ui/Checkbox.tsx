import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface CheckboxProps {
  label: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  error?: string
  required?: boolean
  className?: string
}

/** 复选框基元（FRONTEND-WORK §3.1 Checkbox） */
export function Checkbox({
  label,
  checked,
  onCheckedChange,
  error,
  required,
  className,
}: CheckboxProps) {
  const id = useId()
  return (
    <div className={cn('g-checkbox-wrap', className)}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        className="g-checkbox"
      />
      <label htmlFor={id} className="g-checkbox-label">
        {label}
      </label>
      {error && (
        <p className="g-field-msg g-field-msg-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
