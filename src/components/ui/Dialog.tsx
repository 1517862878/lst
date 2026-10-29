import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string | undefined
  /** 底部操作区（确认/取消按钮） */
  footer?: ReactNode
  children: ReactNode
  className?: string
}

/** 对话框基元：Radix Dialog 封装，焦点陷阱 + Esc 关闭（FRONTEND-WORK §3.1 Dialog） */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  className,
}: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="g-dialog-overlay" />
        <DialogPrimitive.Content className={cn('g-dialog', className)}>
          <div className="g-dialog-header">
            <DialogPrimitive.Title className="g-dialog-title">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="g-dialog-desc">
                {description}
              </DialogPrimitive.Description>
            ) : (
              // Radix 要求有 Description，否则告警；无描述时放一个隐藏占位
              <VisuallyHidden.Root>
                <DialogPrimitive.Description>{title}</DialogPrimitive.Description>
              </VisuallyHidden.Root>
            )}
            <DialogPrimitive.Close className="g-dialog-close" aria-label="关闭对话框">
              <X aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <div className="g-dialog-body">{children}</div>
          {footer && <div className="g-dialog-footer">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export const DialogClose = DialogPrimitive.Close
