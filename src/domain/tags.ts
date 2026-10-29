/**
 * 标签的纯函数层（8.3a）。
 *
 * 为什么单独抽一层（与 domain/social.ts 同一理由）：
 *   vitest 跑在 jsdom 里，**没有 IndexedDB**，mock 仓储的数据库路径根本跑不起来。
 *   把「聚合 / 排序 / 前缀过滤 / 共现 / 游标排键」这些真正含业务规则的逻辑做成
 *   不依赖数据库的纯函数，mock 与 api 两套实现共用同一份口径，单测才能覆盖规则本身。
 *
 * 无 React、无仓储、无副作用。
 */
import type { Photo } from './types'

/** 标签作品流默认页长（与后端 /api/tags/:tag/photos 的默认 limit 对齐） */
export const TAG_PAGE_SIZE = 20
/** 列表端点允许的最大条数（后端硬上限 50） */
export const TAG_PAGE_LIMIT_MAX = 50
/** 标签长度上限（与后端校验一致，超长直接判定为非法标签） */
export const TAG_MAX_LENGTH = 32
/** 输入建议默认条数 */
export const TAG_SUGGEST_LIMIT = 10
/** 相关标签默认条数 */
export const TAG_RELATED_LIMIT = 12

/** 标签聚合统计（与 contracts.TagSummary 结构一致；domain 不反向依赖 data 层） */
export interface TagStat {
  tag: string
  photoCount: number
  authorCount: number
  latestPublishedAt: string | null
}

export interface TagCoOccurrence {
  tag: string
  count: number
}

export type TagSort = 'hot' | 'latest'
export type TagPhotoSort = 'latest' | 'popular'

/** 标签原文归一：只去首尾空白，不改大小写（展示要用作者写下的那个） */
export function normalizeTagValue(raw: string): string {
  return raw.trim()
}

/**
 * 比较用的键：大小写不敏感。
 * 后端 normalize_photo_tags 会把英文标签转小写，前端比较时也要跟着不敏感，
 * 否则「Landscape」与「landscape」会算成两个标签。
 */
export function tagKey(tag: string): string {
  return normalizeTagValue(tag).toLocaleLowerCase()
}

/** 标签是否合法：非空且不超过上限（超出时按键处理，而不是截断拼出一个新标签） */
export function isValidTag(tag: string): boolean {
  const value = normalizeTagValue(tag)
  return value.length > 0 && value.length <= TAG_MAX_LENGTH
}

/**
 * 是否参与标签统计：只算已发布且未删除的作品。
 * 草稿 / 待审出现标签页等于泄露未公开内容，两套实现必须同一口径。
 */
export function isTagEligible(photo: Photo): boolean {
  return photo.status === 'published' && photo.deletedAt === null
}

