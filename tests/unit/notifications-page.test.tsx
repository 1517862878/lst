/**
 * 通知中心单测（src/pages/NotificationsPage.tsx）。
 *
 * 用真的 hooks + 桩掉的仓储，锁住三条容易回归的行为：
 *  1. 进页面标记已读，且**只标一次**（StrictMode 下 effect 会跑两遍）；
 *  2. 标记已读后**不重取列表**——未读样式要留在屏幕上，用户才看得清哪几条是新的；
 *  3. 四种通知类型都能出文案与对应的跳转目标。
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
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

const actor: Profile = {
  id: 'u-alice',
  username: 'alice',
  displayName: '爱丽丝',
  avatarKey: null,
  bio: '',
  role: 'user',
  links: [],
  licensePreference: 'all_rights_reserved',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
}

function notice(id: string, overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    kind: 'like',
    actor,
    photoId: 'p1',
    commentId: null,
    readAt: null,
    createdAt: '2026-02-10T00:00:00.000Z',
    ...overrides,
  }
}

const page = (items: AppNotification[], nextCursor: string | null = null): CursorListPage<AppNotification> => ({
  items,
  nextCursor,
})

/**
 * 通知文案里有 <strong> 高亮作者名（「**爱丽丝** 赞了你的作品」），
 * testing-library 的默认匹配只看元素的直接文本节点，整句会被拆开，
 * 所以这里按 .g-notification-text 的 textContent 自比。
 */
const notificationCopy = (expected: string) => (_content: string, element: Element | null) =>
  element?.classList.contains('g-notification-text') === true &&
  (element.textContent ?? '').replace(/\s+/g, ' ').trim() === expected

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/notifications']}>
        <Routes>
          <Route path="/notifications" element={<NotificationsPage />} />
          {/*
            必须给重定向目标一条路由：react-router 的 <Navigate> 是「每次渲染都导航」，
            目标路由不存在时组件永远不卸载，这里会变成死循环（测试直接卡住）。
          */}
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

describe('NotificationsPage', () => {
  it('未登录被 RequireAuth 拦到登录页并带回跳', () => {
    mocks.session.value = null
    renderPage()
    // 守卫渲染的是 Navigate：页面内容不该出现，而且已经落到了登录页
    expect(screen.queryByRole('heading', { name: '通知' })).not.toBeInTheDocument()
    expect(screen.getByText('登录页')).toBeInTheDocument()
  })

  it('没有通知时给出空状态而不是空白页', async () => {
    renderPage()
    expect(await screen.findByText('还没有通知')).toBeInTheDocument()
    // 没有未读就不该发标记请求
    expect(mocks.markRead).not.toHaveBeenCalled()
  })

  it('进页面把未读标记为已读，且只标一次（全部已读 = 不传 ids）', async () => {
    mocks.notifications.mockResolvedValue(page([notice('n1'), notice('n2', { readAt: '2026-02-11T00:00:00.000Z' })]))
    renderPage()

    // 两条点赞来自同一作者，文案相同：只等其中一个出现即可
    expect(await screen.findAllByText(notificationCopy('爱丽丝 赞了你的作品'))).toHaveLength(2)
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1))
    expect(mocks.markRead).toHaveBeenCalledWith(undefined)
  })

  it('已读之后不重取列表：未读样式要留在屏幕上', async () => {
    mocks.notifications.mockResolvedValue(page([notice('n1')]))
    renderPage()

    await screen.findByText(notificationCopy('爱丽丝 赞了你的作品'))
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalled())
    // 标记已读只失效未读数；列表仍是同一次请求的结果
    expect(mocks.notifications).toHaveBeenCalledTimes(1)
    expect(screen.getByText('未读')).toBeInTheDocument()
  })

  it('四种类型各自出文案与跳转', async () => {
    mocks.notifications.mockResolvedValue(
      page([
        notice('n-like', { kind: 'like', photoId: 'p9' }),
        notice('n-comment', { kind: 'comment', photoId: 'p8' }),
        notice('n-follow', { kind: 'follow', photoId: null }),
        notice('n-system', { kind: 'system', actor: null, photoId: null }),
      ]),
    )
    renderPage()

    expect(await screen.findByText(notificationCopy('爱丽丝 赞了你的作品'))).toBeInTheDocument()
    expect(screen.getByText(notificationCopy('爱丽丝 评论了你的作品'))).toBeInTheDocument()
    expect(screen.getByText(notificationCopy('爱丽丝 关注了你'))).toBeInTheDocument()
    expect(screen.getByText('系统通知')).toBeInTheDocument()

    // 跳转目标：作品页 / 对方主页；系统通知没有「查看」链接
    expect(screen.getByRole('link', { name: '查看作品' })).toHaveAttribute('href', '/works/p9')
    expect(screen.getByRole('link', { name: '查看评论' })).toHaveAttribute('href', '/works/p8')
    expect(screen.getByRole('link', { name: '查看主页' })).toHaveAttribute('href', '/u/alice')
    expect(screen.queryByRole('link', { name: '查看' })).not.toBeInTheDocument()

    // 类型标签也渲染出来了（不只靠图标区分）。
    // 在列表内查询：「系统」同时也是顶部筛选 Tab 的名字，全局查会撞成两个。
    const list = within(screen.getByRole('list'))
    expect(list.getByText('点赞')).toBeInTheDocument()
    expect(list.getByText('评论')).toBeInTheDocument()
    expect(list.getByText('关注')).toBeInTheDocument()
    expect(list.getByText('系统')).toBeInTheDocument()
  })

  it('有下一页时给「加载更早的通知」，点了带游标再取一页', async () => {
    const user = userEvent.setup()
    mocks.notifications
      .mockResolvedValueOnce(page([notice('n1')], 'CURSOR-1'))
      .mockResolvedValueOnce(page([notice('n0', { createdAt: '2026-02-01T00:00:00.000Z' })]))
    renderPage()

    const more = await screen.findByRole('button', { name: '加载更早的通知' })
    await user.click(more)

    await waitFor(() => expect(mocks.notifications).toHaveBeenCalledTimes(2))
    expect(mocks.notifications).toHaveBeenLastCalledWith('CURSOR-1')
  })

  it('同一通知跨页重复出现时只渲染一条（去重）', async () => {
    const user = userEvent.setup()
    mocks.notifications
      .mockResolvedValueOnce(page([notice('dup')], 'C1'))
      .mockResolvedValueOnce(page([notice('dup')]))
    renderPage()

    await user.click(await screen.findByRole('button', { name: '加载更早的通知' }))
    await waitFor(() => expect(mocks.notifications).toHaveBeenCalledTimes(2))
    expect(screen.getAllByText(notificationCopy('爱丽丝 赞了你的作品'))).toHaveLength(1)
  })

  it('加载失败显示错误态并可重试', async () => {
    const user = userEvent.setup()
    mocks.notifications.mockRejectedValueOnce(new Error('网络异常')).mockResolvedValueOnce(page([notice('n1')]))
    renderPage()

    expect(await screen.findByText('通知加载失败')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText(notificationCopy('爱丽丝 赞了你的作品'))).toBeInTheDocument()
  })
})
