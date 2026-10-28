/**
 * 个人主页单测（src/pages/ProfilePage.tsx）。
 *
 * 这里的每一条都对应一个真实 API 模式暴露过（或差点暴露）的缺陷，而不是在描述实现：
 *
 *  1. **游客被当成本人**（缺陷 A）。API 模式的公开资料不返回 profiles.id，游客的 session
 *     也是 null，于是 `session?.userId === profile.id` 命中 `undefined === undefined`，
 *     任何访客看任何主页都会看到「编辑资料与隐私」和「去发布」。这类 bug 用常规夹具
 *     （给资料配上 id）永远测不出来，所以夹具刻意做成 API 的**真实形状：没有 id**。
 *  2. **列表拉不到**（缺陷 B）。三个列表原先按 id 取，id 缺失 → 查询不发 → 永远空。
 *     所以这里断言的是 hooks 被调用时**收到了 username**，以及私密账号 / 关掉展示时
 *     收到空串（= 不发请求）。
 *
 * 会话、资料、列表 hooks 全部桩掉：本文件测的是页面的分支与取数口径，
 * 不是 react-query 的缓存行为（那一层由 api / mock 仓储测试与 E2E 兜）。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/ToastProvider'
import type { Session } from '@/domain/types'
import { ProfilePage } from '@/pages/ProfilePage'

interface ListCall {
  username: string
  kind: string
}

const mocks = vi.hoisted(() => ({
  session: { value: null as Session | null },
  profile: { value: undefined as Record<string, unknown> | undefined },
  profileState: { isLoading: false, isError: false, error: undefined as unknown },
  /** usePhotosByUsername 每次渲染的调用参数（同一 kind 取最后一次） */
  calls: [] as ListCall[],
}))

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ data: mocks.session.value }),
  useProfileByUsername: () => ({
    data: mocks.profile.value,
    isLoading: mocks.profileState.isLoading,
    isError: mocks.profileState.isError,
    error: mocks.profileState.error,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/hooks/usePhotos', () => ({
  usePhotosByUsername: (username: string, kind: string) => {
    mocks.calls.push({ username, kind })
    return { data: [], isLoading: false, error: undefined, refetch: vi.fn() }
  },
}))

