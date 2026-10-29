/**
 * 举报对话框（8.2）：校验、提交入参、回执、失败提示。
 *
 * 举报是低频但高敏感的操作：用户点「提交」后必须**看到回执编号**（可抄走/截图），
 * 而不是对话框一闪就关。这里锁住这个交互，防止以后被「提交即关闭」改回去。
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppError, ErrorCodes } from '@/data/contracts'

const h = vi.hoisted(() => {
  const mutateAsync = vi.fn()
  return {
    mutateAsync,
    submit: {
      mutateAsync,
      isPending: false,
      reset: vi.fn(),
    },
  }
})

vi.mock('@/hooks/useModeration', () => ({
  useSubmitReport: () => h.submit,
}))

const { ReportDialog } = await import('@/features/moderation/ReportDialog')

function renderDialog(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const target = { type: 'photo' as const, id: 'p-1', label: '作品《山间晨雾》' }
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReportDialog target={target} onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...view, onClose }
}

describe('ReportDialog', () => {
  it('未选理由就提交：role=alert 提示，且不调用接口', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: '提交举报' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('请选择一个举报理由')
    expect(h.mutateAsync).not.toHaveBeenCalled()
  })

  it('选择理由后提交：入参正确，就地展示回执与查看入口', async () => {
    h.mutateAsync.mockResolvedValueOnce({ reportId: 'rep-9f2c', status: 'open' })
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('radio', { name: /侵权/ }))
    await user.type(screen.getByLabelText('补充说明（选填）'), '  这是他人作品  ')
    await user.click(screen.getByRole('button', { name: '提交举报' }))

    expect(h.mutateAsync).toHaveBeenCalledWith({
      targetType: 'photo',
      targetId: 'p-1',
      reason: 'copyright',
      detail: '这是他人作品',
    })

    // 回执编号用 role=status 播报，屏幕阅读器也能读到
    expect(await screen.findByRole('status')).toHaveTextContent('rep-9f2c')
    expect(screen.getByRole('link', { name: '查看我的举报' })).toHaveAttribute(
      'href',
      '/me/moderation',
    )
    // 提交成功后**不自动关闭**：用户要能抄下编号
    expect(screen.getByRole('button', { name: '完成' })).toBeInTheDocument()
  })

  it('接口报错时展示后端文案，对话框保留用户的选择', async () => {
    h.mutateAsync.mockRejectedValueOnce(
      new AppError(ErrorCodes.CONFLICT, '这条内容你已经举报过，我们正在处理'),
    )
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('radio', { name: /垃圾广告/ }))
    await user.click(screen.getByRole('button', { name: '提交举报' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '这条内容你已经举报过，我们正在处理',
    )
    expect(screen.getByRole('radio', { name: /垃圾广告/ })).toBeChecked()
  })

  it('补充说明上限 500 字：输入框带 maxLength，字数统计实时更新', async () => {
    const user = userEvent.setup()
    renderDialog()

    const detail = screen.getByLabelText(/补充说明/) as HTMLTextAreaElement
    expect(detail).toHaveAttribute('maxlength', '500')
    await user.type(detail, '时间地点')
    expect(detail.value).toBe('时间地点')
    expect(screen.getByText(`4/500`)).toBeInTheDocument()
  })
})
