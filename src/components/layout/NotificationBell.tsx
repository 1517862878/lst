/**
 * 页头通知铃铛（S8）。
 *
 * 用 <Link> 而不是 <button onClick={navigate}>：中键新开、复制链接、读屏「链接」语义
 * 都能正常工作，也少一个 JS 导航分支。
 *
 * 「点击进入 /notifications 并标记已读」里的「标记已读」落在通知页上（见
 * src/pages/NotificationsPage.tsx）：标记要在**列表真的显示出来之后**发生，
 * 否则用户点进来看到的全是已读样式，根本分不清哪几条是新的。
 * 这里只做一件事——点击时把角标先清掉，红点不会一直挂在那儿等接口往返。
 */
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { useUnreadCount } from '@/hooks/useSocial'
import { queryKeys } from '@/hooks/queryKeys'

export interface NotificationBellProps {
  /** 有会话时才查未读数：游客请求只会拿到 401，白刷一次错误 */
  enabled: boolean
}

export function NotificationBell({ enabled }: NotificationBellProps) {
  const queryClient = useQueryClient()
  const unread = useUnreadCount(enabled)
  const count = enabled ? (unread.data ?? 0) : 0
  const label = count > 0 ? `通知，${count} 条未读` : '通知'

  return (
    <Link
      to="/notifications"
      className="g-header-bell"
      aria-label={label}
      title={label}
      onClick={() => {
        if (count > 0) queryClient.setQueryData(queryKeys.unreadCount(), 0)
      }}
    >
      <Bell aria-hidden="true" />
      {/* 数字角标对读屏隐藏：条数已经在 aria-label 里了，否则会被念两遍 */}
      {count > 0 && (
        <span className="g-header-bell-badge" aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}
