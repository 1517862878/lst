/**
 * 榜单组件（FRONTEND-WORK §3.3 RankingTable/RankBadge/RankChangeIndicator/ScoreBar）。
 */
import { Link } from 'react-router'
import type { RankingEntry } from '@/domain/types'
import { PhotoThumb } from '@/features/photos/PhotoThumb'
import { usePhoto } from '@/hooks/usePhotos'
import { cn } from '@/lib/cn'

export function RankBadge({ rank }: { rank: number }) {
  const tone = rank === 1 ? 'g-rank-badge-1' : rank === 2 ? 'g-rank-badge-2' : rank === 3 ? 'g-rank-badge-3' : ''
  return (
    <span className={cn('g-rank-badge', tone)} aria-label={`第 ${rank} 名`}>
      {rank}
    </span>
  )
}

export function RankChangeIndicator({ change }: { change: number | null }) {
  if (change === null) {
    return <span className="g-rank-change g-rank-change-new">NEW</span>
  }
  if (change === 0) {
    return <span className="g-rank-change">—</span>
  }
  if (change > 0) {
    return (
      <span className="g-rank-change g-rank-change-up" aria-label={`上升 ${change} 名`}>
        ↑{change}
      </span>
    )
  }
  return (
    <span className="g-rank-change g-rank-change-down" aria-label={`下降 ${Math.abs(change)} 名`}>
      ↓{Math.abs(change)}
    </span>
  )
}

export function ScoreBar({ score, maxScore }: { score: number; maxScore: number }) {
  const pct = maxScore > 0 ? Math.max(2, (score / maxScore) * 100) : 0
  return (
    <div className="g-score-bar" role="img" aria-label={`得分 ${score.toFixed(1)}`}>
      <div className="g-score-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function RankingTable({ entries }: { entries: RankingEntry[] }) {
  const maxScore = entries[0]?.score ?? 1

  if (entries.length === 0) {
    return <p className="g-placeholder-text">本周还没有上榜作品。</p>
  }

  return (
    <ol className="g-ranking-list">
      {entries.map((entry) => (
        <RankingRow key={`${entry.snapshotId}-${entry.rank}`} entry={entry} maxScore={maxScore} />
      ))}
    </ol>
  )
}

function RankingRow({ entry, maxScore }: { entry: RankingEntry; maxScore: number }) {
  const { data: photo } = usePhoto(entry.photoId)

  return (
    <li className="g-ranking-row">
      <RankBadge rank={entry.rank} />
      <div className="g-ranking-thumb">
        {photo && <PhotoThumb photo={photo} />}
      </div>
      <div className="g-ranking-info">
        <Link to={`/works/${entry.photoId}`} className="g-ranking-title">
          {photo?.title ?? '加载中…'}
        </Link>
        <div className="g-ranking-counts">
          <span aria-label={`点赞 ${entry.likeCount}`}>👍 {entry.likeCount}</span>
          <span aria-label={`收藏 ${entry.favoriteCount}`}>⭐ {entry.favoriteCount}</span>
          <span className="g-ranking-score">得分 {entry.score.toFixed(1)}</span>
        </div>
        <ScoreBar score={entry.score} maxScore={maxScore} />
      </div>
    </li>
  )
}
