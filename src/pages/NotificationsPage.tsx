/**
 * 通知中心 /notifications（S8）。
 *
 * 进页面即标记已读，但**列表本身不重取**：未读样式要留在屏幕上，用户才看得清
 * 这次进来之前哪几条是新的（见 useMarkNotificationsRead 的注释）。
 *
 * 8.3d 三件事：
 *   1. 同一作品上**相邻**的 ≥2 条评论折叠成一行「N 条新评论」，展开即把组内
 *      全部标记已读（部分已读时组头留一个未读点 —— 见 domain/social.ts 的
 *      groupNotifications / bundleReadState）；
 *   2. 文案分三档：回复了你的评论 / 评论了你的作品 / 你的作品《X》入选周榜第 N 名；
 *   3. 顶部「全部 / 互动 / 系统」筛选，选中项写进 URL 的 ?filter=，
 *      刷新与分享都能回到同一个视图。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { BellOff, BellRing, ChevronDown, MessagesSquare } from 'lucide-react'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireAuth } from '@/components/layout/guards'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  groupNotifications,
  isReplyNotification,
  themeSelectionOf,
  weeklyRankOf,
  type BundleReadState,
  type NotificationGroup,
} from '@/domain/social'
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

// ===== 筛选 Tab =====

type NotificationFilter = 'all' | 'interactive' | 'system'

/**
 * 三个筛选项。标签必须与需求逐字一致（「全部 / 互动 / 系统」），
 * value 才是写进 URL 的那个词 —— URL 用英文，界面用中文。
 */
const FILTER_TABS = [
  { value: 'all', label: '全部' },
  { value: 'interactive', label: '互动' },
  { value: 'system', label: '系统' },
] as const satisfies ReadonlyArray<{ value: NotificationFilter; label: string }>

/** URL 里的 ?filter= 只认三个合法值，其它（拼错、旧链接）一律回落到「全部」 */
function parseFilter(raw: string | null): NotificationFilter {
  return raw === 'interactive' || raw === 'system' ? raw : 'all'
}

/** 「互动」= 点赞 / 评论 / 关注；「系统」= 榜单、治理结果等平台消息 */
function matchFilter(notification: AppNotification, filter: NotificationFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'system') return notification.kind === 'system'
  return notification.kind !== 'system'
}

// ===== 单条通知的文案 =====

interface NotificationCopy {
  text: ReactNode
  to?: string
  actionLabel?: string
}

function actorNameOf(notification: AppNotification): string {
  return notification.actor?.displayName || notification.actor?.username || '有人'
}

/**
 * 一条通知该说什么。
 *
 * 三档文案的区别就是「我和这条内容的关系」：
 *   · 回复 → 有人在你说过话的地方接了一句（去作品页看对话）；
 *   · 评论 → 有人评论了我的作品；
 *   · 榜单 → 我的作品上了周榜，标题从通知自带的 photoTitle 取（服务端已按
 *     可见性过滤，拿不到就不带书名号，不猜）。
 *   · 主题精选（8.4d）→ 我的作品入选了某期每周主题，跳转目标是主题详情页
 *     而不是作品页：作者想看的是「入选了哪一期」，作品他自己有。
 */
function describe(notification: AppNotification): NotificationCopy {
  const actor = <strong>{actorNameOf(notification)}</strong>
  const workLink = notification.photoId ? `/works/${notification.photoId}` : null
  switch (notification.kind) {
    case 'like':
      return {
        text: <>{actor} 赞了你的作品</>,
        ...(workLink ? { to: workLink, actionLabel: '查看作品' } : {}),
      }
    case 'comment':
      // 回复与评论是两件事：回复发生在「你的评论」下面，直接说评论了作品会误导
      if (isReplyNotification(notification)) {
        return {
          text: <>{actor} 回复了你的评论</>,
          ...(workLink ? { to: workLink, actionLabel: '查看回复' } : {}),
        }
      }
      return {
        text: <>{actor} 评论了你的作品</>,
        ...(workLink ? { to: workLink, actionLabel: '查看评论' } : {}),
      }
    case 'follow':
      return {
        text: <>{actor} 关注了你</>,
        ...(notification.actor ? { to: `/u/${notification.actor.username}`, actionLabel: '查看主页' } : {}),
      }
    case 'system': {
      const rank = weeklyRankOf(notification)
      if (rank) {
        const title = notification.photoTitle?.trim() ?? ''
        return {
          text: (
            <>
              你的作品{title ? `《${title}》` : ''}入选 {rank.isoWeek} 周榜第 {rank.rank} 名
            </>
          ),
          ...(workLink ? { to: workLink, actionLabel: '查看作品' } : {}),
        }
      }
      // 8.4d：主题精选的通知复用同一份 photoTitle 兜底。拿不到标题时也要说话，
      // 「你的作品」比「系统通知」有用得多 —— 后者等于什么都没告诉作者。
      const theme = themeSelectionOf(notification)
      if (theme) {
        const work = notification.photoTitle?.trim() ?? ''
        return {
          text: (
            <>
              {work ? `《${work}》` : '你的作品'}入选主题{theme.title ? `「${theme.title}」` : ''}精选
            </>
          ),
          to: `/themes/${theme.slug}`,
          actionLabel: '查看主题',
        }
      }
      // 系统通知没有 actor，也没有跳转目标；文案里不要再拼一个「有人」
      return { text: '系统通知' }
    }
  }
}

