/**
 * 通知中心 /notifications（S8）。
 *
 * 进页面即标记已读，但**列表本身不重取**：未读样式要留在屏幕上，用户才看得清
 * 这次进来之前哪几条是新的（见 useMarkNotificationsRead 的注释）。
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { BellOff, BellRing } from 'lucide-react'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireAuth } from '@/components/layout/guards'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import type { AppNotification } from '@/domain/types'
import { useNotifications, useMarkNotificationsRead } from '@/hooks/useSocial'
import { accountImageUrl } from '@/lib/account'
import { relativeTime } from '@/lib/time'

const KIND_TAG: Record<AppNotification['kind'], string> = {
  like: '点赞',
  comment: '评论',
  follow: '关注',
  system: '系统',
}

interface NotificationCopy {
  text: ReactNode
  to?: string
  actionLabel?: string
}

function actorNameOf(notification: AppNotification): string {
  return notification.actor?.displayName || notification.actor?.username || '有人'
}

function describe(notification: AppNotification): NotificationCopy {
  const actor = <strong>{actorNameOf(notification)}</strong>
  switch (notification.kind) {
    case 'like':
      return {
        text: <>{actor} 赞了你的作品</>,
        ...(notification.photoId ? { to: `/works/${notification.photoId}`, actionLabel: '查看作品' } : {}),
      }
    case 'comment':
      return {
        text: <>{actor} 评论了你的作品</>,
        ...(notification.photoId ? { to: `/works/${notification.photoId}`, actionLabel: '查看评论' } : {}),
      }
    case 'follow':
      return {
        text: <>{actor} 关注了你</>,
        ...(notification.actor ? { to: `/u/${notification.actor.username}`, actionLabel: '查看主页' } : {}),
      }
    case 'system':
      // 系统通知没有 actor，也没有跳转目标；文案里不要再拼一个「有人」
      return { text: '系统通知' }
  }
}

export function NotificationsPage() {
  return (
    <RequireAuth>
      <NotificationsInner />
    </RequireAuth>
  )
}

function NotificationsInner() {
  const query = useNotifications(true)
  const { mutate: markAllRead } = useMarkNotificationsRead()

  // 只在「第一页数据到手」后标记一次：ref 挡住重复触发（StrictMode 下 effect 会跑两遍）
  const markedRef = useRef(false)

  const items = useMemo(() => {
    const flat = query.data?.pages.flatMap((page) => page.items) ?? []
    return flat.filter((item, index) => flat.findIndex((other) => other.id === item.id) === index)
  }, [query.data])

  useEffect(() => {
    if (markedRef.current || !query.data) return
    markedRef.current = true
    if (items.some((item) => !item.readAt)) markAllRead(undefined)
  }, [items, markAllRead, query.data])

  return (
    <Container size="md">
      <PageHeader
        title="通知"
        description="点赞、评论、关注与系统消息都会出现在这里。"
        breadcrumbs={[{ label: '首页', to: '/' }, { label: '通知' }]}
      />

      {query.isLoading ? (
        <ul className="g-notification-list" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index} className="g-notification-item">
              <Skeleton variant="circle" width={48} height={48} />
              <div className="g-notification-body">
                <Skeleton variant="text" width={220} />
                <Skeleton variant="text" width={80} />
              </div>
            </li>
          ))}
        </ul>
      ) : query.isError ? (
        <ErrorState title="通知加载失败" error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="还没有通知"
          description="有人点赞、评论或关注你时，这里会第一时间告诉你。"
          actions={[{ label: '去作品墙逛逛', to: '/gallery' }]}
        />
      ) : (
        <>
          <ul className="g-notification-list">
            {items.map((notification) => {
              const copy = describe(notification)
              const unread = !notification.readAt
              return (
                <li
                  key={notification.id}
                  className={unread ? 'g-notification-item g-notification-item-unread' : 'g-notification-item'}
                >
                  {notification.actor ? (
                    <Link to={`/u/${notification.actor.username}`} aria-label={`查看 ${actorNameOf(notification)} 的主页`}>
                      <Avatar
                        src={accountImageUrl(notification.actor.avatarKey)}
                        name={actorNameOf(notification)}
                        size={48}
                      />
                    </Link>
                  ) : (
                    // 系统通知没有 actor：给一个铃铛占位，不用 Avatar 的首字母兜底
                    // （那会渲染出一个「系」字头像，看着像个用户）
                    <span className="g-notification-system-icon" aria-hidden="true">
                      <BellRing />
                    </span>
                  )}
                  <div className="g-notification-body">
                    <p className="g-notification-text">{copy.text}</p>
                    <div className="g-notification-meta">
                      <span className="g-notification-tag">{KIND_TAG[notification.kind]}</span>
                      <time dateTime={notification.createdAt}>{relativeTime(notification.createdAt)}</time>
                      {/* 未读同时用文字标注：只靠左侧色条的话，色觉障碍用户拿不到这个信息 */}
                      {unread && <span>未读</span>}
                    </div>
                    {copy.to && (
                      <div className="g-notification-actions">
                        <Link className="g-btn g-btn-secondary g-btn-sm" to={copy.to}>
                          {copy.actionLabel ?? '查看'}
                        </Link>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {query.hasNextPage && (
            <div className="g-follow-panel-foot">
              <Button
                variant="secondary"
                size="sm"
                loading={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                加载更早的通知
              </Button>
            </div>
          )}
        </>
      )}
    </Container>
  )
}
