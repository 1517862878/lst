/**
 * 举报入口的公共启动逻辑（8.2）。
 *
 * 三个入口都要做同一件事：游客先跳登录（带回跳地址）→ 登录用户打开 ReportDialog。
 * 抽成一个 hook，避免三处各写一遍「if (!session) navigate(...)」——
 * 之前社交入口就是复制粘贴，结果有一处忘了带 next，登录后回不了原页。
 */
import { useCallback, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useSession } from '@/hooks/useSession'
import type { ReportTargetRef } from './ReportDialog'

export interface ReportRequest {
  /** 打开举报对话框；未登录时跳登录页并带上回跳地址 */
  request: (target: ReportTargetRef) => void
  /** 当前举报目标（null = 对话框关闭） */
  target: ReportTargetRef | null
  close: () => void
}

export function useReportRequest(): ReportRequest {
  const { data: session } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [target, setTarget] = useState<ReportTargetRef | null>(null)

  const request = useCallback(
    (next: ReportTargetRef) => {
      if (!session) {
        // 与 RequireAuth 保持同一套 next 参数，登录后回到当前页而不是首页
        const back = encodeURIComponent(location.pathname + location.search)
        navigate(`/login?next=${back}`)
        return
      }
      setTarget(next)
    },
    [session, navigate, location.pathname, location.search],
  )

  const close = useCallback(() => setTarget(null), [])

  return { request, target, close }
}