/** 取一条作品上去重后的有效标签 */
function tagsOf(photo: Photo): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of photo.tags) {
    const tag = normalizeTagValue(raw)
    if (!tag) continue
    const key = tagKey(tag)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

/** 聚合标签统计：作品数 / 作者数（去重）/ 最近发布时间 */
export function tagStats(photos: readonly Photo[]): TagStat[] {
  interface Acc {
    tag: string
    photos: number
    authors: Set<string>
    latest: string | null
  }
  const map = new Map<string, Acc>()

  for (const photo of photos) {
    if (!isTagEligible(photo)) continue
    for (const tag of tagsOf(photo)) {
      const key = tagKey(tag)
      let acc = map.get(key)
      if (!acc) {
        acc = { tag, photos: 0, authors: new Set<string>(), latest: null }
        map.set(key, acc)
      }
      acc.photos += 1
      acc.authors.add(photo.authorId)
      const at = photo.publishedAt ?? photo.createdAt
      if (at && (acc.latest === null || at > acc.latest)) acc.latest = at
    }
  }

  return [...map.values()].map((acc) => ({
    tag: acc.tag,
    photoCount: acc.photos,
    authorCount: acc.authors.size,
    latestPublishedAt: acc.latest,
  }))
}

/** 前缀过滤（空前缀 = 全部）；大小写不敏感 */
export function filterTagStats(stats: readonly TagStat[], prefix?: string): TagStat[] {
  const key = tagKey(prefix ?? '')
  if (!key) return [...stats]
  return stats.filter((stat) => tagKey(stat.tag).startsWith(key))
}

/**
 * 排序。两种排序都以 tag 作为最后一级比较键：
 * 排序不稳定会让「热门标签」在两次请求间换位置（用户以为数据在乱跳）。
 */
export function sortTagStats(stats: readonly TagStat[], sort: TagSort): TagStat[] {
  return [...stats].sort((a, b) => {
    if (sort === 'hot') {
      if (a.photoCount !== b.photoCount) return b.photoCount - a.photoCount
    }
    const at = a.latestPublishedAt ?? ''
    const bt = b.latestPublishedAt ?? ''
    if (at !== bt) return at < bt ? 1 : -1
    if (sort === 'latest' && a.photoCount !== b.photoCount) return b.photoCount - a.photoCount
    return a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0
  })
}

/** 取前 n 条：limit 省略用默认页长，越界按 1..上限 夹住（负数不该被当成「全部」） */
export function limitTagStats(stats: readonly TagStat[], limit?: number): TagStat[] {
  const size =
    typeof limit === 'number' && Number.isFinite(limit)
      ? Math.min(Math.max(Math.trunc(limit), 1), TAG_PAGE_LIMIT_MAX)
      : TAG_PAGE_SIZE
  return stats.slice(0, size)
}

/** 与 tag 共同出现在同一作品上的其他标签（按共现数降序，最多 TAG_RELATED_LIMIT 条） */
export function relatedTags(
  photos: readonly Photo[],
  tag: string,
  limit: number = TAG_RELATED_LIMIT,
): TagCoOccurrence[] {
  const key = tagKey(tag)
  if (!key) return []
  const map = new Map<string, TagCoOccurrence>()

  for (const photo of photos) {
    if (!isTagEligible(photo)) continue
    const tags = tagsOf(photo)
    if (!tags.some((t) => tagKey(t) === key)) continue
    for (const other of tags) {
      const otherKey = tagKey(other)
      if (otherKey === key) continue
      const hit = map.get(otherKey)
      if (hit) hit.count += 1
      else map.set(otherKey, { tag: other, count: 1 })
    }
  }

  return [...map.values()]
    .sort((a, b) => (a.count !== b.count ? b.count - a.count : a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
    .slice(0, Math.max(1, Math.min(limit, TAG_RELATED_LIMIT)))
}

/** 标签详情：未知标签返回空详情（不抛错），相关标签照常算 */
export function tagDetail(
  photos: readonly Photo[],
  tag: string,
  relatedLimit: number = TAG_RELATED_LIMIT,
): TagStat & { relatedTags: TagCoOccurrence[] } {
  const key = tagKey(tag)
  const stat = tagStats(photos).find((item) => tagKey(item.tag) === key)
  return {
    tag: stat?.tag ?? normalizeTagValue(tag),
    photoCount: stat?.photoCount ?? 0,
    authorCount: stat?.authorCount ?? 0,
    latestPublishedAt: stat?.latestPublishedAt ?? null,
    relatedTags: stat ? relatedTags(photos, tag, relatedLimit) : [],
  }
}

/** 标签作品流：过滤可参与聚合且带该标签的作品 */
export function photosWithTag(photos: readonly Photo[], tag: string): Photo[] {
  const key = tagKey(tag)
  if (!key) return []
  return photos.filter(
    (photo) => isTagEligible(photo) && tagsOf(photo).some((t) => tagKey(t) === key),
  )
}

/**
 * 标签作品流排序（必须与游标键 id 组成全序）：
 *   latest  —— 发布时间倒序
 *   popular —— 点赞 + 收藏倒序，同分再按发布时间倒序
 * 时间相同时统一用 id 兜底，保证翻页不重复、不漏项。
 */
export function sortTagPhotos(photos: readonly Photo[], sort: TagPhotoSort): Photo[] {
  const at = (photo: Photo) => photo.publishedAt ?? photo.createdAt
  return [...photos].sort((a, b) => {
    if (sort === 'popular') {
      const scoreA = a.likeCount + a.favoriteCount
      const scoreB = b.likeCount + b.favoriteCount
      if (scoreA !== scoreB) return scoreB - scoreA
    }
    const ta = at(a)
    const tb = at(b)
    if (ta !== tb) return ta < tb ? 1 : -1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}
