/**
 * 评论锁的乐观更新 + 失败回滚（8.4b），以及详情页把锁状态传下去的那条线。
 *
 * 乐观更新的价值在于「点下去立刻生效」；代价是失败时屏幕上可能留着假状态，
 * 所以这里把两半都钉住：
 *   · 提交中：缓存里的 commentsLocked 已经是新值（开关、说明、输入框同时变）；
 *   · 失败：整份 photo 快照换回去 —— 只翻布尔值会把别处刚改过的字段一起弄丢；
 *   · 成功：以服务端返回值为准（两人同时操作时，输的一方要看到真正的状态）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
import type { Comment, Photo } from '@/domain/types'

const h = vi.hoisted(() => ({
  photo: { value: null as Photo | null },
  session: { value: { userId: 'u-author', username: 'author', role: 'user' } as Record<string, unknown> | null },
  list: vi.fn(),
  setLocked: vi.fn(),
  photoGet: vi.fn(),
}))

vi.mock('@/data', () => ({
  dataSource: () => 'mock',
  createRepositories: () => ({
    comments: {
      list: h.list,
      create: vi.fn(),
      softRemove: vi.fn(),
      setLocked: h.setLocked,
    },
    photos: { get: h.photoGet },
    // PhotoThumb 会去 storage 取图；测试里没有真图，抛错让它回退占位块
    storage: { get: () => Promise.reject(new Error('missing image')) },
    interactions: {
      getLikeState: () => Promise.resolve(false),
      getFavoriteState: () => Promise.resolve(false),
    },
  }),
}))

vi.mock('@/hooks/usePhotos', () => ({
  usePhoto: () => ({ data: h.photo.value, isLoading: false, isError: false, error: null }),
  useRelatedPhotos: () => ({ data: [], isLoading: false, error: null }),
  useMorePhotosByAuthor: () => ({ data: [], isLoading: false, error: null }),
  useWithdrawPhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ data: h.session.value, isLoading: false }),
  useProfile: () => ({ data: null }),
}))

// 详情页里与评论无关的块：都换成空壳，只留评论区参与渲染
vi.mock('@/features/photos/PhotoGrid', () => ({ PhotoGrid: () => null }))
vi.mock('@/features/photos/ShareButton', () => ({ ShareButton: () => null }))
vi.mock('@/features/interactions/LikeFavoriteButtons', () => ({
  LikeButton: () => null,
  FavoriteButton: () => null,
}))
vi.mock('@/features/moderation/WorkMoreMenu', () => ({ WorkMoreMenu: () => null }))
vi.mock('@/features/collections/AddToCollectionDialog', () => ({ AddToCollectionDialog: () => null }))
vi.mock('@/features/profiles/AuthorLink', () => ({ AuthorLink: () => null }))

const { useSetCommentsLocked } = await import('@/hooks/useInteractions')
const { queryKeys } = await import('@/hooks/queryKeys')
const { WorkDetailPage } = await import('@/pages/WorkDetailPage')
const { ToastProvider } = await import('@/components/ui/ToastProvider')

const KEY = queryKeys.photo('p-1')

function photo(overrides: Partial<Photo> = {}): Photo {
  return {
    id: 'p-1',
    authorId: 'u-author',
    title: '山间晨雾',
    description: '清晨的山脊',
    categorySlug: 'landscape',
    tags: [],
    locationName: '黄山',
    locationLat: null,
    locationLng: null,
    locationPrecision: 'city',
    shotAt: null,
    exif: null,
    imageKey: 'k',
    thumbKey: 't',
    width: 1600,
    height: 1067,
    blurhash: null,
    license: 'all_rights_reserved',
    credit: null,
    status: 'published',
    likeCount: 3,
    favoriteCount: 1,
    commentCount: 0,
    viewCount: 10,
    publishedAt: '2026-02-01T00:00:00.000Z',
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function wrapperFor(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

/** 手动控制 resolve/reject 的时刻，好在「提交中」那一瞬间断言缓存 */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  h.list.mockReset().mockResolvedValue({ items: [] as Comment[], nextCursor: null, total: 0 })
  h.setLocked.mockReset()
  h.photoGet.mockReset()
  h.photo.value = photo()
  h.session.value = { userId: 'u-author', username: 'author', role: 'user' }
})

