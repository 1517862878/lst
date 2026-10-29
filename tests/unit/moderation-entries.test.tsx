/**
 * 举报入口（8.2）：作品更多菜单、评论操作区、个人主页更多菜单。
 *
 * 三条入口共用 useReportRequest —— 所以这里重点验证「谁看得见入口、点了会怎样」：
 * 本人内容不显示举报（后端也会拒，但前端不该先给一个必然失败的按钮），
 * 游客点举报先去登录并带回跳地址，登录用户直接开对话框。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { Comment } from '@/domain/types'

const h = vi.hoisted(() => ({
  session: { value: { userId: 'u-me', username: 'me', role: 'user' } as Record<string, unknown> | null },
  comments: { value: [] as Comment[] },
  submitReport: vi.fn(),
}))

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ data: h.session.value, isLoading: false }),
  useProfile: () => ({ data: { displayName: '路人甲', username: 'other' } }),
}))

vi.mock('@/hooks/useInteractions', () => ({
  useComments: () => ({ data: { items: h.comments.value }, isLoading: false, error: null }),
  usePostComment: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/useModeration', () => ({
  useSubmitReport: () => ({ mutateAsync: h.submitReport, isPending: false, reset: vi.fn() }),
}))

vi.mock('@/hooks/useSocial', () => ({
  useBlockUser: () => ({ mutate: vi.fn(), isPending: false }),
}))

// 个人主页菜单里拉黑成功会弹 toast；这里不关心提示本身，只要 hook 可用
vi.mock('@/components/ui/useToast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

const { WorkMoreMenu } = await import('@/features/moderation/WorkMoreMenu')
const { CommentSection } = await import('@/features/interactions/CommentSection')
const { ProfileMoreMenu } = await import('@/features/social/ProfileMoreMenu')

function LoginProbe() {
  const location = useLocation()
  return <div>登录页{location.search}</div>
}

function renderAt(ui: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/works/p-1']}>
      <Routes>
        <Route path="/works/:id" element={ui} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

const NOW = '2026-02-10T12:00:00.000Z'

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c-1',
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
  h.session.value = { userId: 'u-me', username: 'me', role: 'user' }
  h.comments.value = []
  h.submitReport.mockReset()
})

describe('作品更多菜单', () => {
  it('作者本人看不到举报入口', () => {
    renderAt(<WorkMoreMenu photoId="p-1" title="山间晨雾" isAuthor />)
    expect(screen.queryByRole('button', { name: '作品更多操作' })).not.toBeInTheDocument()
  })

  it('他人作品：打开菜单 → 举报 → 弹出举报对话框', async () => {
    const user = userEvent.setup()
    renderAt(<WorkMoreMenu photoId="p-1" title="山间晨雾" isAuthor={false} />)

    await user.click(screen.getByRole('button', { name: '作品更多操作' }))
    expect(screen.getByRole('menuitem', { name: '举报该作品' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: '举报该作品' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: '举报作品《山间晨雾》' })).toBeInTheDocument()
  })

  it('游客点举报：先跳登录并带上回跳地址', async () => {
    h.session.value = null
    const user = userEvent.setup()
    renderAt(<WorkMoreMenu photoId="p-1" title="山间晨雾" isAuthor={false} />)

    await user.click(screen.getByRole('button', { name: '作品更多操作' }))
    await user.click(screen.getByRole('menuitem', { name: '举报该作品' }))

    expect(await screen.findByText(/登录页/)).toHaveTextContent(
      `登录页?next=${encodeURIComponent('/works/p-1')}`,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Esc 关闭菜单并把焦点还给触发按钮', async () => {
    const user = userEvent.setup()
    renderAt(<WorkMoreMenu photoId="p-1" title="山间晨雾" isAuthor={false} />)

    const trigger = screen.getByRole('button', { name: '作品更多操作' })
    await user.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})

describe('评论操作区', () => {
  it('别人的评论有举报按钮，自己的没有', () => {
    h.comments.value = [
      comment({ id: 'c-other' }),
      comment({ id: 'c-mine', authorId: 'u-me' }),
    ]
    renderAt(<CommentSection photoId="p-1" currentUserId="u-me" />)

    const items = screen.getAllByRole('listitem')
    expect(within(items[0]!).getByRole('button', { name: '举报这条评论' })).toBeInTheDocument()
    expect(within(items[1]!).queryByRole('button', { name: '举报这条评论' })).not.toBeInTheDocument()
  })

  it('回复同样只对他人内容显示举报', () => {
    h.comments.value = [
      comment({ id: 'c-root' }),
      comment({ id: 'c-reply', parentId: 'c-root', authorId: 'u-me', body: '谢谢' }),
    ]
    renderAt(<CommentSection photoId="p-1" currentUserId="u-me" />)

    expect(screen.queryByRole('button', { name: '举报这条回复' })).not.toBeInTheDocument()
  })

  it('点举报打开评论举报对话框', async () => {
    h.comments.value = [comment()]
    const user = userEvent.setup()
    renderAt(<CommentSection photoId="p-1" currentUserId="u-me" />)

    await user.click(screen.getByRole('button', { name: '举报这条评论' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: '举报评论' })).toBeInTheDocument()
  })
})

describe('个人主页更多菜单', () => {
  it('他人主页可举报：菜单项 → 举报用户对话框', async () => {
    const user = userEvent.setup()
    renderAt(
      <ProfileMoreMenu
        username="other"
        profileId="u-other"
        displayName="路人甲"
        onBlocked={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '更多操作' }))
    await user.click(screen.getByRole('menuitem', { name: '举报 @other' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: '举报用户 路人甲' })).toBeInTheDocument()
  })

  it('游客点举报同样先去登录', async () => {
    h.session.value = null
    const user = userEvent.setup()
    renderAt(
      <ProfileMoreMenu username="other" profileId="u-other" displayName="路人甲" onBlocked={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: '更多操作' }))
    await user.click(screen.getByRole('menuitem', { name: '举报 @other' }))

    expect(await screen.findByText(/登录页/)).toHaveTextContent(
      `登录页?next=${encodeURIComponent('/works/p-1')}`,
    )
  })
})
