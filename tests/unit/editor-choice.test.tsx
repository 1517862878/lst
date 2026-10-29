/**
 * 「编辑精选」写操作单测（8.3c）。
 *
 * 两件事必须锁死：
 *   1. useSetEditorChoice 的乐观更新与失败回滚（缓存里的 featuredAt 立刻变，
 *      请求失败后必须原样还原，不能留下「界面说已精选、数据库说没有」的假象）；
 *   2. WorkMoreMenu 的菜单项只给 staff 看，文案随当前状态切换。
 */
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Photo } from '@/domain/types'

const h = vi.hoisted(() => ({
  setEditorChoice: vi.fn(),
  session: { data: { role: 'editor' } as { role: string } | null | undefined },
  toast: { show: vi.fn() },
  mutate: vi.fn(),
}))

vi.mock('@/data', () => ({
  createRepositories: () => ({
    discover: { setEditorChoice: h.setEditorChoice },
  }),
}))

vi.mock('@/hooks/useSession', () => ({ useSession: () => h.session }))
vi.mock('@/components/ui/useToast', () => ({ useToast: () => h.toast }))
vi.mock('@/features/moderation/useReportRequest', () => ({
  useReportRequest: () => ({ target: null, request: vi.fn(), close: vi.fn() }),
}))
vi.mock('@/features/moderation/ReportDialog', () => ({ ReportDialog: () => null }))

const { useSetEditorChoice } = await import('@/hooks/useDiscover')
const { WorkMoreMenu } = await import('@/features/moderation/WorkMoreMenu')
const { queryKeys } = await import('@/hooks/queryKeys')

function photo(): Photo {
  return {
    id: 'p1',
    authorId: 'u1',
    title: '晨雾',
    description: '',
    categorySlug: 'landscape',
    tags: [],
    locationName: '',
    locationLat: null,
    locationLng: null,
    locationPrecision: 'city',
    shotAt: null,
    exif: null,
    imageKey: 'p1.jpg',
    thumbKey: 'p1-thumb.jpg',
    width: 1600,
    height: 1067,
    blurhash: null,
    license: 'cc_by',
    credit: null,
    status: 'published',
    likeCount: 0,
    favoriteCount: 0,
    commentCount: 0,
    viewCount: 0,
    publishedAt: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    featuredAt: null,
  }
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useSetEditorChoice', () => {
  it('成功时先乐观写入 featuredAt，再失效精选列表缓存', async () => {
    h.setEditorChoice.mockReset()
    let resolve: (value: { photoId: string; featuredAt: string | null }) => void = () => undefined
    h.setEditorChoice.mockImplementation(
      () => new Promise((done) => { resolve = done as typeof resolve }),
    )
    const { client, wrapper } = setup()
    client.setQueryData(queryKeys.photo('p1'), photo())
    const { result } = renderHook(() => useSetEditorChoice('p1'), { wrapper })

    act(() => result.current.mutate(true))
    await waitFor(() =>
      expect(client.getQueryData<Photo>(queryKeys.photo('p1'))?.featuredAt).toBeTruthy(),
    )

    await act(async () => {
      resolve({ photoId: 'p1', featuredAt: new Date().toISOString() })
    })
    expect(h.setEditorChoice).toHaveBeenCalledWith('p1', true)
    expect(client.getQueryData<Photo>(queryKeys.photo('p1'))?.featuredAt).toBeTruthy()
  })

  it('失败时把 featuredAt 回滚成原值', async () => {
    h.setEditorChoice.mockReset()
    h.setEditorChoice.mockRejectedValue(new Error('网络抖动'))
    const { client, wrapper } = setup()
    const original = photo()
    client.setQueryData(queryKeys.photo('p1'), original)
    const { result } = renderHook(() => useSetEditorChoice('p1'), { wrapper })

    await act(async () => {
      await expect(result.current.mutateAsync(true)).rejects.toThrow('网络抖动')
    })
    expect(client.getQueryData<Photo>(queryKeys.photo('p1'))?.featuredAt).toBeNull()
  })
})

describe('WorkMoreMenu · 编辑精选菜单项', () => {
  const renderMenu = (featured: boolean) => {
    const { wrapper } = setup()
    return render(
      <MemoryRouter>
        <WorkMoreMenu photoId="p1" title="晨雾" isAuthor={false} featured={featured} />
      </MemoryRouter>,
      { wrapper },
    )
  }

  it('普通用户看不到精选开关', () => {
    h.session.data = { role: 'user' }
    renderMenu(false)
    fireEvent.click(screen.getByRole('button', { name: '作品更多操作' }))
    expect(screen.queryByRole('menuitem', { name: '设为编辑精选' })).toBeNull()
  })

  it('游客看不到精选开关', () => {
    h.session.data = null
    renderMenu(false)
    fireEvent.click(screen.getByRole('button', { name: '作品更多操作' }))
    expect(screen.queryByRole('menuitem', { name: '设为编辑精选' })).toBeNull()
  })

  it('staff 看到「设为编辑精选」，已精选时变为「取消编辑精选」', () => {
    h.session.data = { role: 'editor' }
    const { unmount } = renderMenu(false)
    fireEvent.click(screen.getByRole('button', { name: '作品更多操作' }))
    const set = screen.getByRole('menuitem', { name: '设为编辑精选' })
    expect(set).toHaveAttribute('aria-pressed', 'false')
    unmount()

    renderMenu(true)
    fireEvent.click(screen.getByRole('button', { name: '作品更多操作' }))
    expect(screen.getByRole('menuitem', { name: '取消编辑精选' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
