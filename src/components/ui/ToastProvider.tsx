import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ToastContext, type ToastItem, type ToastVariant } from './useToast'

const iconOf: Record<ToastVariant, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  error: XCircle,
}

/** Toast 提供者：全局队列，role="status"，自动消失（FRONTEND-WORK §3.1 Toast） */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const show = useCallback((variant: ToastVariant, message: string) => {
    const id = `toast-${++counter.current}`
    setItems((prev) => [...prev, { id, variant, message }])
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id))
    }, 4000)
  }, [])

  const value = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="g-toast-viewport" aria-live="polite">
        {items.map((t) => {
          const Icon = iconOf[t.variant]
          return (
            <div key={t.id} className={cn('g-toast', `g-toast-${t.variant}`)} role="status">
              <Icon className="g-toast-icon" aria-hidden="true" />
              <span>{t.message}</span>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
