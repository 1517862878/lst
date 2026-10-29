/**
 * 举报与处罚（/me/moderation，需登录）。
 *
 * 三个 Tab 的数据各自独立查询：任何一个失败只影响自己那一栏，
 * 不会让整页变成错误页（「我的举报」挂了仍然能看到自己的处罚）。
 */
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { Tabs, TabsPrimitive } from '@/components/ui/Tabs'
import { RequireAuth } from '@/components/layout/guards'
import { useSession } from '@/hooks/useSession'
import { useMyAppeals, useMyReports, useMySanctions } from '@/hooks/useModeration'
import { formatDate, relativeTime } from '@/lib/time'
import type { Appeal, MyReport, MySanction } from '@/domain/types'
import { AppealDialog, type AppealSubject } from '@/features/moderation/AppealDialog'
import {
  appealStatusLabel,
  appealStatusTone,
  reasonLabel,
  reportStatusLabel,
  reportStatusTone,
  resolutionLabel,
  sanctionKindLabel,
  sanctionStatusLabel,
  sanctionStatusTone,
  targetKindLabel,
} from '@/features/moderation/copy'

type ModTab = 'reports' | 'sanctions' | 'appeals'

export function MeModerationPage() {
  return (
    <RequireAuth>
      <MeModerationInner />
    </RequireAuth>
  )
}

function MeModerationInner() {
  const [tab, setTab] = useState<ModTab>('reports')
  const [appeal, setAppeal] = useState<AppealSubject | null>(null)
  const { data: session } = useSession()
  const enabled = Boolean(session)
  const reportsQuery = useMyReports(enabled)
  const sanctionsQuery = useMySanctions(enabled)
  const appealsQuery = useMyAppeals(enabled)

  const reportItems = reportsQuery.data ?? []
  const sanctionItems = sanctionsQuery.data ?? []
  const appealItems = appealsQuery.data ?? []

  const items = [
    { value: 'reports', label: '我的举报', count: reportItems.length },
    { value: 'sanctions', label: '我的处罚', count: sanctionItems.length },
    { value: 'appeals', label: '我的申诉', count: appealItems.length },
  ]

  return (
    <Container>
      <PageHeader
        title="举报与处罚"
        description="查看你提交的举报、收到的处罚与申诉进度；处理结果会同时通过站内通知告知。"
        breadcrumbs={[{ label: '首页', to: '/' }, { label: '举报与处罚' }]}
      />

      <Tabs items={items} value={tab} onValueChange={(value) => setTab(value as ModTab)}>
        <TabsPrimitive.Content value="reports" className="g-tabs-content">
          <SectionShell
            loading={reportsQuery.isLoading}
            error={reportsQuery.error}
            onRetry={() => void reportsQuery.refetch()}
            empty={reportItems.length === 0}
            emptyTitle="还没有提交过举报"
            emptyDescription="在作品、评论或个人主页的「更多」里可以举报违规内容。"
          >
            <ul className="g-mod-list">
              {reportItems.map((report) => (
                <ReportRow
                  key={report.id}
                  report={report}
                  onAppeal={() =>
                    setAppeal({
                      kind: 'report',
                      id: report.id,
                      label: `举报 #${report.id} 的驳回结论`,
                    })
                  }
                />
              ))}
            </ul>
          </SectionShell>
        </TabsPrimitive.Content>

        <TabsPrimitive.Content value="sanctions" className="g-tabs-content">
          <SectionShell
            loading={sanctionsQuery.isLoading}
            error={sanctionsQuery.error}
            onRetry={() => void sanctionsQuery.refetch()}
            empty={sanctionItems.length === 0}
            emptyTitle="没有处罚记录"
            emptyDescription="账号状态良好，继续保持。"
          >
            <ul className="g-mod-list">
              {sanctionItems.map((sanction) => (
                <SanctionRow
                  key={sanction.id}
                  sanction={sanction}
                  onAppeal={() =>
                    setAppeal({
                      kind: 'sanction',
                      id: sanction.id,
                      label: `${sanctionKindLabel(sanction.kind)}处罚`,
                    })
                  }
                />
              ))}
            </ul>
          </SectionShell>
        </TabsPrimitive.Content>

        <TabsPrimitive.Content value="appeals" className="g-tabs-content">
          <SectionShell
            loading={appealsQuery.isLoading}
            error={appealsQuery.error}
            onRetry={() => void appealsQuery.refetch()}
            empty={appealItems.length === 0}
            emptyTitle="还没有申诉记录"
            emptyDescription="被驳回的举报或被处罚的记录可以提起申诉。"
          >
            <ul className="g-mod-list">
              {appealItems.map((appeal) => (
                <AppealRow key={appeal.id} appeal={appeal} />
              ))}
            </ul>
          </SectionShell>
        </TabsPrimitive.Content>
      </Tabs>

      <p className="g-mod-footnote">
        对处理结果有异议？
        <Link className="g-login-link" to="/community">
          查看社区规范
        </Link>
        了解判定标准；也可以直接对结论提起申诉。
      </p>

      <AppealDialog
        subject={appeal}
        onClose={() => setAppeal(null)}
        onSubmitted={() => {
          void reportsQuery.refetch()
          void sanctionsQuery.refetch()
          void appealsQuery.refetch()
        }}
      />
    </Container>
  )
}

