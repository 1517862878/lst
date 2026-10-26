/**
 * 周榜页 /rankings/weekly（FRONTEND-WORK §2.7）+ 历史周榜 /rankings/weekly/:isoWeek（§2.8）。
 * 当期实时榜 + 历史终榜 + 规则说明（公开透明）。
 */
import { useParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { RankingTable } from '@/features/rankings/RankingTable'
import { useWeeklyRanking } from '@/hooks/useContent'
import { currentIsoWeek, weekRangeUtc } from '@/lib/time'
import { RANKING_FORMULA_VERSION, RANKING_WEIGHTS } from '@/domain/ranking'
import { useInteractionSync } from '@/hooks/useInteractions'

export function RankingPage() {
  const { isoWeek } = useParams()
  const week = isoWeek ?? currentIsoWeek()
  const kind: 'live' | 'final' = isoWeek ? 'final' : 'live'
  const query = useWeeklyRanking(week, kind)
  useInteractionSync()

  const range = (() => {
    try {
      return weekRangeUtc(week)
    } catch {
      return null
    }
  })()

  return (
    <Container>
      <PageHeader
        title={isoWeek ? `${week} 历史周榜` : '本周排行榜'}
        description={
          isoWeek
            ? '已结算的历史榜单（结果恒定）'
            : '实时榜单（点赞 + 收藏加权，每周一结算）'
        }
        breadcrumbs={[{ label: '首页', to: '/' }, { label: '周榜' }]}
      />

      <div className="g-ranking-meta" aria-label="榜单信息">
        {range && (
          <span className="g-ranking-window">
            {range.start.slice(0, 10)} ~ {range.end.slice(0, 10)}
          </span>
        )}
        <span>公式版本 {RANKING_FORMULA_VERSION}</span>
      </div>

      {query.isLoading ? (
        <div className="g-detail-skeleton" aria-hidden="true">
          <Skeleton variant="rect" height={80} />
          <Skeleton variant="rect" height={80} />
          <Skeleton variant="rect" height={80} />
        </div>
      ) : query.isError ? (
        <ErrorState title="榜单加载失败" error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <RankingTable entries={query.data?.entries ?? []} />
      )}

      <details className="g-ranking-rules">
        <summary>榜单规则说明（公开透明）</summary>
        <dl className="g-ranking-rules-list">
          <div className="g-ranking-rule-row">
            <dt>评分公式</dt>
            <dd>
              score = {RANKING_WEIGHTS.like} × 点赞 + {RANKING_WEIGHTS.favorite} × 收藏
            </dd>
          </div>
          <div className="g-ranking-rule-row">
            <dt>统计周期</dt>
            <dd>自然周（周一 00:00 ~ 次周一 00:00，Asia/Shanghai）</dd>
          </div>
          <div className="g-ranking-rule-row">
            <dt>名次规则</dt>
            <dd>按 score → 收藏数 → 点赞数 → 发布时间 → 作品 ID 全序，名次唯一不并列</dd>
          </div>
          <div className="g-ranking-rule-row">
            <dt>反作弊</dt>
            <dd>作者自赞自藏不计分；仅统计已发布作品</dd>
          </div>
        </dl>
      </details>
    </Container>
  )
}
