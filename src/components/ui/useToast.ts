import { createContext, useContext } from 'react'

export type ToastVariant = 'info' | 'success' | 'error'

export interface ToastItem {
  id: string
  variant: ToastVariant
  message: string
}

export interface ToastContextValue {
  show: (variant: ToastVariant, message: string) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 必须在 <ToastProvider> 内使用')
  return ctx
}
