/**
 * 全站账号限制横幅（8.2 补口）。
 *
 * 锁住四件事：
 *   1. 受限才出现，访客/未受限账号完全无节点；
 *   2. 文案必须说清「限制哪些操作 + 到期时间」，长期限制不能显示成空日期；
 *   3. 关闭只写 sessionStorage（本次会话），且限制变化后会重新出现；
 *   4. 请求层广播的 403 限制事件能弹出带「去申诉」的 toast，并跳到 /me/moderation。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { SessionRestriction } from '@/domain/types'
import { ToastProvider } from '@/components/ui/ToastProvider'
import { RestrictionBanner } from '@/components/layout/RestrictionBanner'
import { emitSanctionBlocked } from '@/lib/restrictionNotice'

const DISMISS_KEY = 'gy:restriction-dismissed'

function restriction(overrides: Partial<SessionRestriction> = {}): SessionRestriction {
  return {
    kind: 'content_restriction',
    reasonCode: 'copyright',
    reasonDetail: '多次上传未授权作品',
    endsAt: '2026-11-05T10:00:00.000Z',
    ...overrides,
  }
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function renderBanner(value: SessionRestriction | null) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ToastProvider>
        <RestrictionBanner restriction={value} />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

describe('RestrictionBanner', () => {
  it('访客与未受限账号不渲染横幅', () => {
    const { container, unmount } = renderBanner(null)
    expect(container.querySelector('.g-restriction-banner')).toBeNull()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    unmount()
  })

  it('内容限制：说明受限操作、到期日期、原因与申诉入口', () => {
    const { container } = renderBanner(restriction())
    const banner = container.querySelector('.g-restriction-banner')
    expect(banner).not.toBeNull()

    const scope = within(banner as HTMLElement)
    expect(scope.getByText('内容发布受限')).toBeInTheDocument()
    expect(scope.getByText(/暂时无法发布、编辑或撤回作品/)).toBeInTheDocument()
    expect(scope.getByText(/到期时间：2026-11-05/)).toBeInTheDocument()
    expect(scope.getByText(/原因：多次上传未授权作品/)).toBeInTheDocument()
    expect(scope.getByRole('link', { name: '提交申诉' })).toHaveAttribute('href', '/me/moderation')
    expect(scope.getByRole('button', { name: /关闭限制提示/ })).toBeInTheDocument()
  })

  it('长期封禁：endsAt 为 null 时显示「长期有效」而不是日期', () => {
    const { container } = renderBanner(restriction({ kind: 'ban', reasonDetail: '', endsAt: null }))
    const banner = container.querySelector('.g-restriction-banner') as HTMLElement
    expect(within(banner).getByText('账号已封禁')).toBeInTheDocument()
    expect(within(banner).getByText('长期有效')).toBeInTheDocument()
    expect(within(banner).queryByText(/原因：/)).not.toBeInTheDocument()
  })

  it('警告使用较缓的警示配色，但仍说明不影响发布与互动', () => {
    const { container } = renderBanner(restriction({ kind: 'warning', endsAt: null }))
    const banner = container.querySelector('.g-restriction-banner') as HTMLElement
    expect(banner.className).toContain('g-restriction-banner-warning')
    expect(within(banner).getByText('账号收到一次警告')).toBeInTheDocument()
    expect(within(banner).getByText(/不影响浏览、发布与互动/)).toBeInTheDocument()
  })

  it('关闭只写 sessionStorage，重新挂载后同一限制保持关闭', async () => {
    const user = userEvent.setup()
    const view = renderBanner(restriction())

    await user.click(screen.getByRole('button', { name: /关闭限制提示/ }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(sessionStorage.getItem(DISMISS_KEY)).toContain('content_restriction')
    expect(localStorage.getItem(DISMISS_KEY)).toBeNull()

    view.unmount()
    const second = renderBanner(restriction())
    expect(second.container.querySelector('.g-restriction-banner')).toBeNull()
  })

  it('限制升级后即使之前关过也重新出现', async () => {
    const user = userEvent.setup()
    const view = renderBanner(restriction())
    await user.click(screen.getByRole('button', { name: /关闭限制提示/ }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    view.rerender(
      <MemoryRouter initialEntries={['/']}>
        <ToastProvider>
          <RestrictionBanner restriction={restriction({ kind: 'ban', endsAt: null })} />
        </ToastProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('账号已封禁')).toBeInTheDocument()
  })

  it('403 广播弹出带「去申诉」的 toast，点击后跳到 /me/moderation', async () => {
    const user = userEvent.setup()
    renderBanner(null)

    act(() => {
      emitSanctionBlocked({
        kind: 'suspension',
        endsAt: null,
        message: '账号已被停用，暂时无法互动（长期限制）',
      })
    })

    const message = screen.getByText('账号已被停用，暂时无法互动（长期限制）')
    const toast = message.closest('.g-toast') as HTMLElement
    expect(screen.getByRole('button', { name: '去申诉' })).toBeInTheDocument()

    await user.click(within(toast).getByRole('button', { name: '去申诉' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/me/moderation')
    expect(screen.queryByText('账号已被停用，暂时无法互动（长期限制）')).not.toBeInTheDocument()
  })
})
