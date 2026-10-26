import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** 必须传入，用于 label 关联（C-3） */
  id?: string
  label: string
  error?: string
  hint?: string
  endAdornment?: ReactNode
}

/** 表单输入基元，自带 label 与错误提示（FRONTEND-WORK §3.1 Input） */
export function Input({
  id: idProp,
  label,
  error,
  hint,
  endAdornment,
  className,
  required,
  ...rest
}: InputProps) {
  const autoId = useId()
  const id = idProp ?? autoId
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined

  return (
    <div className="g-field">
      <label className="g-label" htmlFor={id}>
        {label}
        {required && <span className="g-required" aria-hidden="true"> *</span>}
      </label>
      <div className={cn('g-input-wrap', error && 'g-input-wrap-error')}>
        <input
          id={id}
          className={cn('g-input', className)}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
        {endAdornment && <span className="g-input-adorn">{endAdornment}</span>}
      </div>
      {error ? (
        <p id={`${id}-error`} className="g-field-msg g-field-msg-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="g-field-msg">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
