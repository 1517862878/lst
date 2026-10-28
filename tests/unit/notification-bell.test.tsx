/**
 * 通知铃铛单测（src/components/layout/NotificationBell.tsx）。
 *
 * 这里用**真的** react-query（只桩掉仓储），因为要验的行为本身就是缓存行为：
 * 「点击先把角标清掉，不等接口往返」是靠 setQueryData 实现的，桩掉 hook 就测不到了。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/hooks/queryKeys'
import { NotificationBell } from '@/components/layout/NotificationBell'

const mocks = vi.hoisted(() => ({ unreadCount: vi.fn() }))

vi.mock('@/data', () => ({
  createRepositories: () => ({ social: { unreadCount: mocks.unreadCount } }),
}))

function renderBell(options: { enabled?: boolean; cached?: number | undefined } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (options.cached !== undefined) queryClient.setQueryData(queryKeys.unreadCount(), options.cached)
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NotificationBell enabled={options.enabled ?? true} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return queryClient
}

beforeEach(() => {
  mocks.unreadCount.mockReset()
  mocks.unreadCount.mockResolvedValue(0)
})

afterEach(cleanup)

describe('NotificationBell', () => {
  it('无未读时只有「通知」，不渲染角标', () => {
    renderBell({ cached: 0 })
    expect(screen.getByRole('link', { name: '通知' })).toBeInTheDocument()
    expect(screen.queryByText('3')).not.toBeInTheDocument()
  })

  it('有未读时 aria-label 带上条数，并用数字角标', () => {
    renderBell({ cached: 3 })
    expect(screen.getByRole('link', { name: '通知，3 条未读' })).toBeInTheDocument()
    // 角标对读屏隐藏（条数已在 aria-label 里），所以按文字查而不是按 role
    expect(screen.getByText('3')).toHaveAttribute('aria-hidden', 'true')
  })

  it('超过 99 条显示 99+，但读屏文案仍是真实条数', () => {
    renderBell({ cached: 120 })
    expect(screen.getByText('99+')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '通知，120 条未读' })).toBeInTheDocument()
  })

  it('链接指向 /notifications', () => {
    renderBell({ cached: 1 })
    expect(screen.getByRole('link')).toHaveAttribute('href', '/notifications')
  })

  it('点击先清角标（setQueryData），不等接口往返', async () => {
    const user = userEvent.setup()
    const queryClient = renderBell({ cached: 5 })
    await user.click(screen.getByRole('link'))

    expect(queryClient.getQueryData(queryKeys.unreadCount())).toBe(0)
    await waitFor(() => expect(screen.getByRole('link', { name: '通知' })).toBeInTheDocument())
    // 点击不该触发重新请求：角标是本地清的
    expect(mocks.unreadCount).not.toHaveBeenCalled()
  })

  it('游客（enabled=false）不请求未读数，也不显示角标', () => {
    renderBell({ enabled: false, cached: 7 })
    expect(screen.getByRole('link', { name: '通知' })).toBeInTheDocument()
    expect(screen.queryByText('7')).not.toBeInTheDocument()
    expect(mocks.unreadCount).not.toHaveBeenCalled()
  })

  it('打开页面时没有缓存就发一次请求', async () => {
    mocks.unreadCount.mockResolvedValue(4)
    renderBell()
    await waitFor(() => expect(mocks.unreadCount).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('link', { name: '通知，4 条未读' })).toBeInTheDocument())
  })
})
