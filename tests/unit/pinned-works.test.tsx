/**
 * 主页代表作界面（8.4a ④）。
 *
 * /me 的选择器与公开主页的置顶块是一对：
 *   · 选择器最多 3 件、可上移下移、可清空；上移下移用原生 button（键盘可达，不用拖拽）；
 *   · 保存以服务端返回顺序为准（后端会拒掉越权/已撤回的 id）；
 *   · 公开主页未设置时整块不渲染 —— 访客不该看到一个空的「代表作」标题。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/ToastProvider'
import { PinnedShowcase } from '@/features/profiles/PinnedShowcase'
import { PinnedWorksPicker } from '@/features/profiles/PinnedWorksPicker'
import type { Photo, PinnedPhoto } from '@/domain/types'
import { makePhoto } from './fixtures'

const mocks = vi.hoisted(() => ({
  pinnedPhotoIds: [] as string[],
  setPinned: vi.fn(),
}))

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ data: { userId: 'u1', username: 'me', displayName: '我', avatarKey: null, role: 'user', expiresAt: '2099-01-01T00:00:00.000Z' } }),
  useProfileByUsername: () => ({
    data: { id: 'u1', username: 'me', pinnedPhotoIds: mocks.pinnedPhotoIds },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/hooks/usePhotography', () => ({
  useSetPinned: () => ({ mutateAsync: mocks.setPinned, isPending: false }),
}))


function photo(id: string, title: string): Photo {
  return makePhoto(id, { title })
}

const photos = [photo('a', '晨光'), photo('b', '暮色'), photo('c', '雪夜'), photo('d', '街角')]

beforeEach(() => {
  mocks.pinnedPhotoIds = []
  mocks.setPinned.mockReset().mockImplementation((ids: string[]) => Promise.resolve({ pinnedPhotoIds: ids, pinned: [] }))
})

describe('PinnedShowcase（公开主页）', () => {
  function renderShowcase(pinned?: PinnedPhoto[]) {
    return render(
      <MemoryRouter>
        <PinnedShowcase pinned={pinned} />
      </MemoryRouter>,
    )
  }

  it('未设置时整块不渲染', () => {
    const { container } = renderShowcase(undefined)
    expect(container).toBeEmptyDOMElement()
    const { container: empty } = renderShowcase([])
    expect(empty).toBeEmptyDOMElement()
  })

  it('按顺序展示并链到作品页', () => {
    renderShowcase([
      { id: 'b', title: '暮色', thumbKey: '' },
      { id: 'a', title: '晨光', thumbKey: '' },
    ])
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/works/b', '/works/a'])
    expect(screen.getByRole('heading', { level: 2, name: '代表作' })).toBeInTheDocument()
    expect(screen.getByText('作者置顶的 2 件作品')).toBeInTheDocument()
  })
})

describe('PinnedWorksPicker（/me）', () => {
  function renderPicker(list: Photo[] = photos) {
    return render(
      <ToastProvider>
        <MemoryRouter>
          <PinnedWorksPicker photos={list} />
        </MemoryRouter>
      </ToastProvider>,
    )
  }

  it('未选择时给出说明与可添加列表', () => {
    renderPicker()
    expect(screen.getByText(/还没有选代表作/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /把「晨光」设为代表作/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存代表作' })).toBeDisabled()
  })

  it('加满 3 件后再加会提示上限，且不会写入第 4 件', async () => {
    const user = userEvent.setup()
    renderPicker()

    for (const title of ['晨光', '暮色', '雪夜']) {
      await user.click(screen.getByRole('button', { name: `把「${title}」设为代表作` }))
    }
    await user.click(screen.getByRole('button', { name: '把「街角」设为代表作' }))

    expect(screen.getByText(/最多选 3 件代表作/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '把「街角」设为代表作' })).toBeInTheDocument()
    expect(screen.getByText('已选 3/3 件 · 公开主页按此顺序置顶')).toBeInTheDocument()
  })

  it('上移下移改变顺序后保存，按新顺序提交', async () => {
    const user = userEvent.setup()
    mocks.pinnedPhotoIds = ['a', 'b']
    renderPicker()

    await user.click(screen.getByRole('button', { name: '把「暮色」上移' }))
    await user.click(screen.getByRole('button', { name: '保存代表作' }))

    await waitFor(() => expect(mocks.setPinned).toHaveBeenCalledWith(['b', 'a']))
    expect(await screen.findByRole('status')).toHaveTextContent('主页代表作已更新')
  })

  it('首个不能上移、末个不能下移（按钮 disabled 而不是静默无效）', () => {
    mocks.pinnedPhotoIds = ['a', 'b', 'c']
    renderPicker()
    expect(screen.getByRole('button', { name: '把「晨光」上移' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '把「雪夜」下移' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '把「晨光」下移' })).toBeEnabled()
  })

  it('清空后保存提交空数组', async () => {
    const user = userEvent.setup()
    mocks.pinnedPhotoIds = ['a']
    renderPicker()

    await user.click(screen.getByRole('button', { name: '清空' }))
    await user.click(screen.getByRole('button', { name: '保存代表作' }))

    await waitFor(() => expect(mocks.setPinned).toHaveBeenCalledWith([]))
    expect(await screen.findByRole('status')).toHaveTextContent('已清空主页代表作')
  })

  it('保存失败时把后端文案原样提示，不吞掉校验原因', async () => {
    const user = userEvent.setup()
    mocks.setPinned.mockRejectedValueOnce(new Error('代表作最多 3 件，且必须是你自己的在架作品'))
    renderPicker()

    await user.click(screen.getByRole('button', { name: '把「晨光」设为代表作' }))
    await user.click(screen.getByRole('button', { name: '保存代表作' }))

    expect(await screen.findByRole('status')).toHaveTextContent('代表作最多 3 件')
  })

  it('没有作品时给可恢复空态', () => {
    renderPicker([])
    expect(screen.getByText('还没有可设为代表作的作品')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去发布' })).toHaveAttribute('href', '/publish')
  })
})
