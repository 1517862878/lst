import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'
import { cn } from '@/lib/cn'

export interface ErrorStateProps {
  title?: string
  /** 错误对象；展示给用户的信息不含堆栈（FRONTEND-WORK §6.6） */
  error?: unknown
  onRetry?: () => void
  /** 错误 ID（时间戳+随机串），便于日志对照，不向用户展示堆栈 */
  errorId?: string
  className?: string
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '发生未知错误'
}

/** 错误态统一组件：不含堆栈 + 重试按钮（FRONTEND-WORK §3.1 ErrorState） */
export function ErrorState({
  title = '加载失败',
  error,
  onRetry,
  errorId,
  className,
}: ErrorStateProps) {
  return (
    <div className={cn('g-error-state', className)} role="alert">
      <AlertTriangle className="g-error-icon" aria-hidden="true" />
      <h3 className="g-error-title">{title}</h3>
      <p className="g-error-desc">{messageOf(error)}</p>
      {errorId && <p className="g-error-id">错误编号：{errorId}</p>}
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  )
}
