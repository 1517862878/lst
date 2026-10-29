/**
 * 审核台（/admin，仅 editor | admin）。
 *
 * 三块：举报队列（列表 + 详情面板）、申诉复核、处罚撤销。
 * 非 staff 看到的是明确的「无权访问」说明，而不是空白页 —— 空白页会被当成
 * 功能故障报上来，而说明页能直接告诉用户这里需要什么身份。
 */
import { useState } from 'react'
import { Link } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireAuth } from '@/components/layout/guards'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { Tabs, TabsPrimitive } from '@/components/ui/Tabs'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/useToast'
import { AppError } from '@/data/contracts'
import type {
  AdminAppeal,
  AdminSanction,
  AppealStatus,
  ReportStatus,
} from '@/domain/types'
import { useSession } from '@/hooks/useSession'
import {
  useAdminAppeals,
  useAdminReportDetail,
  useAdminReports,
  useAdminSanctions,
  useClaimReport,
  useResolveReport,
  useReviewAppeal,
  useRevokeSanction,
  useSetVisibility,
} from '@/hooks/useModeration'
import { formatDate, relativeTime } from '@/lib/time'
import {
  appealStatusLabel,
  appealStatusTone,
  reasonLabel,
  REJECTED_RESOLUTIONS,
  reportStatusLabel,
  reportStatusTone,
  resolutionLabel,
  sanctionKindLabel,
  sanctionStatusLabel,
  sanctionStatusTone,
  targetKindLabel,
  UPHELD_RESOLUTIONS,
} from '@/features/moderation/copy'

type AdminTab = 'reports' | 'appeals' | 'sanctions'

export function AdminPage() {
  return (
    <RequireAuth>
      <AdminInner />
    </RequireAuth>
  )
}

function AdminInner() {
  const { data: session, isLoading } = useSession()
  const isStaff = session?.role === 'editor' || session?.role === 'admin'

  if (isLoading) {
    return (
      <Container>
        <Skeleton variant="rect" height={240} />
      </Container>
    )
  }

  if (!isStaff) {
    return (
      <Container size="sm">
        <PageHeader title="审核台" breadcrumbs={[{ label: '首页', to: '/' }, { label: '审核台' }]} />
        <EmptyState
          title="无权访问审核台"
          description="审核台仅对审核员（editor）与管理员（admin）开放。如果你认为这是误判，请联系站点管理员。"
        />
      </Container>
    )
  }

  return <AdminWorkspace staffId={session.userId} />
}

