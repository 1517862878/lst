/**
 * 评论区治理 UI（8.4b）。
 *
 * 验证四件事都真的发生在用户看得见的地方：
 *   ① 锁定态：一句「作者已关闭这件作品的评论」，**没有**输入框；
 *   ② 作者开关：只有作者看得见，点一下调的是 setLocked；
 *   ③ 排序：?commentSort= 只改自己这一个键，?season= / ?sort= 原样保留；
 *   ④ 删除：评论作者删自己的、作品作者删他人评论，其中「删他人」只能作者用，且都要确认。
 * 数据层只做桩：这里关心的是「谁看得见什么、点了会发什么请求」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { Comment } from '@/domain/types'

const h = vi.hoisted(() => ({
  comments: { value: [] as Comment[] },
  total: { value: 0 },
  sortCalls: { value: [] as string[] },
  post: vi.fn(),
  remove: vi.fn(),
  lock: vi.fn(),
  report: vi.fn(),
}))

vi.mock('@/hooks/useSession', () => ({
  useProfile: () => ({ data: { displayName: '路人甲', username: 'other' } }),
}))

vi.mock('@/hooks/useInteractions', () => ({
  useComments: (_photoId: string, sort: string) => {
    h.sortCalls.value.push(sort)
    return {
      data: { items: h.comments.value, total: h.total.value },
      isLoading: false,
      error: null,
    }
  },
  usePostComment: () => ({ mutate: h.post, isPending: false }),
  useDeleteComment: () => ({ mutate: h.remove, isPending: false }),
  useSetCommentsLocked: () => ({ mutate: h.lock, isPending: false }),
}))

vi.mock('@/features/moderation/useReportRequest', () => ({
  useReportRequest: () => ({ target: null, request: h.report, close: vi.fn() }),
}))

const { CommentSection } = await import('@/features/interactions/CommentSection')

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="search">{location.search}</output>
}

function renderSection(props: {
  currentUserId?: string | null
  isAuthor?: boolean
  commentsLocked?: boolean
}) {
  const { currentUserId = 'u-me', isAuthor = false, commentsLocked = false } = props
  return render(
    <MemoryRouter initialEntries={['/works/p-1?season=autumn&sort=popular']}>
      <Routes>
        <Route
          path="/works/:id"
          element={
            <>
              <CommentSection
                photoId="p-1"
                currentUserId={currentUserId}
                isAuthor={isAuthor}
                commentsLocked={commentsLocked}
              />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

const NOW = '2026-02-10T12:00:00.000Z'

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c-other',
    photoId: 'p-1',
    authorId: 'u-other',
    parentId: null,
    body: '拍得真好',
    status: 'visible',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.comments.value = []
  h.total.value = 0
  h.sortCalls.value = []
  h.post.mockReset()
  h.remove.mockReset()
  h.lock.mockReset()
  h.report.mockReset()
})

describe('锁定态', () => {
  it('显示作者已关闭评论，且完全不渲染输入控件', () => {
    h.comments.value = [comment()]

    renderSection({ commentsLocked: true })

    expect(screen.getByText('作者已关闭这件作品的评论')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '发表评论' })).not.toBeInTheDocument()
    expect(screen.queryByText(/请先.*再评论/)).not.toBeInTheDocument()
  })

  it('关评论不等于删评论：已有评论照常可读', () => {
    h.comments.value = [comment()]
    renderSection({ commentsLocked: true })
    expect(screen.getByText('拍得真好')).toBeInTheDocument()
  })

  it('锁定态也不给回复按钮（免得点开一个没有输入框的死路）', () => {
    h.comments.value = [comment()]
    renderSection({ commentsLocked: true })
    expect(screen.queryByRole('button', { name: '回复' })).not.toBeInTheDocument()
  })

  it('未锁定时输入框照常出现', () => {
    renderSection({})
    expect(screen.getByLabelText('发表评论')).toBeInTheDocument()
    expect(screen.queryByText('作者已关闭这件作品的评论')).not.toBeInTheDocument()
  })

  it('游客未锁：给登录引导而不是输入框（既有行为不变）', () => {
    renderSection({ currentUserId: null })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '登录' })).toBeInTheDocument()
  })
})

describe('作者开关', () => {
  it('只有作者看得见「允许评论」', () => {
    h.comments.value = [comment()]
    renderSection({ isAuthor: false })
    expect(screen.queryByRole('checkbox', { name: /允许评论/ })).not.toBeInTheDocument()
  })

  it('作者关掉评论：调 setLocked(true)', async () => {
    const user = userEvent.setup()
    renderSection({ isAuthor: true })

    const toggle = screen.getByRole('checkbox', { name: /允许评论/ })
    expect(toggle).toBeChecked()

    await user.click(toggle)
    expect(h.lock).toHaveBeenCalledWith(true, expect.anything())
  })

  it('已锁定时开关为未选中，再打开调 setLocked(false)', async () => {
    const user = userEvent.setup()
    renderSection({ isAuthor: true, commentsLocked: true })

    const toggle = screen.getByRole('checkbox', { name: /允许评论/ })
    expect(toggle).not.toBeChecked()

    await user.click(toggle)
    expect(h.lock).toHaveBeenCalledWith(false, expect.anything())
  })

  it('开关失败时把后端文案显示出来（乐观更新已回滚，这里补一句解释）', async () => {
    const user = userEvent.setup()
    // 模拟 mutate 触发 onError：真实 hook 会先把 photo 缓存回滚，组件只负责报错
    h.lock.mockImplementation((_next: boolean, options?: { onError?: (err: Error) => void }) => {
      options?.onError?.(new Error('只有作品作者可以关闭评论'))
    })
    renderSection({ isAuthor: true })

    await user.click(screen.getByRole('checkbox', { name: /允许评论/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('只有作品作者可以关闭评论')
  })
})

describe('排序切换', () => {
  it('默认最新：不写进 URL，其他参数不受影响', () => {
    renderSection({})
    const search = screen.getByTestId('search').textContent ?? ''
    expect(search).toContain('season=autumn')
    expect(search).toContain('sort=popular')
    expect(search).not.toContain('commentSort')
    expect(screen.getByRole('button', { name: '最新' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('点「最早」写入 ?commentSort=oldest，?season= 与 ?sort= 原样保留', async () => {
    const user = userEvent.setup()
    renderSection({})

    await user.click(screen.getByRole('button', { name: '最早' }))

    const search = screen.getByTestId('search').textContent ?? ''
    expect(search).toContain('commentSort=oldest')
    expect(search).toContain('season=autumn')
    expect(search).toContain('sort=popular')
    expect(screen.getByRole('button', { name: '最早' })).toHaveAttribute('aria-pressed', 'true')
    // 排序真的传给了数据层，而不是只改了 URL
    expect(h.sortCalls.value.at(-1)).toBe('oldest')
  })

  it('切回「最新」把参数删掉，而不是写 latest', async () => {
    const user = userEvent.setup()
    renderSection({})

    await user.click(screen.getByRole('button', { name: '最早' }))
    await user.click(screen.getByRole('button', { name: '最新' }))

    const search = screen.getByTestId('search').textContent ?? ''
    expect(search).not.toContain('commentSort')
    expect(search).toContain('season=autumn')
    expect(h.sortCalls.value.at(-1)).toBe('latest')
  })
})

describe('提交被 409 拒绝', () => {
  it('别人在另一个标签页刚关掉评论：把后端文案原样显示，不吞成「发表失败」', async () => {
    const user = userEvent.setup()
    // 页面还以为是开着的（本地缓存滞后），服务端按新状态 409
    h.post.mockImplementation(
      (_vars: unknown, options?: { onError?: (err: Error) => void }) => {
        options?.onError?.(new Error('作者已关闭这件作品的评论'))
      },
    )
    renderSection({})

    await user.type(screen.getByLabelText('发表评论'), '还能说话吗')
    await user.click(screen.getByRole('button', { name: '发表评论' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('作者已关闭这件作品的评论')
  })
})

describe('删除按钮', () => {
  it('普通用户只能删自己的：自己的有按钮，别人的没有', () => {
    h.comments.value = [
      comment({ id: 'c-other', authorId: 'u-other' }),
      comment({ id: 'c-mine', authorId: 'u-me', body: '谢谢' }),
    ]
    renderSection({ currentUserId: 'u-me' })

    expect(screen.getAllByRole('button', { name: '删除这条评论' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '删除他人评论（作品作者）' })).not.toBeInTheDocument()
  })

  it('作品作者在他人评论上也有删除按钮（文案区分身份）', () => {
    h.comments.value = [comment({ id: 'c-other', authorId: 'u-other' })]
    renderSection({ currentUserId: 'u-author', isAuthor: true })

    expect(screen.getByRole('button', { name: '删除他人评论（作品作者）' })).toBeInTheDocument()
  })

  it('游客看不到任何删除按钮', () => {
    h.comments.value = [comment({ id: 'c-other', authorId: 'u-other' })]
    renderSection({ currentUserId: null })
    expect(screen.queryByText('删除')).not.toBeInTheDocument()
  })

  it('删除要二次确认：取消不发请求', async () => {
    h.comments.value = [comment({ id: 'c-mine', authorId: 'u-me' })]
    const user = userEvent.setup()
    renderSection({ currentUserId: 'u-me' })

    await user.click(screen.getByRole('button', { name: '删除这条评论' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: '删除这条评论？' })).toBeInTheDocument()
    // 弹窗里带一句评论原文，避免删错人
    expect(within(dialog).getByText('拍得真好')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(h.remove).not.toHaveBeenCalled()
  })

  it('确认后调 softRemove（评论 id）', async () => {
    h.comments.value = [comment({ id: 'c-mine', authorId: 'u-me' })]
    const user = userEvent.setup()
    renderSection({ currentUserId: 'u-me' })

    await user.click(screen.getByRole('button', { name: '删除这条评论' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '确认删除' }))

    expect(h.remove).toHaveBeenCalledWith('c-mine', expect.anything())
  })

  it('回复也能删，文案按身份区分', () => {
    h.comments.value = [
      comment({ id: 'c-root', authorId: 'u-me' }),
      comment({ id: 'c-reply', parentId: 'c-root', authorId: 'u-me', body: '补充一句' }),
    ]
    renderSection({ currentUserId: 'u-me' })

    expect(screen.getByRole('button', { name: '删除这条回复' })).toBeInTheDocument()
  })

  it('作者删他人回复：只出现在作者视角', () => {
    h.comments.value = [
      comment({ id: 'c-root', authorId: 'u-author' }),
      comment({ id: 'c-reply', parentId: 'c-root', authorId: 'u-other', body: '路过' }),
    ]
    renderSection({ currentUserId: 'u-author', isAuthor: true })

    expect(screen.getByRole('button', { name: '删除他人回复（作品作者）' })).toBeInTheDocument()
  })
})
