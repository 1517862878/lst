/**
 * 关注按钮单测（src/features/social/FollowButton.tsx）。
 *
 * 三条产品规则各自对应一组断言：
 *  1. 本人主页不渲染按钮；
 *  2. 游客点关注 = 跳登录并带上回跳地址（不是 disabled）；
 *  3. pending 期间按钮显示**目标状态**，点完立刻变「已关注」。
 *
 * 会话与 hooks 都桩掉：这里测的是按钮自己的分支，不是 react-query 的缓存行为
 * （缓存写回在 useSocial.ts 里，由 api/mock 仓储测试与 E2E 兜）。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError, ErrorCodes } from '@/data/contracts'
import type { Session } from '@/domain/types'
import { ToastProvider } from '@/components/ui/ToastProvider'
import { FollowButton } from '@/features/social/FollowButton'

const mocks = vi.hoisted(() => ({
  session: { value: null as Session | null },
  following: { value: false },
  pending: { value: false },
  variables: { value: undefined as boolean | undefined },
  mutate: vi.fn(),
}))

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ data: mocks.session.value }),
}))

vi.mock('@/hooks/useSocial', () => ({
  useFollowState: () => ({ data: mocks.following.value }),
  useToggleFollow: () => ({
    mutate: mocks.mutate,
    isPending: mocks.pending.value,
    variables: mocks.variables.value,
  }),
}))

const session: Session = {
  userId: 'u-me',
  username: 'me',
  displayName: '我',
  avatarKey: null,
  role: 'user',
  expiresAt: '2099-01-01T00:00:00.000Z',
}

/** 把当前 location 渲染出来，才能断言「回跳到原页」带上了正确的 next */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function renderButton(props: { username?: string; isSelf?: boolean } = {}) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/u/alice?tab=works']}>
        <Routes>
          <Route
            path="/u/:username"
            element={<FollowButton username={props.username ?? 'alice'} isSelf={props.isSelf ?? false} />}
          />
          <Route path="/login" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
}

beforeEach(() => {
  mocks.session.value = session
  mocks.following.value = false
  mocks.pending.value = false
  mocks.variables.value = undefined
  mocks.mutate.mockReset()
})

afterEach(cleanup)

describe('FollowButton', () => {
  it('本人主页不渲染按钮', () => {
    renderButton({ isSelf: true })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('未关注时显示「关注」且 aria-pressed=false', () => {
    renderButton()
    const button = screen.getByRole('button', { name: '关注' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
  })

  it('已关注时显示「已关注」且 aria-pressed=true', () => {
    mocks.following.value = true
    renderButton()
    const button = screen.getByRole('button', { name: '已关注' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('游客点击跳登录，并带上当前页作为 next（不是 disabled 按钮）', async () => {
    const user = userEvent.setup()
    mocks.session.value = null
    renderButton()

    const button = screen.getByRole('button', { name: '关注' })
    expect(button).toBeEnabled()
    await user.click(button)

    // 未登录不该发关注请求
    expect(mocks.mutate).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/login?next=%2Fu%2Falice%3Ftab%3Dworks'),
    )
  })

  it('登录用户点击取反：未关注 → follow(true)', async () => {
    const user = userEvent.setup()
    renderButton()
    await user.click(screen.getByRole('button', { name: '关注' }))
    expect(mocks.mutate).toHaveBeenCalledWith(true, expect.anything())
  })

  it('登录用户点击取反：已关注 → unfollow(false)', async () => {
    const user = userEvent.setup()
    mocks.following.value = true
    renderButton()
    await user.click(screen.getByRole('button', { name: '已关注' }))
    expect(mocks.mutate).toHaveBeenCalledWith(false, expect.anything())
  })

  it('pending 期间显示目标状态（点完立刻变「已关注」，避免用户反复点）', () => {
    mocks.pending.value = true
    mocks.variables.value = true
    renderButton()
    expect(screen.getByRole('button', { name: '已关注' })).toBeInTheDocument()
  })

  it('pending 期间取关显示目标状态「关注」', () => {
    mocks.following.value = true
    mocks.pending.value = true
    mocks.variables.value = false
    renderButton()
    expect(screen.getByRole('button', { name: '关注' })).toBeInTheDocument()
  })

  it('成功后有反馈 toast，失败时用 AppError 的文案', async () => {
    const user = userEvent.setup()
    renderButton()
    mocks.mutate.mockImplementation((_next: boolean, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.()
    })
    await user.click(screen.getByRole('button', { name: '关注' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已关注 @alice')

    cleanup()
    renderButton()
    mocks.mutate.mockImplementation(
      (_next: boolean, options?: { onError?: (error: unknown) => void }) => {
        options?.onError?.(new AppError(ErrorCodes.CONFLICT, '操作太频繁，请稍后再试'))
      },
    )
    await user.click(screen.getByRole('button', { name: '关注' }))
    expect(await screen.findByRole('status')).toHaveTextContent('操作太频繁，请稍后再试')
  })
})
