/**
 * /me/moderation 页面（8.2）：三 Tab、空态、申诉弹窗。
 *
 * 页面的价值在于「用户能自己查到进度」：举报被驳回要能申诉、处罚要能看到期限，
 * 所以测试围绕三件事 —— 切换 Tab 看得到对应数据、驳回后出现申诉入口、
 * 申诉校验与提交走同一套契约。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { Appeal, MyReport, MySanction } from '@/domain/types'

const h = vi.hoisted(() => ({
  session: {
    value: {
      userId: 'u-me',
      username: 'me',
      displayName: '我',
      avatarKey: null,
      role: 'user',
      expiresAt: '2026-03-10T00:00:00.000Z',
    } as Record<string, unknown> | null,
  },
  reports: { value: [] as unknown[], loading: false, error: null as Error | null },
  sanctions: { value: [] as unknown[], loading: false, error: null as Error | null },
  appeals: { value: [] as unknown[], loading: false, error: null as Error | null },
  submitAppeal: vi.fn(),
}))

const reportsQuery = () => ({
  data: h.reports.value,
  isLoading: h.reports.loading,
  error: h.reports.error,
  refetch: vi.fn(),
})
const sanctionsQuery = () => ({
  data: h.sanctions.value,
  isLoading: h.sanctions.loading,
  error: h.sanctions.error,
  refetch: vi.fn(),
})
const appealsQuery = () => ({
  data: h.appeals.value,
  isLoading: h.appeals.loading,
  error: h.appeals.error,
  refetch: vi.fn(),
})

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ data: h.session.value, isLoading: false }),
}))

vi.mock('@/hooks/useModeration', () => ({
  useMyReports: () => reportsQuery(),
  useMySanctions: () => sanctionsQuery(),
  useMyAppeals: () => appealsQuery(),
  useSubmitAppeal: () => ({ mutateAsync: h.submitAppeal, isPending: false, reset: vi.fn() }),
}))

const { MeModerationPage } = await import('@/pages/MeModerationPage')

// ===== 夹具 =====

const NOW = '2026-02-10T12:00:00.000Z'

function myReport(overrides: Partial<MyReport> = {}): MyReport {
  return {
    id: 'rep-1',
    targetType: 'photo',
    targetId: 'p-1',
    reason: 'copyright',
    detail: '这是我的原图',
    status: 'open',
    resolutionCode: null,
    reviewNote: null,
    appealStatus: null,
    createdAt: NOW,
    resolvedAt: null,
    ...overrides,
  }
}

function mySanction(overrides: Partial<MySanction> = {}): MySanction {
  return {
    id: 'san-1',
    kind: 'warning',
    reasonCode: 'spam',
    reasonDetail: '多次发布广告评论',
    status: 'active',
    startsAt: NOW,
    endsAt: null,
    revokedAt: null,
    appealStatus: null,
    createdAt: NOW,
    ...overrides,
  }
}

function appeal(overrides: Partial<Appeal> = {}): Appeal {
  return {
    id: 'apl-1',
    reportId: 'rep-1',
    sanctionId: null,
    message: '这张图是我拍的，请重新核实',
    status: 'open',
    reviewNote: '',
    createdAt: NOW,
    reviewedAt: null,
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/me/moderation']}>
      <Routes>
        <Route path="/me/moderation" element={<MeModerationPage />} />
        <Route path="/login" element={<div>登录页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  h.reports.value = []
  h.sanctions.value = []
  h.appeals.value = []
  h.reports.loading = false
  h.sanctions.loading = false
  h.appeals.loading = false
  h.reports.error = null
  h.sanctions.error = null
  h.appeals.error = null
  h.submitAppeal.mockReset()
})

describe('MeModerationPage', () => {
  it('未登录时跳转登录页并带上 next', () => {
    h.session.value = null
    renderPage()
    expect(screen.getByText('登录页')).toBeInTheDocument()
  })

  it('三个 Tab 存在，默认展示「我的举报」空态', () => {
    h.session.value = { userId: 'u-me', username: 'me', role: 'user' }
    renderPage()

    expect(screen.getByRole('tab', { name: /我的举报/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /我的处罚/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /我的申诉/ })).toBeInTheDocument()
    expect(screen.getByText('还没有提交过举报')).toBeInTheDocument()
  })

  it('Tab 计数来自数据长度', () => {
    h.session.value = { userId: 'u-me', username: 'me', role: 'user' }
    h.reports.value = [myReport(), myReport({ id: 'rep-2' })]
    h.sanctions.value = [mySanction()]
    renderPage()

    expect(screen.getByRole('tab', { name: /我的举报/ })).toHaveTextContent('2')
    expect(screen.getByRole('tab', { name: /我的处罚/ })).toHaveTextContent('1')
  })

  it('举报卡片显示理由与状态；处理中的不给申诉入口', () => {
    h.session.value = { userId: 'u-me', username: 'me', role: 'user' }
    h.reports.value = [myReport({ status: 'reviewing' })]
    renderPage()

    const card = screen.getByRole('listitem')
    expect(within(card).getByText(/理由：侵权/)).toBeInTheDocument()
    expect(within(card).getByText('处理中')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: '申诉' })).not.toBeInTheDocument()
  })

  it('被驳回的举报可以申诉：弹窗校验字数，提交成功关闭弹窗', async () => {
    h.submitAppeal.mockResolvedValueOnce({ appealId: 'apl-9', status: 'open', createdAt: NOW })
    h.session.value = { userId: 'u-me', username: 'me', role: 'user' }
    h.reports.value = [
      myReport({
        status: 'rejected',
        resolutionCode: 'no_violation',
        reviewNote: '未发现违规',
        resolvedAt: NOW,
      }),
    ]
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: '申诉' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: '提交申诉' })).toBeInTheDocument()

    // 太短：前端先挡，不发请求
    await user.type(within(dialog).getByLabelText(/申诉说明/), '不服')
    await user.click(within(dialog).getByRole('button', { name: '提交申诉' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('至少 10 个字')
    expect(h.submitAppeal).not.toHaveBeenCalled()

    // 合格：调用契约并关闭
    await user.type(within(dialog).getByLabelText(/申诉说明/), '，这张照片是我在去年秋天拍摄的')
    await user.click(within(dialog).getByRole('button', { name: '提交申诉' }))
    expect(h.submitAppeal).toHaveBeenCalledWith({
      reportId: 'rep-1',
      message: '不服，这张照片是我在去年秋天拍摄的',
    })
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('已有申诉的举报显示申诉状态，不再重复给入口', () => {
    h.session.value = { userId: 'u-me', username: 'me', role: 'user' }
    h.reports.value = [myReport({ status: 'rejected', appealStatus: 'open' })]
    renderPage()

    expect(screen.getByText('申诉待复核')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '申诉' })).not.toBeInTheDocument()
  })

  it('处罚 Tab：显示期限与撤销提示，生效中可申诉', async () => {
    h.session.value = { userId: 'u-me', username: 'me', role: 'user' }
    h.sanctions.value = [mySanction(), mySanction({ id: 'san-2', status: 'revoked' })]
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: /我的处罚/ }))
    expect(screen.getAllByText('警告')).toHaveLength(2)
    expect(screen.getByText('生效中')).toBeInTheDocument()
    expect(screen.getByText('这次处罚已被撤销')).toBeInTheDocument()
    // 只有生效中的那条可以申诉
    expect(screen.getAllByRole('button', { name: '申诉' })).toHaveLength(1)
  })

  it('申诉 Tab：展示申诉内容与复核意见', async () => {
    h.session.value = { userId: 'u-me', username: 'me', role: 'user' }
    h.appeals.value = [
      appeal({ status: 'rejected', reviewNote: '维持原判，证据不足', reviewedAt: NOW }),
    ]
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: /我的申诉/ }))
    expect(screen.getByText('复核意见：维持原判，证据不足')).toBeInTheDocument()
    expect(screen.getByText('这张图是我拍的，请重新核实')).toBeInTheDocument()
    expect(screen.getByText('维持原判')).toBeInTheDocument()
  })

  it('列表加载失败：显示错误态与重试按钮，不影响其他 Tab', async () => {
    h.session.value = { userId: 'u-me', username: 'me', role: 'user' }
    h.reports.error = new Error('网络异常')
    h.sanctions.value = [mySanction()]
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByText('加载失败')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /我的处罚/ }))
    expect(screen.getByText('多次发布广告评论')).toBeInTheDocument()
  })
})
