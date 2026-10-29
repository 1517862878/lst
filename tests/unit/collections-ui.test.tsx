/**
 * 收藏夹 UI 单测（src/pages/CollectionsPage.tsx / CollectionDetailPage.tsx /
 * src/features/collections/AddToCollectionDialog.tsx）。
 *
 * 这三个界面共用一份数据契约（hooks 由另一任务实现），所以 hooks 全部打桩，
 * 只锁「文案 + 交互 + 可见性判定」这三件产品行为：
 *   1) 一个收藏夹都没有时，空态要给出可见的下一步（新建），而不是一片空白；
 *   2) 「加入收藏夹」是点一下就生效的切换，已在夹中的作品要能一键移出；
 *   3) 私密夹对非本人一律不可见（文案与「不存在」保持一致，不泄露存在性）。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { ToastProvider } from '@/components/ui/ToastProvider'

const mocks = vi.hoisted(() => ({
  myCollections: {} as Record<string, unknown>,
  userCollections: {} as Record<string, unknown>,
  collection: {} as Record<string, unknown>,
  items: {} as Record<string, unknown>,
  session: { data: null as unknown, isLoading: false },
  update: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  addItem: vi.fn(),
  removeItem: vi.fn(),
  refetch: vi.fn(),
}))

vi.mock('@/hooks/useCollections', () => ({
  useMyCollections: () => mocks.myCollections,
  useUserCollections: () => mocks.userCollections,
  useCollection: () => mocks.collection,
  useCollectionItems: () => mocks.items,
  useCreateCollection: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateCollection: () => ({ mutateAsync: mocks.update, isPending: false }),
  useDeleteCollection: () => ({ mutateAsync: mocks.remove, isPending: false }),
  useAddCollectionItem: () => ({ mutateAsync: mocks.addItem, isPending: false }),
  useRemoveCollectionItem: () => ({ mutateAsync: mocks.removeItem, isPending: false }),
}))

vi.mock('@/hooks/useSession', () => ({
  useSession: () => mocks.session,
  useProfileByUsername: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
}))

// 封面走 storage 取 Blob URL；jsdom 里没有 storage，直接给「没有封面」的分支。
vi.mock('@/hooks/usePhotoImage', () => ({
  usePhotoImage: () => ({ url: null, loading: false }),
}))

const { CollectionsPage } = await import('@/pages/CollectionsPage')
const { CollectionDetailPage } = await import('@/pages/CollectionDetailPage')
const { AddToCollectionDialog } = await import('@/features/collections/AddToCollectionDialog')

const SESSION = {
  userId: 'u-alice',
  username: 'alice',
  displayName: 'Alice',
  avatarKey: null,
  role: 'user',
  expiresAt: '2099-01-01T00:00:00.000Z',
}

function listQuery(data: unknown) {
  return { data, isLoading: false, isError: false, error: undefined, refetch: mocks.refetch }
}

function collection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    title: '城市夜景',
    description: '夜里十一点之后的街道',
    visibility: 'public',
    itemCount: 12,
    ...overrides,
  }
}

function renderInRouter(ui: ReactNode) {
  return render(
    <ToastProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </ToastProvider>,
  )
}

beforeEach(() => {
  mocks.session = { data: SESSION, isLoading: false }
  mocks.myCollections = listQuery([])
  mocks.userCollections = listQuery([])
  mocks.collection = { data: undefined, isLoading: false, isError: false, error: undefined, refetch: mocks.refetch }
  mocks.items = {
    data: { pages: [{ items: [], nextCursor: null }] },
    isLoading: false,
    isError: false,
    error: undefined,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: mocks.refetch,
  }
  mocks.update.mockReset().mockResolvedValue({})
  mocks.create.mockReset().mockResolvedValue({})
  mocks.remove.mockReset().mockResolvedValue({})
  mocks.addItem.mockReset().mockResolvedValue({})
  mocks.removeItem.mockReset().mockResolvedValue({})
  mocks.refetch.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('CollectionsPage', () => {
  it('一个收藏夹都没有时：展示空态，点新建后出现表单且默认「仅自己可见」', async () => {
    const user = userEvent.setup()
    renderInRouter(<CollectionsPage />)

    expect(await screen.findByText('还没有收藏夹')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '新建收藏夹' }))

    expect(screen.getByLabelText(/^标题/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^简介/)).toBeInTheDocument()
    // 默认私密：收藏夹常混着私人整理，默认公开属于隐私事故。
    expect(screen.getByRole('radio', { name: /仅自己可见/ })).toBeChecked()
    expect(screen.queryByRole('radio', { name: /^公开/ })).not.toBeChecked()
  })

  it('标题为空时不发请求，并就地提示需要 1–40 个字', async () => {
    const user = userEvent.setup()
    renderInRouter(<CollectionsPage />)
    await user.click(screen.getByRole('button', { name: '新建收藏夹' }))
    await user.click(screen.getByRole('button', { name: '创建收藏夹' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('标题需要 1–40 个字')
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

describe('AddToCollectionDialog', () => {
  it('点击切换加入/移出：入参正确，按钮状态跟着翻转', async () => {
    mocks.myCollections = listQuery([
      collection({ id: 'c-1', title: '城市夜景', containsPhoto: true, itemCount: 12 }),
      collection({ id: 'c-2', title: '山野', visibility: 'private', containsPhoto: false, itemCount: 3 }),
    ])
    const user = userEvent.setup()
    renderInRouter(
      <AddToCollectionDialog
        open
        onOpenChange={() => {}}
        photoId="p-1"
        photoTitle="外滩"
        memberCollectionIds={['c-1']}
      />,
    )

    const joined = await screen.findByRole('button', { name: /城市夜景/ })
    expect(joined).toHaveAttribute('aria-pressed', 'true')

    await user.click(joined)
    await waitFor(() =>
      expect(mocks.removeItem).toHaveBeenCalledWith({ collectionId: 'c-1', photoId: 'p-1' }),
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /城市夜景/ })).toHaveAttribute('aria-pressed', 'false'),
    )

    const notJoined = screen.getByRole('button', { name: /山野/ })
    expect(notJoined).toHaveAttribute('aria-pressed', 'false')
    await user.click(notJoined)
    await waitFor(() =>
      expect(mocks.addItem).toHaveBeenCalledWith({ collectionId: 'c-2', photoId: 'p-1' }),
    )
    expect(mocks.removeItem).toHaveBeenCalledTimes(1)
  })
})

describe('CollectionDetailPage', () => {
  function renderDetail(id = 'c-9') {
    return render(
      <ToastProvider>
        <MemoryRouter initialEntries={[`/c/${id}`]}>
          <Routes>
            <Route path="/c/:id" element={<CollectionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    )
  }

  it('私密夹非本人访问：只看到「不存在或不可见」，不渲染标题与作者', async () => {
    mocks.collection = {
      data: collection({ id: 'c-9', title: '私藏', visibility: 'private', ownerUsername: 'bob', itemCount: 4 }),
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mocks.refetch,
    }
    renderDetail()

    expect(await screen.findByText('这个收藏夹不存在或不可见')).toBeInTheDocument()
    expect(screen.queryByText('私藏')).toBeNull()
    expect(screen.queryByRole('link', { name: '@bob' })).toBeNull()
  })

  it('本人访问私密夹：正常渲染标题、作者链接与「只有你自己能看到」提示', async () => {
    mocks.session = { data: { ...SESSION, username: 'bob' }, isLoading: false }
    mocks.collection = {
      data: collection({ id: 'c-9', title: '私藏', visibility: 'private', ownerUsername: 'bob', itemCount: 4 }),
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mocks.refetch,
    }
    renderDetail()

    expect(await screen.findByRole('heading', { name: '私藏' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '@bob' })).toHaveAttribute('href', '/u/bob')
    expect(screen.getByText('只有你自己能看到这个收藏夹')).toBeInTheDocument()
    expect(screen.queryByText('这个收藏夹不存在或不可见')).toBeNull()
  })
})