vi.mock('@/hooks/useSocial', () => ({
  useFollowCounts: () => ({ data: { followers: 0, following: 0 }, isLoading: false }),
  useFollowState: () => ({ data: false }),
  useToggleFollow: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  useBlockUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const session: Session = {
  userId: 'u-me',
  username: 'me',
  displayName: '我',
  avatarKey: null,
  role: 'user',
  expiresAt: '2099-01-01T00:00:00.000Z',
}

/** API 模式公开资料的真实形状：**没有 id**，isOwner 由服务端按会话算 */
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
  return render(
    // FollowButton 的关注失败提示要弹 toast，缺 Provider 会直接抛错
    <ToastProvider>
      <MemoryRouter initialEntries={['/u/alice']}>
        <Routes>
          <Route path="/u/:username" element={<ProfilePage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
}

/** 某个 Tab 最后一次的取数参数（undefined = 这一轮压根没调用） */
const callFor = (kind: string) => mocks.calls.filter((c) => c.kind === kind).at(-1)

beforeEach(() => {
  mocks.session.value = null
  mocks.profile.value = { ...publicProfile }
  mocks.profileState.isLoading = false
  mocks.profileState.isError = false
  mocks.profileState.error = undefined
  mocks.calls.length = 0
})

afterEach(cleanup)

describe('缺陷 A：本人判定不能因两个 undefined 相等而误判', () => {
  it('游客 + 无 id 的公开资料：不显示「编辑资料与隐私」，空态也不给「去发布」', () => {
    renderPage()

    expect(screen.queryByRole('link', { name: '编辑资料与隐私' })).toBeNull()
    expect(screen.queryByRole('link', { name: '去发布' })).toBeNull()
    // 藏品仍然是空的（这里只断言归属，取数见下一组）
    expect(screen.getByText('还没有作品')).toBeTruthy()
  })

  it('游客 + 无 id：即使资料里没有 isOwner 字段也不误判（字段缺失 ≠ 本人）', () => {
    mocks.profile.value = { ...publicProfile, isOwner: undefined }
    renderPage()

    expect(screen.queryByRole('link', { name: '编辑资料与隐私' })).toBeNull()
    expect(screen.queryByRole('link', { name: '去发布' })).toBeNull()
  })

  it('服务端说 isOwner 就是本人：即使没有 id 也显示编辑入口', () => {
    mocks.profile.value = { ...publicProfile, isOwner: true }
    renderPage()

    expect(screen.getByRole('link', { name: '编辑资料与隐私' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '去发布' })).toBeTruthy()
  })

  it('mock 模式（资料带 id）：id 与会话一致仍是本人，本人视图不回归', () => {
    mocks.session.value = session
    mocks.profile.value = { ...publicProfile, id: 'u-me', username: 'me' }
    renderPage()

    expect(screen.getByRole('link', { name: '编辑资料与隐私' })).toBeTruthy()
  })

  it('mock 模式：id 与会话不一致时不是本人', () => {
    mocks.session.value = session
    mocks.profile.value = { ...publicProfile, id: 'u-alice' }
    renderPage()

    expect(screen.queryByRole('link', { name: '编辑资料与隐私' })).toBeNull()
  })

  it('isOwner=false 且 id 为空的组合不会被当成本人（防御未来改成显式 false）', () => {
    mocks.profile.value = { ...publicProfile, isOwner: false, id: '' }
    mocks.session.value = { ...session, userId: '' }
    renderPage()

    expect(screen.queryByRole('link', { name: '编辑资料与隐私' })).toBeNull()
  })
})

describe('缺陷 B：三个列表都按 username 驱动', () => {
  it('游客主页：works / likes / favorites 都用 username 取数（不再依赖 id）', () => {
    renderPage()

    expect(callFor('works')).toEqual({ username: 'alice', kind: 'works' })
    expect(callFor('likes')).toEqual({ username: 'alice', kind: 'likes' })
    expect(callFor('favorites')).toEqual({ username: 'alice', kind: 'favorites' })
  })

  it('本人主页同样按 username 取数（身份不改变取数口径）', () => {
    mocks.profile.value = { ...publicProfile, isOwner: true }
    renderPage()

    expect(callFor('works')).toEqual({ username: 'alice', kind: 'works' })
    expect(callFor('likes')).toEqual({ username: 'alice', kind: 'likes' })
  })

  it('关闭「展示喜欢 / 收藏」时对应列表不发请求（username 传空 = enabled=false）', () => {
    mocks.profile.value = { ...publicProfile, showLikes: false, showFavorites: false }
    renderPage()

    expect(callFor('works')).toEqual({ username: 'alice', kind: 'works' })
    expect(callFor('likes')).toEqual({ username: '', kind: 'likes' })
    expect(callFor('favorites')).toEqual({ username: '', kind: 'favorites' })
    expect(screen.queryByRole('tab', { name: '喜欢' })).toBeNull()
    expect(screen.queryByRole('tab', { name: '收藏' })).toBeNull()
  })

  it('私密账号：访客主页三个列表的 username 全为空（一个请求都不发）', () => {
    mocks.profile.value = { ...publicProfile, visibility: 'private' }
    renderPage()

    expect(screen.getByText('这是私密账号')).toBeTruthy()
    expect(callFor('works')).toEqual({ username: '', kind: 'works' })
    expect(callFor('likes')).toEqual({ username: '', kind: 'likes' })
    expect(callFor('favorites')).toEqual({ username: '', kind: 'favorites' })
    // 「不请求」这件事本身在 profile-page-requests.test.tsx 里用真 hook + 假仓储断言
  })

  it('私密账号：本人仍然看得到自己的三个列表', () => {
    mocks.profile.value = { ...publicProfile, visibility: 'private', isOwner: true }
    renderPage()

    expect(callFor('works')).toEqual({ username: 'alice', kind: 'works' })
    expect(callFor('likes')).toEqual({ username: 'alice', kind: 'likes' })
    expect(callFor('favorites')).toEqual({ username: 'alice', kind: 'favorites' })
    expect(screen.queryByText('这是私密账号')).toBeNull()
  })
})
