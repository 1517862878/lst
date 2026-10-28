import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/ToastProvider'
import { ProfileMoreMenu } from '@/features/social/ProfileMoreMenu'

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), pending: { value: false } }))
vi.mock('@/hooks/useSocial', () => ({ useBlockUser: () => ({ mutateAsync: mocks.mutateAsync, isPending: mocks.pending.value }) }))

beforeEach(() => { mocks.mutateAsync.mockReset().mockResolvedValue({ removedFollows: 1 }); mocks.pending.value = false })
afterEach(cleanup)

function renderMenu(onBlocked = vi.fn()) {
  render(<ToastProvider><ProfileMoreMenu username="alice" onBlocked={onBlocked} /></ToastProvider>)
  return onBlocked
}

describe('ProfileMoreMenu', () => {
  it('在更多菜单内二次确认后拉黑并通知页面', async () => {
    const user = userEvent.setup()
    const onBlocked = renderMenu()
    await user.click(screen.getByRole('button', { name: '更多操作' }))
    await user.click(screen.getByRole('menuitem', { name: '拉黑 @alice' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('确认拉黑 @alice？')
    await user.click(screen.getByRole('button', { name: '确认拉黑' }))
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1))
    expect(onBlocked).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('status')).toHaveTextContent('已拉黑该用户')
  })

  it('Escape 关闭菜单并把焦点还给触发按钮', async () => {
    const user = userEvent.setup()
    renderMenu()
    const trigger = screen.getByRole('button', { name: '更多操作' })
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
