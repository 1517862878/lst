/**
 * 通知中心的 8.3d 行为：评论折叠 / 回复与榜单文案 / 筛选 Tab。
 *
 * 与 notifications-page.test.tsx 的分工：那边锁 8.3c 的既有约定（进页面标记已读、
 * 只标一次、不重取、四类型文案、翻页去重、错误重试）；这里只测新加的三块，
 * 避免一个文件里塞十几条断言后看不出哪条坏了。
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CursorListPage } from '@/data/contracts'
import type { AppNotification, Profile, Session } from '@/domain/types'
import { NotificationsPage } from '@/pages/NotificationsPage'

const mocks = vi.hoisted(() => ({
  notifications: vi.fn(),
  markRead: vi.fn(),
  unreadCount: vi.fn(),
  session: { value: null as Session | null },
}))

vi.mock('@/data', () => ({
  createRepositories: () => ({
    social: {
      notifications: mocks.notifications,
      markRead: mocks.markRead,
      unreadCount: mocks.unreadCount,
    },
  }),
}))

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ data: mocks.session.value, isLoading: false }),
}))

const session: Session = {
  userId: 'u-me',
  username: 'me',
  displayName: '我',
  avatarKey: null,
  role: 'user',
  expiresAt: '2099-01-01T00:00:00.000Z',
}

function profile(id: string, displayName: string): Profile {
  return {
    id,
    username: id,
    displayName,
    avatarKey: null,
    bio: '',
    role: 'user',
    links: [],
    licensePreference: 'all_rights_reserved',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
}

const alice = profile('u-alice', '爱丽丝')

function notice(id: string, overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    kind: 'comment',
    actor: alice,
    photoId: 'p1',
    commentId: null,
    readAt: null,
    createdAt: '2026-02-10T00:00:00.000Z',
    ...overrides,
  }
}

const page = (items: AppNotification[]): CursorListPage<AppNotification> => ({
  items,
  nextCursor: null,
})

/** 文案里有 <strong> 拆出来的文本节点，按 .g-notification-text 的 textContent 整句比 */
const notificationCopy = (expected: string) => (_content: string, element: Element | null) =>
  element?.classList.contains('g-notification-text') === true &&
  (element.textContent ?? '').replace(/\s+/g, ' ').trim() === expected

/** 把当前 URL 挂到 DOM 上，方便断言 ?filter= 真的写进去了 */
function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function renderPage(entry = '/notifications') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/notifications"
            element={
              <>
                <NotificationsPage />
                <LocationProbe />
              </>
            }
          />
          <Route path="/login" element={<p>登录页</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.notifications.mockReset().mockResolvedValue(page([]))
  mocks.markRead.mockReset().mockResolvedValue(undefined)
  mocks.unreadCount.mockReset().mockResolvedValue(0)
  mocks.session.value = session
})

afterEach(cleanup)

