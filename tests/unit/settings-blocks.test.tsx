import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/ToastProvider'
import { SettingsPage } from '@/pages/SettingsPage'

const mocks = vi.hoisted(() => ({ unblock: vi.fn(), pages: { value: [{ items: [{ username: 'alice', displayName: '爱丽丝', avatarKey: null, bio: '摄影师', blockedAt: '2026-01-01T00:00:00Z' }], nextCursor: null }] } }))
vi.mock('@/hooks/useSession', () => ({ useSession: () => ({ data: { userId: 'me' }, isLoading: false }), useSignOut: () => ({ signOut: vi.fn() }) }))
vi.mock('@/hooks/useAccount', () => ({ useAccount: () => ({ data: { username: 'me', phone: null }, isLoading: false, isError: false, refetch: vi.fn() }) }))
vi.mock('@/hooks/useSocial', () => ({
  useBlockedUsers: () => ({ data: { pages: mocks.pages.value }, isLoading: false, isError: false, error: null, refetch: vi.fn(), hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() }),
  useUnblockUser: () => ({ mutateAsync: mocks.unblock, isPending: false }),
}))

beforeEach(() => { mocks.unblock.mockReset().mockResolvedValue(undefined); mocks.pages.value = [{ items: [{ username: 'alice', displayName: '爱丽丝', avatarKey: null, bio: '摄影师', blockedAt: '2026-01-01T00:00:00Z' }], nextCursor: null }] })
afterEach(cleanup)
function renderPage() { return render(<ToastProvider><MemoryRouter initialEntries={['/settings/blocks']}><Routes><Route path="/settings/:section" element={<SettingsPage />} /><Route path="/login" element={<p>登录</p>} /></Routes></MemoryRouter></ToastProvider>) }

describe('SettingsPage 黑名单', () => {
  it('从设置入口展示黑名单并可解除拉黑', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByRole('link', { name: '黑名单' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('@alice')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '解除拉黑' }))
    await waitFor(() => expect(mocks.unblock).toHaveBeenCalledWith('alice'))
    expect(await screen.findByRole('status')).toHaveTextContent('已解除对 @alice 的拉黑')
  })

  it('空列表显示明确空态', () => {
    mocks.pages.value = [{ items: [], nextCursor: null }]
    renderPage()
    expect(screen.getByText('黑名单为空')).toBeInTheDocument()
  })
})
