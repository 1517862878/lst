import { useId, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  id?: string
  label: string
  error?: string
  hint?: string
  /** 显示字数统计（0/500） */
  showCount?: boolean
}

/** 多行文本基元（FRONTEND-WORK §3.1 Textarea） */
export function Textarea({
  id: idProp,
  label,
  error,
  hint,
  showCount,
  className,
  maxLength,
  value,
  required,
  ...rest
}: TextareaProps) {
  const autoId = useId()
  const id = idProp ?? autoId
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined

  return (
    <div className="g-field">
      <label className="g-label" htmlFor={id}>
        {label}
        {required && <span className="g-required" aria-hidden="true"> *</span>}
      </label>
      <textarea
        id={id}
        className={cn('g-input g-textarea', error && 'g-input-error', className)}
        maxLength={maxLength}
        value={value}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      <div className="g-field-foot">
        {error ? (
          <p id={`${id}-error`} className="g-field-msg g-field-msg-error" role="alert">
            {error}
          </p>
        ) : hint ? (
          <p id={`${id}-hint`} className="g-field-msg">
            {hint}
          </p>
        ) : (
          <span />
        )}
        {showCount && maxLength ? (
          <span className="g-count">
            {typeof value === 'string' ? value.length : 0}/{maxLength}
          </span>
        ) : null}
      </div>
    </div>
  )
}
