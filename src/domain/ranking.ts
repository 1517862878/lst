/**
 * 周排行榜纯函数（ROADMAP §6.2 / FRONTEND-WORK §4.7）。
 * 规则：零 React 依赖、输入输出纯数据；可在 Web Worker 运行。
 * 评分公式 v1：score = 1.0 × 点赞 + 3.0 × 收藏（作者自赞自藏不计）。
 */
import type { Interaction, Photo } from './types'

/** 权重常量（与 formulaVersion 绑定；升级必须升版本号） */
export const RANKING_WEIGHTS = { like: 1, favorite: 3 } as const
export const RANKING_FORMULA_VERSION = 'v1'

/** 榜单时区（Asia/Shanghai 无夏令时，周边界稳定） */
export const RANKING_TIMEZONE = 'Asia/Shanghai'

export interface RankingComputationInput {
  photos: Photo[]
  likes: Interaction[]
  favorites: Interaction[]
}

export interface RankingComputationResult {
  entries: Array<{
    rank: number
    photo: Photo
    likeCount: number
    favoriteCount: number
    score: number
    tieBreakKey: string
  }>
}

/**
 * 计算某一周窗口内的榜单。
 * 窗口为半开区间 [weekStartUtc, weekEndUtc)；互动 createdAt 落在窗口内才计入。
 * 排序键全序：score DESC → favoriteCount DESC → likeCount DESC → publishedAt ASC → id ASC
 * （名次唯一、两次计算恒等，ROADMAP §6.3）。
 */
export function computeWeeklyRanking(
  input: RankingComputationInput,
  weekStartUtc: string,
  weekEndUtc: string,
): RankingComputationResult {
  const start = Date.parse(weekStartUtc)
  const end = Date.parse(weekEndUtc)

  const inWindow = (i: Interaction): boolean => {
    const t = Date.parse(i.createdAt)
    return t >= start && t < end
  }

  /** 作者自赞自藏权重为 0：按作品作者过滤（ROADMAP §6.1） */
  const authorOf = new Map(input.photos.map((p) => [p.id, p.authorId]))
  const excludeSelf = (i: Interaction): boolean => i.userId !== authorOf.get(i.photoId)

  const likeCounts = countByPhoto(input.likes.filter(inWindow).filter(excludeSelf))
  const favoriteCounts = countByPhoto(input.favorites.filter(inWindow).filter(excludeSelf))

  // 上榜资格：published 且 publishedAt < weekEndUtc（ROADMAP §6.1）
  const eligible = input.photos.filter(
    (p) => p.status === 'published' && p.publishedAt !== null && Date.parse(p.publishedAt) < end,
  )

  const rows = eligible
    .map((photo) => {
      const l = likeCounts.get(photo.id) ?? 0
      const f = favoriteCounts.get(photo.id) ?? 0
      const score = RANKING_WEIGHTS.like * l + RANKING_WEIGHTS.favorite * f
      const tieBreakKey = `score:${score.toFixed(2)}|f:${f}|l:${l}|${photo.publishedAt ?? ''}|${photo.id}`
      return { photo, likeCount: l, favoriteCount: f, score, tieBreakKey }
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.favoriteCount !== a.favoriteCount) return b.favoriteCount - a.favoriteCount
      if (b.likeCount !== a.likeCount) return b.likeCount - a.likeCount
      const pa = a.photo.publishedAt ?? ''
      const pb = b.photo.publishedAt ?? ''
      if (pa !== pb) return pa < pb ? -1 : 1
      return a.photo.id < b.photo.id ? -1 : a.photo.id > b.photo.id ? 1 : 0
    })

  return {
    entries: rows.map((row, index) => ({
      rank: index + 1,
      ...row,
    })),
  }
}

/**
 * 统计互动计数：`authorId === photo.authorId` 的自赞自藏权重为 0（ROADMAP §6.1），
 * 本函数按 photo 的作者过滤，返回“作者以外”的计数。
 */
function countByPhoto(
  interactions: Interaction[],
): Map<string, number> {
  const map = new Map<string, number>()
  for (const i of interactions) {
    map.set(i.photoId, (map.get(i.photoId) ?? 0) + 1)
  }
  return map
}
