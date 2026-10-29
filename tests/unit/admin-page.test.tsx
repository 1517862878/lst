/**
 * 审核台（/admin，8.2）：权限门、举报队列详情、认领/隐藏/裁定、申诉复核、撤销处罚。
 *
 * 这里测的是「操作链路」而不是像素：每个按钮点下去必须调到对应仓储方法，
 * 且带上页面里填的理由 / 备注 —— 审核动作一旦少传字段，服务端要么 400 要么
 * 记一条没有理由的审计日志，两种都很难事后追。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { AdminAppeal, AdminSanction } from '@/domain/types'
import type { AdminReportDetail } from '@/data/contracts'

const h = vi.hoisted(() => ({
  session: {
    value: {
      userId: 'u-admin',
      username: 'admin',
      displayName: '管理员',
      avatarKey: null,
      role: 'admin',
      expiresAt: '2026-03-10T00:00:00.000Z',
    } as Record<string, unknown> | null,
  },
  reports: { value: [] as unknown[], loading: false, error: null as Error | null },
  appeals: { value: [] as unknown[], loading: false, error: null as Error | null },
  sanctions: { value: [] as unknown[], loading: false, error: null as Error | null },
  detail: { value: null as unknown },
  claim: vi.fn(),
  visibility: vi.fn(),
  resolve: vi.fn(),
  review: vi.fn(),
  revoke: vi.fn(),
}))

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ data: h.session.value, isLoading: false }),
}))

vi.mock('@/components/ui/useToast', () => ({
  useToast: () => ({ show: vi.fn() }),
}))

vi.mock('@/hooks/useModeration', () => ({
  useAdminReports: () => ({
    data: h.reports.value,
    isLoading: h.reports.loading,
    error: h.reports.error,
    refetch: vi.fn(),
  }),
  useAdminAppeals: () => ({
    data: h.appeals.value,
    isLoading: h.appeals.loading,
    error: h.appeals.error,
    refetch: vi.fn(),
  }),
  useAdminSanctions: () => ({
    data: h.sanctions.value,
    isLoading: h.sanctions.loading,
    error: h.sanctions.error,
    refetch: vi.fn(),
  }),
  useAdminReportDetail: (id: string) =>
    id
      ? {
          data: h.detail.value,
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }
      : { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() },
  useClaimReport: () => ({ mutateAsync: h.claim, isPending: false }),
  useSetVisibility: () => ({ mutateAsync: h.visibility, isPending: false }),
  useResolveReport: () => ({ mutateAsync: h.resolve, isPending: false }),
  useReviewAppeal: () => ({ mutateAsync: h.review, isPending: false }),
  useRevokeSanction: () => ({ mutateAsync: h.revoke, isPending: false }),
}))

const { AdminPage } = await import('@/pages/AdminPage')

// ===== 夹具 =====

const NOW = '2026-02-10T12:00:00.000Z'

const report = {
  id: 'rep-1',
  targetType: 'photo' as const,
  targetId: 'p-1',
  reason: 'copyright' as const,
  detail: '这是我的原图',
  status: 'open' as const,
  assignedTo: null,
  reviewNote: null,
  resolutionCode: null,
  createdAt: NOW,
  updatedAt: NOW,
  resolvedAt: null,
}

function detail(overrides: Partial<AdminReportDetail> = {}): AdminReportDetail {
  return {
    report,
    target: {
      kind: 'photo',
      id: 'p-1',
      title: '山间晨雾',
      excerpt: '清晨的山谷被雾覆盖',
      authorId: 'u-other',
      authorUsername: 'other',
      authorDisplayName: '路人甲',
      hidden: false,
    },
    actions: [],
    ...overrides,
  }
}

const adminAppeal: AdminAppeal = {
  id: 'apl-1',
  appellantId: 'u-me',
  reportId: 'rep-1',
  sanctionId: null,
  message: '这条举报判错了，请复核',
  status: 'open',
  reviewNote: '',
  createdAt: NOW,
  reviewedAt: null,
  appellantUsername: 'me',
  appellantDisplayName: '我',
}

const adminSanction: AdminSanction = {
  id: 'san-1',
  userId: 'u-me',
  kind: 'warning',
  reasonCode: 'spam',
  reasonDetail: '多次发布广告评论',
  status: 'active',
  startsAt: NOW,
  endsAt: null,
  revokedAt: null,
  appealStatus: null,
  createdAt: NOW,
  username: 'me',
  displayName: '我',
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/login" element={<div>登录页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  h.reports.value = []
  h.appeals.value = []
  h.sanctions.value = []
  h.detail.value = null
  h.reports.loading = false
  h.reports.error = null
  h.claim.mockReset()
  h.visibility.mockReset()
  h.resolve.mockReset()
  h.review.mockReset()
  h.revoke.mockReset()
})

describe('AdminPage 权限门', () => {
  it('未登录 → 登录页', () => {
    h.session.value = null
    renderPage()
    expect(screen.getByText('登录页')).toBeInTheDocument()
  })

  it('普通用户看到明确的「无权访问」，不渲染任何队列', () => {
    h.session.value = { userId: 'u-me', username: 'me', role: 'user' }
    renderPage()
    expect(screen.getByText('无权访问审核台')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /举报队列/ })).not.toBeInTheDocument()
  })
})

describe('举报队列', () => {
  beforeEach(() => {
    h.session.value = { userId: 'u-admin', username: 'admin', role: 'admin' }
  })

  it('三个 Tab 且计数来自数据', () => {
    h.reports.value = [report]
    renderPage()

    expect(screen.getByRole('tab', { name: /举报队列/ })).toHaveTextContent('1')
    expect(screen.getByRole('tab', { name: /申诉复核/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^处罚/ })).toBeInTheDocument()
  })

  it('列表为空时给出换筛选条件的提示', () => {
    renderPage()
    expect(screen.getByText('没有符合条件的举报')).toBeInTheDocument()
  })

  it('点击队列项加载详情：目标快照 + 审计时间线空态', async () => {
    h.reports.value = [report]
    h.detail.value = detail()
    const user = userEvent.setup()
    renderPage()

    // 未选中时详情区是占位文案
    expect(screen.getByText('从左侧列表选择一条举报查看详情。')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /作品 · 侵权/ }))

    const pane = screen.getByRole('complementary', { name: '举报详情' })
    expect(within(pane).getByText('山间晨雾')).toBeInTheDocument()
    expect(within(pane).getByText(/路人甲/)).toBeInTheDocument()
    expect(within(pane).getByText('还没有操作记录。')).toBeInTheDocument()
  })

  it('认领：调用 claimReport', async () => {
    h.claim.mockResolvedValueOnce(undefined)
    h.reports.value = [report]
    h.detail.value = detail()
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /作品 · 侵权/ }))
    const pane = screen.getByRole('complementary', { name: '举报详情' })
    await user.click(within(pane).getByRole('button', { name: '认领' }))
    expect(h.claim).toHaveBeenCalledWith('rep-1')
  })

  it('隐藏内容必须先填理由，并带 reportId 落审计', async () => {
    h.visibility.mockResolvedValueOnce(undefined)
    h.reports.value = [report]
    h.detail.value = detail()
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /作品 · 侵权/ }))
    const pane = screen.getByRole('complementary', { name: '举报详情' })
    const hide = within(pane).getByRole('button', { name: '隐藏内容' })
    expect(hide).toBeDisabled()

    await user.type(within(pane).getByLabelText(/处理理由/), '确认盗用他人作品')
    expect(hide).toBeEnabled()
    await user.click(hide)

    expect(h.visibility).toHaveBeenCalledWith({
      targetType: 'photo',
      targetId: 'p-1',
      hidden: true,
      reason: '确认盗用他人作品',
      reportId: 'rep-1',
    })
  })

  it('已隐藏的目标提供「恢复内容」', async () => {
    h.visibility.mockResolvedValueOnce(undefined)
    h.reports.value = [report]
    h.detail.value = detail({ target: { ...detail().target, hidden: true } })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /作品 · 侵权/ }))
    const pane = screen.getByRole('complementary', { name: '举报详情' })
    expect(within(pane).queryByRole('button', { name: '隐藏内容' })).not.toBeInTheDocument()

    await user.type(within(pane).getByLabelText(/处理理由/), '申诉成立')
    await user.click(within(pane).getByRole('button', { name: '恢复内容' }))
    expect(h.visibility).toHaveBeenCalledWith(
      expect.objectContaining({ hidden: false, reason: '申诉成立' }),
    )
  })

  it('裁定：备注必填，提交时带结论与裁定码', async () => {
    h.resolve.mockResolvedValueOnce(undefined)
    h.reports.value = [report]
    h.detail.value = detail()
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /作品 · 侵权/ }))
    const pane = screen.getByRole('complementary', { name: '举报详情' })
    const submit = within(pane).getByRole('button', { name: '提交裁定' })
    expect(submit).toBeDisabled()

    await user.type(within(pane).getByLabelText(/审核备注/), '已核对原图 EXIF')
    await user.click(submit)

    expect(h.resolve).toHaveBeenCalledWith({
      id: 'rep-1',
      input: {
        status: 'upheld',
        resolutionCode: 'content_hidden',
        reviewNote: '已核对原图 EXIF',
      },
    })
  })

  it('被其他审核员认领后只读：提示可见，裁定被禁用', async () => {
    h.reports.value = [report]
    h.detail.value = detail({ report: { ...report, status: 'reviewing', assignedTo: 'u-other' } })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /作品 · 侵权/ }))
    const pane = screen.getByRole('complementary', { name: '举报详情' })
    expect(within(pane).getByText('已由其他审核员认领')).toBeInTheDocument()
    expect(within(pane).getByRole('status')).toHaveTextContent('你只能查看')
    expect(within(pane).getByRole('button', { name: '提交裁定' })).toBeDisabled()
    expect(within(pane).queryByRole('button', { name: '认领' })).not.toBeInTheDocument()
  })

  it('已结案的举报不再显示裁定区，而是结论', async () => {
    h.reports.value = [report]
    h.detail.value = detail({
      report: {
        ...report,
        status: 'upheld',
        resolutionCode: 'content_hidden',
        reviewNote: '确认盗图',
        resolvedAt: NOW,
      },
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /作品 · 侵权/ }))
    const pane = screen.getByRole('complementary', { name: '举报详情' })
    expect(within(pane).queryByRole('button', { name: '提交裁定' })).not.toBeInTheDocument()
    expect(within(pane).getByText(/已结案：内容已隐藏/)).toBeInTheDocument()
  })
})

describe('申诉复核', () => {
  beforeEach(() => {
    h.session.value = { userId: 'u-admin', username: 'admin', role: 'admin' }
  })

  it('复核意见为空时前端拦截，不发请求', async () => {
    h.appeals.value = [adminAppeal]
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: /申诉复核/ }))
    await user.click(screen.getByRole('button', { name: '复核' }))
    await user.click(screen.getByRole('button', { name: '提交复核' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('请填写复核意见')
    expect(h.review).not.toHaveBeenCalled()
  })

  it('选择「申诉成立」并提交：带 outcome 与意见', async () => {
    h.review.mockResolvedValueOnce({ appealId: 'apl-1', status: 'upheld', updatedAt: NOW })
    h.appeals.value = [adminAppeal]
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: /申诉复核/ }))
    await user.click(screen.getByRole('button', { name: '复核' }))
    await user.selectOptions(screen.getByLabelText(/复核结果/), 'upheld')
    await user.type(screen.getByLabelText(/复核意见/), '处罚依据不足')
    await user.click(screen.getByRole('button', { name: '提交复核' }))

    expect(h.review).toHaveBeenCalledWith({
      id: 'apl-1',
      outcome: 'upheld',
      note: '处罚依据不足',
    })
  })

  it('已复核的申诉不再提供复核按钮', async () => {
    h.appeals.value = [
      { ...adminAppeal, status: 'rejected', reviewNote: '维持原判', reviewedAt: NOW },
    ]
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: /申诉复核/ }))
    expect(screen.getByText('复核意见：维持原判')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '复核' })).not.toBeInTheDocument()
  })
})

describe('撤销处罚', () => {
  beforeEach(() => {
    h.session.value = { userId: 'u-admin', username: 'admin', role: 'admin' }
  })

  it('必须填撤销理由，确认后调用 revokeSanction', async () => {
    h.revoke.mockResolvedValueOnce(undefined)
    h.sanctions.value = [adminSanction]
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: /^处罚/ }))
    await user.click(screen.getByRole('button', { name: '撤销处罚' }))
    await user.click(screen.getByRole('button', { name: '确认撤销' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请填写撤销理由')
    expect(h.revoke).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/撤销理由/), '申诉成立')
    await user.click(screen.getByRole('button', { name: '确认撤销' }))
    expect(h.revoke).toHaveBeenCalledWith({ id: 'san-1', reason: '申诉成立' })
  })

  it('已撤销的处罚显示撤销时间，不可再次撤销', async () => {
    h.sanctions.value = [{ ...adminSanction, status: 'revoked', revokedAt: NOW }]
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: /^处罚/ }))
    expect(screen.getByText(/已于 .* 撤销/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '撤销处罚' })).not.toBeInTheDocument()
  })
})