describe('评论折叠', () => {
  it('同一作品相邻的 2 条评论折叠成一行「2 条新评论」', async () => {
    mocks.notifications.mockResolvedValue(
      page([notice('c1'), notice('c2'), notice('k1', { kind: 'like' })]),
    )
    renderPage()

    expect(await screen.findByText(notificationCopy('2 条新评论'))).toBeInTheDocument()
    // 折叠时组内明细不渲染：两条评论自己的文案不该出现在屏幕上
    expect(screen.queryAllByText(notificationCopy('爱丽丝 评论了你的作品'))).toHaveLength(0)
    // 展不展开要能被读屏知道
    expect(screen.getByRole('button', { expanded: false })).toHaveAccessibleName(/2 条新评论/)
  })

  it('只有 1 条评论时不折叠', async () => {
    mocks.notifications.mockResolvedValue(page([notice('c1')]))
    renderPage()

    expect(await screen.findByText(notificationCopy('爱丽丝 评论了你的作品'))).toBeInTheDocument()
    expect(screen.queryByText(notificationCopy('1 条新评论'))).not.toBeInTheDocument()
  })

  it('不同作品 / 被其它类型隔开的评论不合并成一组', async () => {
    mocks.notifications.mockResolvedValue(
      page([
        notice('c1', { photoId: 'p1' }),
        notice('c2', { photoId: 'p2' }),
        notice('c3', { photoId: 'p1' }),
        notice('c4', { photoId: 'p1' }),
      ]),
    )
    renderPage()

    // p1 的两条「不相邻」（中间隔着 p2），只有尾部 c3+c4 成组
    expect(await screen.findByText(notificationCopy('2 条新评论'))).toBeInTheDocument()
    expect(screen.getAllByText(notificationCopy('爱丽丝 评论了你的作品'))).toHaveLength(2)
  })

  it('展开后把组内未读全部标记已读，且明细可见', async () => {
    const user = userEvent.setup()
    mocks.notifications.mockResolvedValue(page([notice('c1'), notice('c2')]))
    renderPage()

    await user.click(await screen.findByRole('button', { name: /2 条新评论/ }))

    await waitFor(() => expect(mocks.markRead).toHaveBeenLastCalledWith(['c1', 'c2']))
    expect(screen.getByRole('button', { expanded: true })).toHaveAccessibleName(/2 条评论/)
    // 组内明细是嵌套在通知列表里的子列表：按类名取，避免 role=list 撞到外层
    const panel = document.querySelector('.g-notification-bundle-items')
    expect(panel).not.toBeNull()
    expect(within(panel as HTMLElement).getAllByText(notificationCopy('爱丽丝 评论了你的作品'))).toHaveLength(2)
    // 展开即已读：组头不应该再宣称「新评论」
    expect(screen.getByText(notificationCopy('2 条评论'))).toBeInTheDocument()
  })

  it('展开时只标记还没读的那几条', async () => {
    const user = userEvent.setup()
    mocks.notifications.mockResolvedValue(
      page([
        notice('c1', { readAt: '2026-02-11T00:00:00.000Z' }),
        notice('c2'),
        notice('c3'),
      ]),
    )
    renderPage()

    // 三条里两条未读：组头按总数叫「3 条新评论」，另注明还剩 2 条未读
    await user.click(await screen.findByRole('button', { name: /3 条新评论/ }))
    await waitFor(() => expect(mocks.markRead).toHaveBeenLastCalledWith(['c2', 'c3']))
  })

  it('部分已读时组头留一个未读点并写明还剩几条', async () => {
    mocks.notifications.mockResolvedValue(
      page([notice('c1'), notice('c2', { readAt: '2026-02-11T00:00:00.000Z' })]),
    )
    renderPage()

    const head = await screen.findByRole('button', { name: /1 条未读/ })
    expect(head.querySelector('.g-notification-dot')).not.toBeNull()
    expect(within(head).getByText(notificationCopy('2 条新评论'))).toBeInTheDocument()
  })

  it('全部已读的组不再叫「新评论」，也没有未读点', async () => {
    mocks.notifications.mockResolvedValue(
      page([
        notice('c1', { readAt: '2026-02-11T00:00:00.000Z' }),
        notice('c2', { readAt: '2026-02-11T00:00:00.000Z' }),
      ]),
    )
    renderPage()

    const head = await screen.findByRole('button', { name: /2 条评论/ })
    expect(head.querySelector('.g-notification-dot')).toBeNull()
    expect(screen.queryByText(notificationCopy('2 条新评论'))).not.toBeInTheDocument()
  })
})