// ===== 折叠组 =====

type CommentBundle = Extract<NotificationGroup, { type: 'comment-bundle' }>

const bundlePanelId = (key: string) => `notification-bundle-${key}`

export function NotificationsPage() {
  return (
    <RequireAuth>
      <NotificationsInner />
    </RequireAuth>
  )
}

function NotificationsInner() {
  const query = useNotifications(true)
  const { mutate: markRead } = useMarkNotificationsRead()
  const [searchParams, setSearchParams] = useSearchParams()
  const filter = parseFilter(searchParams.get('filter'))

  /**
   * 展开中的折叠组（key = 组内第一条 id）。
   * 用组件状态而不是 URL：折叠是「我此刻想看什么」，分享链接时没必要带上。
   */
  const [openBundles, setOpenBundles] = useState<ReadonlySet<string>>(() => new Set())
  /**
   * 展开后立刻标记已读的那些 id。
   *
   * 为什么要在本地记一份：markRead 成功后刻意不失效列表（见 hooks/useSocial），
   * 服务端已读、屏幕上的 readAt 仍是 null。不本地记账的话，展开后组头的
   * 未读点会一直挂着，用户以为没生效。
   */
  const [locallyRead, setLocallyRead] = useState<ReadonlySet<string>>(() => new Set())

  // 只在「第一页数据到手」后标记一次：ref 挡住重复触发（StrictMode 下 effect 会跑两遍）
  const markedRef = useRef(false)

  const items = useMemo(() => {
    const flat = query.data?.pages.flatMap((page) => page.items) ?? []
    return flat.filter((item, index) => flat.findIndex((other) => other.id === item.id) === index)
  }, [query.data])

  useEffect(() => {
    if (markedRef.current || !query.data) return
    markedRef.current = true
    if (items.some((item) => !item.readAt)) markRead(undefined)
  }, [items, markRead, query.data])

  const isUnread = useCallback(
    (notification: AppNotification) => notification.readAt === null && !locallyRead.has(notification.id),
    [locallyRead],
  )

  const visible = useMemo(() => items.filter((item) => matchFilter(item, filter)), [items, filter])
  const groups = useMemo(() => groupNotifications(visible), [visible])
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  const setFilter = useCallback(
    (next: NotificationFilter) => {
      const params = new URLSearchParams(searchParams)
      if (next === 'all') params.delete('filter')
      else params.set('filter', next)
      // replace：切筛选不该在浏览器历史里堆一串条目，返回键应该回到上一个页面
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  /**
   * Tab 的键盘操作：左右键切换、Home/End 跳到首尾，并把焦点搬到新选中的 Tab。
   *
   * 用「手写 roving tabindex」而不是 Radix Tabs：这里的选中态要写进 URL，
   * 且面板不是 Radix 的 TabsContent（列表是同一份数据过滤出来的），
   * 硬套 Radix 只会多一层状态同步。WAI-ARIA tabs 模式要求的角色与
   * 键盘行为都在这里显式给全。
   */
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = FILTER_TABS.findIndex((tab) => tab.value === filter)
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % FILTER_TABS.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + FILTER_TABS.length) % FILTER_TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = FILTER_TABS.length - 1
    else return
    event.preventDefault()
    setFilter(FILTER_TABS[next]!.value)
    // 焦点跟着选中项走：setFilter 是异步渲染，等下一帧再 focus
    requestAnimationFrame(() => tabRefs.current[next]?.focus())
  }

  const toggleBundle = (bundle: CommentBundle) => {
    const open = openBundles.has(bundle.key)
    const unreadIds = bundle.items.filter(isUnread).map((item) => item.id)
    setOpenBundles((prev) => {
      const next = new Set(prev)
      if (open) next.delete(bundle.key)
      else next.add(bundle.key)
      return next
    })
    // 「展开 = 读过了」：把组内还没读的一次性标记已读（收起不撤销）
    if (!open && unreadIds.length > 0) {
      setLocallyRead((prev) => new Set([...prev, ...unreadIds]))
      markRead(unreadIds)
    }
  }

  const tabs = (
    <div className="g-notification-tabs" role="tablist" aria-label="通知筛选" onKeyDown={onTabKeyDown}>
      {FILTER_TABS.map((tab, index) => {
        const selected = tab.value === filter
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={`notification-tab-${tab.value}`}
            aria-selected={selected}
            // roving tabindex：整组只占一个 Tab 停留点，组内用方向键移动
            tabIndex={selected ? 0 : -1}
            className={selected ? 'g-notification-tab g-notification-tab-active' : 'g-notification-tab'}
            ref={(node) => {
              tabRefs.current[index] = node
            }}
            onClick={() => setFilter(tab.value)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )

  return (
    <Container size="md">
      <PageHeader
        title="通知"
        description="点赞、评论、关注与系统消息都会出现在这里。"
        breadcrumbs={[{ label: '首页', to: '/' }, { label: '通知' }]}
      />

      {tabs}

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
          {groups.length === 0 ? (
            // 有通知但当前筛选下没有：给一条能一键回到全部的出口，而不是让人以为数据没了
            <EmptyState
              icon={BellOff}
              title={filter === 'system' ? '还没有系统消息' : '还没有互动通知'}
              description="换个筛选看看，新的点赞、评论与关注都在「全部」里。"
              actions={[{ label: '查看全部通知', onClick: () => setFilter('all') }]}
            />
          ) : (
            <ul className="g-notification-list">
              {groups.map((group) =>
                group.type === 'single' ? (
                  <NotificationRow key={group.key} notification={group.item} unread={isUnread(group.item)} />
                ) : (
                  <CommentBundleRow
                    key={group.key}
                    bundle={group}
                    open={openBundles.has(group.key)}
                    isUnread={isUnread}
                    onToggle={() => toggleBundle(group)}
                  />
                ),
              )}
            </ul>
          )}
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

/** 单独一条通知（未折叠的情形，与 8.3c 的渲染保持一致） */
function NotificationRow({ notification, unread }: { notification: AppNotification; unread: boolean }) {
  const copy = describe(notification)
  return (
    <li className={unread ? 'g-notification-item g-notification-item-unread' : 'g-notification-item'}>
      {notification.actor ? (
        <Link to={`/u/${notification.actor.username}`} aria-label={`查看 ${actorNameOf(notification)} 的主页`}>
          <Avatar src={accountImageUrl(notification.actor.avatarKey)} name={actorNameOf(notification)} size={48} />
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
}

interface CommentBundleRowProps {
  bundle: CommentBundle
  open: boolean
  isUnread: (notification: AppNotification) => boolean
  onToggle: () => void
}

/**
 * 折叠组：同一作品上连续的 ≥2 条评论。
 *
 * 组头本身就是一个按钮（不是「按钮 + 分组列表」），这样键盘只有一个停留点，
 * 回车/空格展开，Tab 进去才是组内明细的链接。
 */
function CommentBundleRow({ bundle, open, isUnread, onToggle }: CommentBundleRowProps) {
  const unreadCount = bundle.items.filter(isUnread).length
  const count = bundle.items.length
  // 三态：全未读 / 部分未读 / 全已读。只判「有没有未读」的话，部分已读与全未读
  // 长得一模一样，用户看不出组里还剩几条没看。
  const readState: BundleReadState =
    unreadCount === 0 ? 'all' : unreadCount === count ? 'none' : 'partial'
  const title = bundle.items.find((item) => item.photoTitle)?.photoTitle ?? ''
  const newest = bundle.items[0]
  const panelId = bundlePanelId(bundle.key)

  return (
    <li className={readState === 'none' ? 'g-notification-item g-notification-item-unread' : 'g-notification-item'}>
      <button
        type="button"
        className="g-notification-bundle-head"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="g-notification-system-icon" aria-hidden="true">
          <MessagesSquare />
        </span>
        <span className="g-notification-body">
          <span className="g-notification-text">
            {/* 全读完就不再叫「新评论」：读过的还叫新，等于天天提醒已经看过的东西 */}
            {unreadCount > 0 ? `${count} 条新评论` : `${count} 条评论`}
          </span>
          <span className="g-notification-meta">
            <span className="g-notification-tag">{KIND_TAG.comment}</span>
            {title && <span className="g-notification-bundle-photo">《{title}》</span>}
            {newest && <time dateTime={newest.createdAt}>{relativeTime(newest.createdAt)}</time>}
            {/* 部分已读时留一个未读点：全读/全未读靠底色与文案区分，中间的态只能靠点 */}
            {readState !== 'all' && (
              <span className="g-notification-dot" aria-hidden="true" data-state={readState} />
            )}
            {readState === 'partial' && <span>{unreadCount} 条未读</span>}
          </span>
        </span>
        <ChevronDown className={open ? 'g-notification-chevron is-open' : 'g-notification-chevron'} aria-hidden="true" />
      </button>

      {open && (
        <ul className="g-notification-bundle-items" id={panelId}>
          {bundle.items.map((item) => {
            const copy = describe(item)
            return (
              <li key={item.id} className="g-notification-bundle-item">
                {item.actor ? (
                  <Avatar
                    src={accountImageUrl(item.actor.avatarKey)}
                    name={actorNameOf(item)}
                    size={32}
                  />
                ) : (
                  <span className="g-notification-system-icon g-notification-system-icon-sm" aria-hidden="true">
                    <BellRing />
                  </span>
                )}
                <span className="g-notification-bundle-item-body">
                  <span className="g-notification-text">{copy.text}</span>
                  <span className="g-notification-meta">
                    <time dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time>
                    {isReplyNotification(item) && <span className="g-notification-tag">回复</span>}
                  </span>
                  {copy.to && (
                    <Link className="g-notification-bundle-link" to={copy.to}>
                      {copy.actionLabel ?? '查看'}
                    </Link>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}
