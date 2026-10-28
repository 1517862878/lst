import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Header } from '@/components/layout/Header'

const signOut = vi.fn()

vi.mock('@/hooks/useSession', () => ({
  useSignOut: () => ({ signOut }),
}))

const sessionUser = {
  username: 'lin',
  displayName: '林同学',
  avatarKey: 'avatars/lin photo.png',
}

function renderHeader() {
  return render(<MemoryRouter><Header sessionUser={sessionUser} /></MemoryRouter>)
}

describe('Header account menu', () => {
  afterEach(cleanup)

  beforeEach(() => {
    signOut.mockReset()
  })

  it('uses the account avatar src and exposes menu state with aria', async () => {
    const user = userEvent.setup()
    renderHeader()
    const trigger = screen.getByRole('button', { name: '林同学的账号菜单' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('img', { name: '林同学' })).toHaveAttribute('src', '/images/avatars/lin%20photo.png')

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu', { name: '账号菜单' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('menuitem', { name: '我的工作台' })).toHaveFocus())
  })

  it('supports arrow navigation and Escape restores trigger focus', async () => {
    const user = userEvent.setup()
    renderHeader()
    const trigger = screen.getByRole('button', { name: '林同学的账号菜单' })
    await user.click(trigger)
    const dashboard = screen.getByRole('menuitem', { name: '我的工作台' })
    const profile = screen.getByRole('menuitem', { name: '个人主页' })
    await waitFor(() => expect(dashboard).toHaveFocus())

    await user.keyboard('{ArrowDown}')
    expect(profile).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