function AdminWorkspace({ staffId }: { staffId: string }) {
  const [tab, setTab] = useState<AdminTab>('reports')
  const [reportFilter, setReportFilter] = useState<ReportStatus | 'all'>('all')
  const [appealFilter, setAppealFilter] = useState<AppealStatus | 'all'>('all')
  const [sanctionFilter, setSanctionFilter] = useState('all')
  const [selectedReportId, setSelectedReportId] = useState('')

  const reportsQuery = useAdminReports(reportFilter)
  const appealsQuery = useAdminAppeals(appealFilter)
  const sanctionsQuery = useAdminSanctions(sanctionFilter)

  const items = [
    { value: 'reports', label: '举报队列', count: reportsQuery.data?.length ?? 0 },
    { value: 'appeals', label: '申诉复核', count: appealsQuery.data?.length ?? 0 },
    { value: 'sanctions', label: '处罚', count: sanctionsQuery.data?.length ?? 0 },
  ]

  return (
    <Container>
      <PageHeader
        title="审核台"
        description="处理举报、复核申诉、撤销处罚。所有操作都会写入审计记录。"
        breadcrumbs={[{ label: '首页', to: '/' }, { label: '审核台' }]}
      />

      <Tabs items={items} value={tab} onValueChange={(value) => setTab(value as AdminTab)}>
        <TabsPrimitive.Content value="reports" className="g-tabs-content">
          <FilterBar
            id="report-filter"
            label="状态筛选"
            value={reportFilter}
            onChange={(value) => setReportFilter(value as ReportStatus | 'all')}
            options={[
              { value: 'all', label: '全部' },
              { value: 'open', label: '待处理' },
              { value: 'reviewing', label: '处理中' },
              { value: 'upheld', label: '已成立' },
              { value: 'rejected', label: '已驳回' },
            ]}
          />
          <div className="g-admin-grid">
            <section className="g-admin-list-pane" aria-label="举报列表">
              <ListShell
                loading={reportsQuery.isLoading}
                error={reportsQuery.error}
                onRetry={() => void reportsQuery.refetch()}
                empty={reportsQuery.data?.length === 0}
                emptyTitle="没有符合条件的举报"
              >
                <ul className="g-admin-rows">
                  {(reportsQuery.data ?? []).map((report) => (
                    <li key={report.id}>
                      <button
                        type="button"
                        className="g-admin-row"
                        aria-pressed={selectedReportId === report.id}
                        onClick={() => setSelectedReportId(report.id)}
                      >
                        <span className="g-admin-row-title">
                          {targetKindLabel(report.targetType)} · {reasonLabel(report.reason)}
                        </span>
                        <span className="g-admin-row-meta">
                          #{report.id} · {relativeTime(report.createdAt)}
                        </span>
                        <Badge tone={reportStatusTone(report.status)}>
                          {reportStatusLabel(report.status)}
                        </Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              </ListShell>
            </section>

            <ReportDetailPane
              id={selectedReportId}
              staffId={staffId}
              onChanged={() => void reportsQuery.refetch()}
            />
          </div>
        </TabsPrimitive.Content>

        <TabsPrimitive.Content value="appeals" className="g-tabs-content">
          <FilterBar
            id="appeal-filter"
            label="状态筛选"
            value={appealFilter}
            onChange={(value) => setAppealFilter(value as AppealStatus | 'all')}
            options={[
              { value: 'all', label: '全部' },
              { value: 'open', label: '待复核' },
              { value: 'reviewing', label: '复核中' },
              { value: 'upheld', label: '申诉成立' },
              { value: 'rejected', label: '维持原判' },
            ]}
          />
          <ListShell
            loading={appealsQuery.isLoading}
            error={appealsQuery.error}
            onRetry={() => void appealsQuery.refetch()}
            empty={appealsQuery.data?.length === 0}
            emptyTitle="没有符合条件的申诉"
          >
            <ul className="g-admin-rows">
              {(appealsQuery.data ?? []).map((appeal) => (
                <AppealReviewRow
                  key={appeal.id}
                  appeal={appeal}
                  onDone={() => {
                    void appealsQuery.refetch()
                    void sanctionsQuery.refetch()
                  }}
                />
              ))}
            </ul>
          </ListShell>
        </TabsPrimitive.Content>

        <TabsPrimitive.Content value="sanctions" className="g-tabs-content">
          <FilterBar
            id="sanction-filter"
            label="状态筛选"
            value={sanctionFilter}
            onChange={setSanctionFilter}
            options={[
              { value: 'all', label: '全部' },
              { value: 'active', label: '生效中' },
              { value: 'expired', label: '已到期' },
              { value: 'revoked', label: '已撤销' },
            ]}
          />
          <ListShell
            loading={sanctionsQuery.isLoading}
            error={sanctionsQuery.error}
            onRetry={() => void sanctionsQuery.refetch()}
            empty={sanctionsQuery.data?.length === 0}
            emptyTitle="没有符合条件的处罚"
          >
            <ul className="g-admin-rows">
              {(sanctionsQuery.data ?? []).map((sanction) => (
                <SanctionRow
                  key={sanction.id}
                  sanction={sanction}
                  onDone={() => void sanctionsQuery.refetch()}
                />
              ))}
            </ul>
          </ListShell>
        </TabsPrimitive.Content>
      </Tabs>
    </Container>
  )
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback
}

function FilterBar({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div className="g-admin-filter">
      <label className="g-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="g-input g-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function ListShell({
  loading,
  error,
  onRetry,
  empty,
  emptyTitle,
  children,
}: {
  loading: boolean
  error: unknown
  onRetry: () => void
  empty: boolean
  emptyTitle: string
  children: React.ReactNode
}) {
  if (loading) {
    return (
      <div className="g-mod-skeletons" aria-hidden="true">
        <Skeleton variant="rect" height={56} />
        <Skeleton variant="rect" height={56} />
      </div>
    )
  }
  if (error) return <ErrorState title="加载失败" error={error} onRetry={onRetry} />
  if (empty) return <EmptyState title={emptyTitle} description="换一个筛选条件试试。" />
  return <>{children}</>
}

/** 举报详情面板：目标上下文 + 审计时间线 + 认领 / 隐藏恢复 / 裁定 */
function ReportDetailPane({
  id,
  staffId,
  onChanged,
}: {
  id: string
  staffId: string
  onChanged: () => void
}) {
  const toast = useToast()
  const detail = useAdminReportDetail(id)
  const claim = useClaimReport()
  const visibility = useSetVisibility()
  const resolve = useResolveReport()
  const [reason, setReason] = useState('')
  const [outcome, setOutcome] = useState<'upheld' | 'rejected'>('upheld')
  const [resolutionCode, setResolutionCode] = useState<string>(UPHELD_RESOLUTIONS[0])
  const [note, setNote] = useState('')
  const [actionError, setActionError] = useState('')

  if (!id) {
    return (
      <aside className="g-admin-detail" aria-label="举报详情">
        <p className="g-admin-placeholder">从左侧列表选择一条举报查看详情。</p>
      </aside>
    )
  }

  if (detail.isLoading) {
    return (
      <aside className="g-admin-detail" aria-label="举报详情">
        <Skeleton variant="rect" height={200} />
      </aside>
    )
  }

  if (detail.isError || !detail.data) {
    return (
      <aside className="g-admin-detail" aria-label="举报详情">
        <ErrorState title="详情加载失败" error={detail.error} onRetry={() => void detail.refetch()} />
      </aside>
    )
  }

  const { report, target, actions } = detail.data
  const closed = report.status === 'upheld' || report.status === 'rejected'
  const claimedByMe = report.assignedTo === staffId
  const claimedByOther = Boolean(report.assignedTo) && !claimedByMe

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setActionError('')
    try {
      await fn()
      toast.show('success', message)
      onChanged()
      await detail.refetch()
    } catch (error) {
      setActionError(errorText(error, '操作失败，请稍后重试'))
    }
  }

  return (
    <aside className="g-admin-detail" aria-label="举报详情">
      <div className="g-admin-detail-head">
        <h2 className="g-admin-detail-title">
          {targetKindLabel(report.targetType)}举报
          <span className="g-admin-row-meta">#{report.id}</span>
        </h2>
        <Badge tone={reportStatusTone(report.status)}>{reportStatusLabel(report.status)}</Badge>
      </div>

      <dl className="g-admin-kv">
        <div>
          <dt>理由</dt>
          <dd>{reasonLabel(report.reason)}</dd>
        </div>
        <div>
          <dt>提交时间</dt>
          <dd>{formatDate(report.createdAt)}</dd>
        </div>
        <div>
          <dt>认领</dt>
          <dd>{report.assignedTo ? (claimedByMe ? '已由你认领' : '已由其他审核员认领') : '未认领'}</dd>
        </div>
      </dl>

      {report.detail && <p className="g-admin-quote">{report.detail}</p>}

      <section className="g-admin-target" aria-label="被举报内容">
        <h3 className="g-admin-section-title">被举报内容</h3>
        <p className="g-admin-target-title">{target.title || '（无标题）'}</p>
        <p className="g-admin-target-excerpt">{target.excerpt || '（无正文）'}</p>
        <p className="g-admin-row-meta">
          作者：
          {target.authorUsername ? (
            <Link to={`/u/${target.authorUsername}`} className="g-login-link">
              {target.authorDisplayName || `@${target.authorUsername}`}
            </Link>
          ) : (
            '未知'
          )}
          {target.hidden ? ' · 当前已隐藏' : ' · 当前可见'}
        </p>
      </section>

      <Input
        id={`reason-${report.id}`}
        label="处理理由（隐藏 / 恢复内容时需要）"
        placeholder="例如：确认盗用他人作品"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />

      <div className="g-admin-actions">
        {!report.assignedTo && (
          <Button
            size="sm"
            variant="secondary"
            loading={claim.isPending}
            onClick={() => void run(() => claim.mutateAsync(report.id), '已认领')}
          >
            认领
          </Button>
        )}
        {target.kind !== 'profile' && !target.hidden && (
          <Button
            size="sm"
            variant="danger"
            disabled={claim.isPending || visibility.isPending || !reason.trim()}
            onClick={() =>
              void run(
                () =>
                  visibility.mutateAsync({
                    targetType: target.kind,
                    targetId: target.id,
                    hidden: true,
                    reason: reason.trim(),
                    reportId: report.id,
                  }),
                '内容已隐藏',
              )
            }
          >
            隐藏内容
          </Button>
        )}
        {target.kind !== 'profile' && target.hidden && (
          <Button
            size="sm"
            variant="secondary"
            disabled={visibility.isPending || !reason.trim()}
            onClick={() =>
              void run(
                () =>
                  visibility.mutateAsync({
                    targetType: target.kind,
                    targetId: target.id,
                    hidden: false,
                    reason: reason.trim(),
                    reportId: report.id,
                  }),
                '内容已恢复',
              )
            }
          >
            恢复内容
          </Button>
        )}
      </div>

      {!closed ? (
        <section className="g-admin-resolve" aria-label="裁定">
          <h3 className="g-admin-section-title">裁定</h3>
          <div className="g-admin-resolve-grid">
            <label className="g-label" htmlFor={`outcome-${report.id}`}>
              结论
            </label>
            <select
              id={`outcome-${report.id}`}
              className="g-input g-select"
              value={outcome}
              disabled={claimedByOther}
              onChange={(event) => {
                const next = event.target.value as 'upheld' | 'rejected'
                setOutcome(next)
                setResolutionCode(next === 'upheld' ? UPHELD_RESOLUTIONS[0] : REJECTED_RESOLUTIONS[0])
              }}
            >
              <option value="upheld">举报成立</option>
              <option value="rejected">驳回举报</option>
            </select>
            <label className="g-label" htmlFor={`code-${report.id}`}>
              处理方式
            </label>
            <select
              id={`code-${report.id}`}
              className="g-input g-select"
              value={resolutionCode}
              disabled={claimedByOther}
              onChange={(event) => setResolutionCode(event.target.value)}
            >
              {(outcome === 'upheld' ? UPHELD_RESOLUTIONS : REJECTED_RESOLUTIONS).map((code) => (
                <option key={code} value={code}>
                  {resolutionLabel(code)}
                </option>
              ))}
            </select>
          </div>
          <Textarea
            label="审核备注"
            required
            hint="会写入审计记录，必要时展示给举报人"
            rows={3}
            maxLength={500}
            showCount
            value={note}
            disabled={claimedByOther}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button
            size="sm"
            variant="danger"
            loading={resolve.isPending}
            disabled={claimedByOther || !note.trim()}
            onClick={() =>
              void run(
                () =>
                  resolve.mutateAsync({
                    id: report.id,
                    input: { status: outcome, resolutionCode, reviewNote: note.trim() },
                  }),
                outcome === 'upheld' ? '已裁定：举报成立' : '已裁定：驳回举报',
              )
            }
          >
            提交裁定
          </Button>
          {claimedByOther && (
            <p className="g-mod-hint" role="status">
              这条举报已被其他审核员认领，你只能查看。
            </p>
          )}
        </section>
      ) : (
        <p className="g-admin-quote">
          已结案：{resolutionLabel(report.resolutionCode) || report.status}
          {report.reviewNote ? ` · ${report.reviewNote}` : ''}
        </p>
      )}

      {actionError && (
        <p className="g-auth-error" role="alert">
          {actionError}
        </p>
      )}

      <section aria-label="审计时间线">
        <h3 className="g-admin-section-title">审计时间线</h3>
        {actions.length === 0 ? (
          <p className="g-mod-hint">还没有操作记录。</p>
        ) : (
          <ol className="g-admin-timeline">
            {actions.map((action) => (
              <li key={action.id}>
                <span className="g-admin-timeline-time">{formatDate(action.createdAt)}</span>
                <span className="g-admin-timeline-text">
                  {action.action} · {action.reason}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  )
}

function AppealReviewRow({ appeal, onDone }: { appeal: AdminAppeal; onDone: () => void }) {
  const toast = useToast()
  const review = useReviewAppeal()
  const [open, setOpen] = useState(false)
  const [outcome, setOutcome] = useState<'upheld' | 'rejected'>('rejected')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const done = appeal.status === 'upheld' || appeal.status === 'rejected'

  const submit = async () => {
    if (!note.trim()) {
      setError('请填写复核意见')
      return
    }
    setError('')
    try {
      await review.mutateAsync({ id: appeal.id, outcome, note: note.trim() })
      toast.show('success', outcome === 'upheld' ? '申诉成立，已撤销原处理' : '已维持原判')
      setOpen(false)
      onDone()
    } catch (err) {
      setError(errorText(err, '复核失败，请稍后重试'))
    }
  }

  return (
    <li className="g-admin-card">
      <div className="g-admin-card-head">
        <span className="g-admin-row-title">
          申诉 #{appeal.id} · {appeal.reportId ? `举报 #${appeal.reportId}` : `处罚 #${appeal.sanctionId}`}
        </span>
        <Badge tone={appealStatusTone(appeal.status)}>{appealStatusLabel(appeal.status)}</Badge>
      </div>
      <p className="g-admin-row-meta">
        申诉人：
        <Link to={`/u/${appeal.appellantUsername}`} className="g-login-link">
          {appeal.appellantDisplayName || `@${appeal.appellantUsername}`}
        </Link>
        {' · '}
        {relativeTime(appeal.createdAt)}
      </p>
      <p className="g-admin-quote">{appeal.message}</p>
      {appeal.reviewNote && <p className="g-mod-hint">复核意见：{appeal.reviewNote}</p>}
      {!done && (
        <>
          {!open ? (
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              复核
            </Button>
          ) : (
            <div className="g-admin-inline-form">
              <label className="g-label" htmlFor={`appeal-outcome-${appeal.id}`}>
                复核结果
              </label>
              <select
                id={`appeal-outcome-${appeal.id}`}
                className="g-input g-select"
                value={outcome}
                onChange={(event) => setOutcome(event.target.value as 'upheld' | 'rejected')}
              >
                <option value="rejected">维持原判</option>
                <option value="upheld">申诉成立（撤销原处理）</option>
              </select>
              <Textarea
                label="复核意见"
                required
                rows={3}
                maxLength={500}
                showCount
                value={note}
                error={error || undefined}
                onChange={(event) => setNote(event.target.value)}
              />
              <div className="g-admin-actions">
                <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button size="sm" loading={review.isPending} onClick={() => void submit()}>
                  提交复核
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </li>
  )
}

function SanctionRow({ sanction, onDone }: { sanction: AdminSanction; onDone: () => void }) {
  const toast = useToast()
  const revoke = useRevokeSanction()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const revoked = sanction.status === 'revoked'
  const period = sanction.endsAt
    ? `${formatDate(sanction.startsAt)} – ${formatDate(sanction.endsAt)}`
    : `${formatDate(sanction.startsAt)} 起，长期`

  const submit = async () => {
    if (!reason.trim()) {
      setError('请填写撤销理由')
      return
    }
    setError('')
    try {
      await revoke.mutateAsync({ id: sanction.id, reason: reason.trim() })
      toast.show('success', '处罚已撤销')
      setOpen(false)
      onDone()
    } catch (err) {
      setError(errorText(err, '撤销失败，请稍后重试'))
    }
  }

  return (
    <li className="g-admin-card">
      <div className="g-admin-card-head">
        <span className="g-admin-row-title">
          {sanctionKindLabel(sanction.kind)} · {sanction.displayName || sanction.username}
        </span>
        <Badge tone={sanctionStatusTone(sanction.status)}>
          {sanctionStatusLabel(sanction.status)}
        </Badge>
      </div>
      <p className="g-admin-row-meta">
        <Link to={`/u/${sanction.username}`} className="g-login-link">
          @{sanction.username}
        </Link>
        {' · '}
        {period}
      </p>
      <p className="g-admin-quote">{sanction.reasonDetail || sanction.reasonCode}</p>
      {revoked ? (
        <p className="g-mod-hint">已于 {sanction.revokedAt ? formatDate(sanction.revokedAt) : '未知时间'} 撤销</p>
      ) : !open ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          撤销处罚
        </Button>
      ) : (
        <div className="g-admin-inline-form">
          <Textarea
            label="撤销理由"
            required
            rows={2}
            maxLength={500}
            showCount
            value={reason}
            error={error || undefined}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="g-admin-actions">
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button size="sm" variant="danger" loading={revoke.isPending} onClick={() => void submit()}>
              确认撤销
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