/** 列表外壳：加载 / 错误 / 空 / 列表 四种状态只写一次 */
function SectionShell({
  loading,
  error,
  onRetry,
  empty,
  emptyTitle,
  emptyDescription,
  children,
}: {
  loading: boolean
  error: unknown
  onRetry: () => void
  empty: boolean
  emptyTitle: string
  emptyDescription: string
  children: ReactNode
}) {
  if (loading) {
    return (
      <div className="g-mod-skeletons" aria-hidden="true">
        <Skeleton variant="rect" height={64} />
        <Skeleton variant="rect" height={64} />
        <Skeleton variant="rect" height={64} />
      </div>
    )
  }
  if (error) return <ErrorState title="加载失败" error={error} onRetry={onRetry} />
  if (empty) return <EmptyState title={emptyTitle} description={emptyDescription} />
  return <>{children}</>
}

function ReportRow({ report, onAppeal }: { report: MyReport; onAppeal: () => void }) {
  const appealStatus = report.appealStatus
  const canAppeal = report.status === 'rejected' && appealStatus === null
  return (
    <li className="g-mod-card">
      <div className="g-mod-card-head">
        <span className="g-mod-card-title">
          举报{targetKindLabel(report.targetType)}
          <span className="g-mod-card-id">#{report.id}</span>
        </span>
        <Badge tone={reportStatusTone(report.status)}>{reportStatusLabel(report.status)}</Badge>
      </div>
      <p className="g-mod-card-meta">
        理由：{reasonLabel(report.reason)} · 提交于 {relativeTime(report.createdAt)}
        {report.resolvedAt ? ` · 结案 ${formatDate(report.resolvedAt)}` : ''}
      </p>
      {report.detail && <p className="g-mod-card-body">{report.detail}</p>}
      {report.status === 'rejected' && report.reviewNote && (
        <p className="g-mod-card-note">结论：{resolutionLabel(report.resolutionCode) || '未发现违规'}
          {report.reviewNote ? ` · ${report.reviewNote}` : ''}</p>
      )}
      {report.status === 'upheld' && report.reviewNote && (
        <p className="g-mod-card-note">处理说明：{report.reviewNote}</p>
      )}
      <div className="g-mod-card-foot">
        {appealStatus && (
          <Badge tone={appealStatusTone(appealStatus)}>申诉{appealStatusLabel(appealStatus)}</Badge>
        )}
        {canAppeal && (
          <Button size="sm" variant="secondary" onClick={onAppeal}>
            申诉
          </Button>
        )}
        {!canAppeal && !appealStatus && (report.status === 'open' || report.status === 'reviewing') && (
          <span className="g-mod-hint">我们正在处理，结案后可在此查看结论</span>
        )}
      </div>
    </li>
  )
}

function SanctionRow({ sanction, onAppeal }: { sanction: MySanction; onAppeal: () => void }) {
  const period = sanction.endsAt
    ? `${formatDate(sanction.startsAt)} – ${formatDate(sanction.endsAt)}`
    : `${formatDate(sanction.startsAt)} 起，长期`
  const appealStatus = sanction.appealStatus
  const canAppeal = sanction.status !== 'revoked' && appealStatus === null
  return (
    <li className="g-mod-card">
      <div className="g-mod-card-head">
        <span className="g-mod-card-title">
          {sanctionKindLabel(sanction.kind)}
          <span className="g-mod-card-id">#{sanction.id}</span>
        </span>
        <Badge tone={sanctionStatusTone(sanction.status)}>
          {sanctionStatusLabel(sanction.status)}
        </Badge>
      </div>
      <p className="g-mod-card-meta">期限：{period}</p>
      <p className="g-mod-card-body">
        {sanction.reasonDetail || `处理类型：${sanction.reasonCode}`}
      </p>
      <div className="g-mod-card-foot">
        {appealStatus && (
          <Badge tone={appealStatusTone(appealStatus)}>申诉{appealStatusLabel(appealStatus)}</Badge>
        )}
        {canAppeal && (
          <Button size="sm" variant="secondary" onClick={onAppeal}>
            申诉
          </Button>
        )}
        {sanction.status === 'revoked' && <span className="g-mod-hint">这次处罚已被撤销</span>}
      </div>
    </li>
  )
}

function AppealRow({ appeal }: { appeal: Appeal }) {
  return (
    <li className="g-mod-card">
      <div className="g-mod-card-head">
        <span className="g-mod-card-title">
          {appeal.reportId ? `举报 #${appeal.reportId}` : `处罚 #${appeal.sanctionId}`} 的申诉
        </span>
        <Badge tone={appealStatusTone(appeal.status)}>{appealStatusLabel(appeal.status)}</Badge>
      </div>
      <p className="g-mod-card-meta">提交于 {relativeTime(appeal.createdAt)}</p>
      <p className="g-mod-card-body">{appeal.message}</p>
      {appeal.reviewNote && <p className="g-mod-card-note">复核意见：{appeal.reviewNote}</p>}
      {appeal.reviewedAt && (
        <p className="g-mod-card-meta">复核时间：{formatDate(appeal.reviewedAt)}</p>
      )}
    </li>
  )
}