describe('文案', () => {
  it('回复通知说「回复了你的评论」，普通评论说「评论了你的作品」', async () => {
    mocks.notifications.mockResolvedValue(
      page([
        notice('r1', { meta: { reply: true, parentCommentId: 'cm-1' } }),
        notice('c2', { photoId: 'p2' }),
      ]),
    )
    renderPage()

    expect(await screen.findByText(notificationCopy('爱丽丝 回复了你的评论'))).toBeInTheDocument()
    expect(screen.getByText(notificationCopy('爱丽丝 评论了你的作品'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看回复' })).toHaveAttribute('href', '/works/p1')
  })

  it('榜单通知写成「你的作品《X》入选 2026-W44 周榜第 3 名」', async () => {
    mocks.notifications.mockResolvedValue(
      page([
        notice('w1', {
          kind: 'system',
          actor: null,
          photoId: 'p7',
          photoTitle: '海边日落',
          meta: { kind: 'weekly_rank', rank: 3, isoWeek: '2026-W44', score: 186 },
        }),
      ]),
    )
    renderPage()

    expect(
      await screen.findByText(notificationCopy('你的作品《海边日落》入选 2026-W44 周榜第 3 名')),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看作品' })).toHaveAttribute('href', '/works/p7')
  })

  it('拿不到作品标题（已下架）时不硬编书名号', async () => {
    mocks.notifications.mockResolvedValue(
      page([
        notice('w2', {
          kind: 'system',
          actor: null,
          photoId: null,
          meta: { kind: 'weekly_rank', rank: 1, isoWeek: '2026-W43' },
        }),
      ]),
    )
    renderPage()

    expect(
      await screen.findByText(notificationCopy('你的作品入选 2026-W43 周榜第 1 名')),
    ).toBeInTheDocument()
  })

  it('普通系统通知仍然只说「系统通知」', async () => {
    mocks.notifications.mockResolvedValue(
      page([notice('s1', { kind: 'system', actor: null, photoId: null })]),
    )
    renderPage()

    expect(await screen.findByText('系统通知')).toBeInTheDocument()
  })
})

describe('筛选 Tab', () => {
  const mixed = [
    notice('l1', { kind: 'like' }),
    notice('s1', { kind: 'system', actor: null, photoId: null }),
    notice('f1', { kind: 'follow', photoId: null }),
  ]

  it('三个 Tab 用 tablist 语义，默认选中「全部」', async () => {
    mocks.notifications.mockResolvedValue(page(mixed))
    renderPage()

    const tablist = await screen.findByRole('tablist', { name: '通知筛选' })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['全部', '互动', '系统'])
    expect(within(tablist).getByRole('tab', { name: '全部' })).toHaveAttribute('aria-selected', 'true')
    // roving tabindex：没选中的 Tab 不该抢 Tab 键焦点
    expect(within(tablist).getByRole('tab', { name: '系统' })).toHaveAttribute('tabindex', '-1')
  })

  it('切到「系统」只留系统通知，并把 ?filter=system 写进 URL', async () => {
    const user = userEvent.setup()
    mocks.notifications.mockResolvedValue(page(mixed))
    renderPage()

    await user.click(await screen.findByRole('tab', { name: '系统' }))

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/notifications?filter=system'),
    )
    expect(screen.getByText('系统通知')).toBeInTheDocument()
    expect(screen.queryByText(notificationCopy('爱丽丝 赞了你的作品'))).not.toBeInTheDocument()
    expect(screen.queryByText(notificationCopy('爱丽丝 关注了你'))).not.toBeInTheDocument()
  })

  it('「互动」筛掉系统消息，点赞/评论/关注都在', async () => {
    const user = userEvent.setup()
    mocks.notifications.mockResolvedValue(page(mixed))
    renderPage()

    await user.click(await screen.findByRole('tab', { name: '互动' }))

    expect(await screen.findByText(notificationCopy('爱丽丝 赞了你的作品'))).toBeInTheDocument()
    expect(screen.getByText(notificationCopy('爱丽丝 关注了你'))).toBeInTheDocument()
    expect(screen.queryByText('系统通知')).not.toBeInTheDocument()
  })

  it('直接带 ?filter=interactive 进来就是「互动」视图', async () => {
    mocks.notifications.mockResolvedValue(page(mixed))
    renderPage('/notifications?filter=interactive')

    expect(await screen.findByRole('tab', { name: '互动' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('系统通知')).not.toBeInTheDocument()
  })

  it('回落到「全部」时把 filter 参数删掉', async () => {
    const user = userEvent.setup()
    mocks.notifications.mockResolvedValue(page(mixed))
    renderPage('/notifications?filter=system')

    await user.click(await screen.findByRole('tab', { name: '全部' }))
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/notifications$/),
    )
  })

  it('方向键在 Tab 之间移动焦点并切换视图', async () => {
    const user = userEvent.setup()
    mocks.notifications.mockResolvedValue(page(mixed))
    renderPage()

    const all = await screen.findByRole('tab', { name: '全部' })
    all.focus()
    await user.keyboard('{ArrowRight}')

    await waitFor(() => expect(screen.getByRole('tab', { name: '互动' })).toHaveAttribute('aria-selected', 'true'))
    // 焦点搬到新选中的 Tab：键盘用户不该在切完之后还停在旧位置
    await waitFor(() => expect(screen.getByRole('tab', { name: '互动' })).toHaveFocus())
  })

  it('当前筛选下没有内容时给一条回「全部」的出口', async () => {
    const user = userEvent.setup()
    mocks.notifications.mockResolvedValue(page([notice('l1', { kind: 'like' })]))
    renderPage('/notifications?filter=system')

    expect(await screen.findByText('还没有系统消息')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '查看全部通知' }))
    expect(await screen.findByText(notificationCopy('爱丽丝 赞了你的作品'))).toBeInTheDocument()
  })
})
