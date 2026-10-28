/**
 * 个人主页的**真实取数路径**（src/pages/ProfilePage.tsx + src/hooks/usePhotos.ts）。
 *
 * 与 profile-page.test.tsx 的分工：那一份把 hooks 桩掉，只验页面的分支与传参；
 * 这一份反过来——hooks 用真的，只把最外层的仓储换成假的，于是能断言到
 * 「点击/进入这个页面，前端最终发出了什么请求」以及「哪些请求根本没发」。
 *
 * 这条链路正是缺陷 B 的现场：API 模式下主页拿不到 profiles.id，按 id 取数的查询
 * 要么永远空、要么（id 为空串时）直接不发。所以断言的重点是请求参数里的 username，
 * 以及私密账号 / 关闭展示时**一个请求都不发**。
 *
 * 假仓储只提供本页用得到的两个方法；call 参数就是契约（sort/limit/authorUsername、
 * kind/cursor/limit），服务端怎么解释它们由 api / mock 仓储测试负责。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/ToastProvider'
import type { Session } from '@/domain/types'
import { ProfilePage } from '@/pages/ProfilePage'

const mocks = vi.hoisted(() => ({
  session: { value: null as Session | null },
  profile: { value: undefined as Record<string, unknown> | undefined },
  photoList: vi.fn(),
  listByUsername: vi.fn(),
  listLikesByUser: vi.fn(),
  listFavoritesByUser: vi.fn(),
}))

vi.mock('@/data', () => ({
  createRepositories: () => ({
    photos: { list: mocks.photoList },
    interactions: {
      listByUsername: mocks.listByUsername,
      listLikesByUser: mocks.listLikesByUser,
      listFavoritesByUser: mocks.listFavoritesByUser,
    },
  }),
}))

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ data: mocks.session.value }),
  useProfileByUsername: () => ({
    data: mocks.profile.value,
    isLoading: false,
    isError: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/hooks/useSocial', () => ({
  useFollowCounts: () => ({ data: { followers: 0, following: 0 }, isLoading: false }),
  useFollowState: () => ({ data: false }),
  useToggleFollow: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}))

/** API 模式公开资料的真实形状：**没有 id** */
const publicProfile = {
  username: 'alice',
  displayName: '爱丽丝',
  avatarKey: null,
  bio: '',
  links: [],
  visibility: 'public',
  showLikes: true,
  showFavorites: true,
  discoverable: true,
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      {/* FollowButton 的关注失败提示要弹 toast，缺 Provider 会直接抛错 */}
      <ToastProvider>
        <MemoryRouter initialEntries={['/u/alice']}>
          <Routes>
            <Route path="/u/:username" element={<ProfilePage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.session.value = null
  mocks.profile.value = { ...publicProfile }
  mocks.photoList.mockReset()
  mocks.listByUsername.mockReset()
  mocks.listLikesByUser.mockReset()
  mocks.listFavoritesByUser.mockReset()
  mocks.photoList.mockResolvedValue({ items: [], nextCursor: null })
  mocks.listByUsername.mockResolvedValue({ items: [], nextCursor: null })
})

afterEach(cleanup)

describe('进入访客主页时的真实请求', () => {
  it('works 按 authorUsername 取（不再拉最新 100 件后按 id 客户端过滤）', async () => {
    renderPage()

    await waitFor(() =>
      expect(mocks.photoList).toHaveBeenCalledWith({
        sort: 'latest',
        authorUsername: 'alice',
        limit: 100,
      }),
    )
    // 请求参数先落定，再等空态渲染出来（数据到位前是骨架屏，不是空态）
    expect(await screen.findByText('还没有作品')).toBeTruthy()
  })

  it('likes / favorites 走 username 版端点，并带上页长', async () => {
    renderPage()

    await waitFor(() =>
      expect(mocks.listByUsername).toHaveBeenCalledWith('alice', 'likes', undefined, 100),
    )
    await waitFor(() =>
      expect(mocks.listByUsername).toHaveBeenCalledWith('alice', 'favorites', undefined, 100),
    )
  })

  it('游客永远不会去碰「本人」端点（那对接口在 API 模式仅限自己，会 400）', async () => {
    renderPage()

    await waitFor(() => expect(mocks.photoList).toHaveBeenCalled())
    expect(mocks.listLikesByUser).not.toHaveBeenCalled()
    expect(mocks.listFavoritesByUser).not.toHaveBeenCalled()
  })
})

describe('不该发请求的场合', () => {
  it('私密账号 + 游客：三个列表一个请求都不发', () => {
    mocks.profile.value = { ...publicProfile, visibility: 'private' }
    renderPage()

    // RTL 的 render 会同步跑完挂载 effect，所以「渲染结束后没被调用」就是「不会发请求」
    expect(screen.getByText('这是私密账号')).toBeTruthy()
    expect(mocks.photoList).not.toHaveBeenCalled()
    expect(mocks.listByUsername).not.toHaveBeenCalled()
  })

  it('关闭「展示喜欢 / 收藏」：只取作品，不取另外两个 Tab', async () => {
    mocks.profile.value = { ...publicProfile, showLikes: false, showFavorites: false }
    renderPage()

    await waitFor(() => expect(mocks.photoList).toHaveBeenCalled())
    expect(mocks.listByUsername).not.toHaveBeenCalled()
  })

  it('私密账号 + 本人：三个列表照常取（服务端按会话放行）', async () => {
    mocks.profile.value = { ...publicProfile, visibility: 'private', isOwner: true }
    renderPage()

    await waitFor(() =>
      expect(mocks.photoList).toHaveBeenCalledWith({
        sort: 'latest',
        authorUsername: 'alice',
        limit: 100,
      }),
    )
    await waitFor(() =>
      expect(mocks.listByUsername).toHaveBeenCalledWith('alice', 'likes', undefined, 100),
    )
  })
})