describe('useSetCommentsLocked', () => {
  it('提交中先改缓存（开关与说明文案立刻一致）', async () => {
    const queryClient = makeClient()
    const original = photo({ commentsLocked: false })
    queryClient.setQueryData(KEY, original)
    const gate = deferred<{ photoId: string; commentsLocked: boolean }>()
    h.setLocked.mockReturnValue(gate.promise)

    const { result } = renderHook(() => useSetCommentsLocked('p-1'), {
      wrapper: wrapperFor(queryClient),
    })

    act(() => {
      result.current.mutate(true)
    })

    await waitFor(() => {
      expect(queryClient.getQueryData<Photo>(KEY)?.commentsLocked).toBe(true)
    })
    // 其他字段没被动过
    expect(queryClient.getQueryData<Photo>(KEY)?.title).toBe('山间晨雾')

    gate.resolve({ photoId: 'p-1', commentsLocked: true })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
  })

  it('失败时整份快照回滚（不是只翻布尔值）', async () => {
    const queryClient = makeClient()
    const original = photo({ commentsLocked: false, title: '山间晨雾' })
    queryClient.setQueryData(KEY, original)
    const gate = deferred<{ photoId: string; commentsLocked: boolean }>()
    h.setLocked.mockReturnValue(gate.promise)

    const { result } = renderHook(() => useSetCommentsLocked('p-1'), {
      wrapper: wrapperFor(queryClient),
    })

    act(() => {
      result.current.mutate(true)
    })
    await waitFor(() => {
      expect(queryClient.getQueryData<Photo>(KEY)?.commentsLocked).toBe(true)
    })

    gate.reject(new Error('网络异常'))
    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    const after = queryClient.getQueryData<Photo>(KEY)
    expect(after).toEqual(original)
    expect(after?.commentsLocked).toBe(false)
  })

  it('成功时以服务端返回值为准（并发下别人先改了，要显示真实状态）', async () => {
    const queryClient = makeClient()
    queryClient.setQueryData(KEY, photo({ commentsLocked: false }))
    // 我们请求 lock=true，但服务端说最终是 false（同一作者的另一个标签页刚打开）
    h.setLocked.mockResolvedValue({ photoId: 'p-1', commentsLocked: false })

    const { result } = renderHook(() => useSetCommentsLocked('p-1'), {
      wrapper: wrapperFor(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync(true)
    })

    expect(queryClient.getQueryData<Photo>(KEY)?.commentsLocked).toBe(false)
  })
})

describe('作品详情页接线', () => {
  function renderDetail() {
    const queryClient = makeClient()
    queryClient.setQueryData(KEY, h.photo.value)
    return render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/works/p-1']}>
            <Routes>
              <Route path="/works/:id" element={<WorkDetailPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )
  }

  it('作品锁了评论：详情页显示一句话且没有输入框', () => {
    h.photo.value = photo({ commentsLocked: true })
    renderDetail()

    expect(screen.getByText('作者已关闭这件作品的评论')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('作者打开自己的作品：评论区标题右侧有「允许评论」开关', () => {
    h.photo.value = photo({ commentsLocked: false })
    renderDetail()

    expect(screen.getByRole('checkbox', { name: /允许评论/ })).toBeChecked()
    expect(screen.getByLabelText('发表评论')).toBeInTheDocument()
  })

  it('他人看同一件作品：没有开关，但有输入框', () => {
    h.photo.value = photo({ commentsLocked: false })
    h.session.value = { userId: 'u-visitor', username: 'visitor', role: 'user' }
    renderDetail()

    expect(screen.queryByRole('checkbox', { name: /允许评论/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('发表评论')).toBeInTheDocument()
  })
})
