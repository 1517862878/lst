/**
 * 拍摄参数隐私的三处界面（8.4a ①）。
 *
 * 一条链路三个地方，缺一个作者就会以为「已经隐藏了」：
 *   · 设置页「拍摄参数公开范围」= 账户级兜底（hidden 时所有作品都不显示）；
 *   · 发布/编辑页逐张开关 = 单张覆盖（只能关，不能在账户隐藏时打开）；
 *   · 详情页 = 真相所在：隐藏时给一句解释，而不是一张空表。
 *
 * 另外锁住器材/地点的可点跳转：机型、镜头、地点都要变成链接（②③ 的入口）。
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/ToastProvider'
import type { Photo } from '@/domain/types'
import { makePhoto } from './fixtures'

const mocks = vi.hoisted(() => ({
  photo: { value: null as Photo | null },
  exifVisibility: { value: 'public' as 'public' | 'hidden' },
  setExif: vi.fn(),
  updatePhoto: vi.fn(),
}))

vi.mock('@/hooks/usePhotos', () => ({
  usePhoto: () => ({ data: mocks.photo.value, isLoading: false, error: null, refetch: vi.fn() }),
  useRelatedPhotos: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useMorePhotosByAuthor: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useWithdrawPhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePhoto: () => ({ mutateAsync: mocks.updatePhoto, isPending: false }),
}))

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({
    data: {
      userId: 'u1',
      username: 'me',
      displayName: '我',
      avatarKey: null,
      role: 'user',
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
  }),
  useProfileByUsername: () => ({
    data: { id: 'u1', username: 'me', exifVisibility: mocks.exifVisibility.value, pinnedPhotoIds: [] },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/hooks/usePhotography', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/usePhotography')>()),
  useSetExifVisibility: () => ({ mutateAsync: mocks.setExif, isPending: false }),
  useSetPinned: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSeasons: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}))

vi.mock('@/hooks/useAccount', () => {
  const account = {
    id: 'u1',
    username: 'me',
    displayName: '我',
    phone: null,
    bio: '',
    avatarKey: null,
    visibility: 'public',
    discoverable: true,
    showLikes: true,
    showFavorites: true,
    links: [],
    notificationPreferences: {
      accountSecurity: true,
      productUpdates: true,
      likes: true,
      comments: true,
      follows: true,
    },
  }
  return {
    useAccount: () => ({ data: account, isLoading: false, isError: false, refetch: vi.fn() }),
    useUpdatePreferences: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateAccount: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useAccountSessions: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
    useRevokeSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteAccount: () => ({ mutateAsync: vi.fn(), isPending: false }),
  }
})

vi.mock('@/hooks/useSocial', () => ({
  useBlockedUsers: () => ({
    data: { pages: [{ items: [], nextCursor: null }] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useUnblockUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/useInteractions', () => ({
  useInteractionSync: () => undefined,
  // 编辑页 8.4b 起多了一个评论锁 mutation（评论锁与作品信息分开提交）
  useSetCommentsLocked: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/features/interactions/CommentSection', () => ({ CommentSection: () => null }))
vi.mock('@/features/interactions/LikeFavoriteButtons', () => ({
  LikeButton: () => null,
  FavoriteButton: () => null,
}))
vi.mock('@/features/moderation/WorkMoreMenu', () => ({ WorkMoreMenu: () => null }))
vi.mock('@/features/collections/AddToCollectionDialog', () => ({ AddToCollectionDialog: () => null }))
vi.mock('@/features/photos/ShareButton', () => ({ ShareButton: () => null }))
vi.mock('@/features/photos/PhotoGrid', () => ({ PhotoGrid: () => null }))
vi.mock('@/features/profiles/AuthorLink', () => ({
  AuthorLink: ({ username }: { username: string }) => <a href={`/u/${username}`}>@{username}</a>,
}))

const { WorkDetailPage } = await import('@/pages/WorkDetailPage')
const { WorkEditPage } = await import('@/pages/WorkEditPage')
const { SettingsPage } = await import('@/pages/SettingsPage')

function photo(overrides: Partial<Photo> = {}): Photo {
  return makePhoto('p1', {
    title: '清晨的西湖',
    locationName: '杭州·西湖',
    shotAt: '2026-04-02T00:00:00.000Z',
    publishedAt: '2026-04-05T00:00:00.000Z',
    exif: { Make: 'Canon', Model: 'EOS R5', LensModel: 'RF 24-70mm F2.8', ISO: 100 },
    ...overrides,
  })
}

beforeEach(() => {
  mocks.photo.value = photo()
  mocks.exifVisibility.value = 'public'
  mocks.setExif.mockReset().mockResolvedValue(undefined)
  mocks.updatePhoto.mockReset().mockResolvedValue(undefined)
})

describe('详情页拍摄参数', () => {
  function renderDetail() {
    return render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/works/p1']}>
          <Routes>
            <Route path="/works/:id" element={<WorkDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    )
  }

  it('公开时展示参数表，机型/镜头变成可点跳转的链接', () => {
    renderDetail()
    expect(screen.getByText('拍摄参数（EXIF 白名单）')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Canon EOS R5' })).toHaveAttribute(
      'href',
      `/gear/body?label=${encodeURIComponent('Canon EOS R5')}`,
    )
    expect(screen.getByRole('link', { name: 'RF 24-70mm F2.8' })).toHaveAttribute(
      'href',
      `/gear/lens?label=${encodeURIComponent('RF 24-70mm F2.8')}`,
    )
  })

  it('单张隐藏时只说一句「作者未公开拍摄参数」，不留空表', () => {
    mocks.photo.value = photo({ exifHidden: true })
    renderDetail()
    expect(screen.getByText('作者未公开拍摄参数')).toBeInTheDocument()
    expect(screen.queryByText('拍摄参数（EXIF 白名单）')).toBeNull()
  })

  it('公开但没有参数时整块不出现（空表比没有更糟）', () => {
    mocks.photo.value = photo({ exif: null })
    renderDetail()
    expect(screen.queryByText('拍摄参数（EXIF 白名单）')).toBeNull()
    expect(screen.queryByText('作者未公开拍摄参数')).toBeNull()
  })

  it('地点是到地点作品流的链接', () => {
    renderDetail()
    expect(screen.getByRole('link', { name: /杭州·西湖/ })).toHaveAttribute(
      'href',
      `/places/${encodeURIComponent('杭州·西湖')}`,
    )
  })
})

describe('设置页拍摄参数公开范围', () => {
  function renderSettings() {
    return render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/settings/privacy']}>
          <Routes>
            <Route path="/settings/:section" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    )
  }

  it('两个选项齐备，当前值来自资料', () => {
    renderSettings()
    const section = screen.getByRole('region', { name: '拍摄参数公开范围' })
    expect(within(section).getByRole('radio', { name: /^公开拍摄参数/ })).toBeChecked()
    expect(within(section).getByRole('radio', { name: /^隐藏拍摄参数/ })).not.toBeChecked()
  })

  it('改成隐藏并保存，调用 setExifVisibility("hidden")', async () => {
    mocks.exifVisibility.value = 'public'
    const user = userEvent.setup()
    renderSettings()
    const section = screen.getByRole('region', { name: '拍摄参数公开范围' })

    await user.click(within(section).getByRole('radio', { name: /^隐藏拍摄参数/ }))
    const save = within(section).getByRole('button', { name: '保存拍摄参数设置' })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    await waitFor(() => expect(mocks.setExif).toHaveBeenCalledWith('hidden'))
    expect(await screen.findByRole('status')).toHaveTextContent('拍摄参数公开范围已保存')
  })

  it('文案说明账户隐藏后单张开关无法打开', () => {
    renderSettings()
    expect(screen.getByText(/单张作品的开关无法把它重新打开/)).toBeInTheDocument()
  })
})

describe('编辑页逐张开关', () => {
  function renderEdit() {
    return render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/works/p1/edit']}>
          <Routes>
            <Route path="/works/:id/edit" element={<WorkEditPage />} />
            <Route path="/works/:id" element={<p>作品详情</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    )
  }

  it('默认开启；关掉后提交的补丁里 exifHidden 为 true', async () => {
    const user = userEvent.setup()
    renderEdit()

    const toggle = screen.getByRole('checkbox', { name: /公开这张作品的拍摄参数/ })
    expect(toggle).toBeChecked()

    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => expect(mocks.updatePhoto).toHaveBeenCalledTimes(1))
    expect(mocks.updatePhoto.mock.calls[0]?.[0]).toMatchObject({ exifHidden: true })
  })

  it('已隐藏的作品打开编辑页时开关是关的', () => {
    mocks.photo.value = photo({ exifHidden: true })
    renderEdit()
    expect(screen.getByRole('checkbox', { name: /公开这张作品的拍摄参数/ })).not.toBeChecked()
  })
})
