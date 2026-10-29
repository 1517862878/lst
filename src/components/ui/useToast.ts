import { createContext, useContext } from 'react'

export type ToastVariant = 'info' | 'success' | 'error'

/** 可选的行内操作（8.2：403 限制提示带「去申诉」入口） */
export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  action?: ToastAction
}

export interface ToastItem {
  id: string
  variant: ToastVariant
  message: string
  action?: ToastAction
}

export interface ToastContextValue {
  show: (variant: ToastVariant, message: string, options?: ToastOptions) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 必须在 <ToastProvider> 内使用')
  return ctx
}
