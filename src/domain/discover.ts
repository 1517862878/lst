/**
 * 发现页的纯函数层（8.3c）。
 *
 * 与 social.ts 同一策略：把「窗口、阈值、排序、截断」这些真正的业务规则做成
 * 不依赖数据库/网络/React 的纯函数，mock 仓储与单测共用；api 侧由 Postgres
 * 函数（api_hot_searches / api_list_new_authors / api_list_featured_photos）实现
 * 同一份口径，参数范围也在这里对齐，避免两套实现各夹各的。
 *
 * 口径（与 .tmp/phase83c-freeze.md 第 2 节逐条对应）：
 *   · 热门搜索：近 days 天、同一 term 出现 ≥ 3 次，按次数降序、同次数按最近一次搜索降序；
 *   · 新作者：近 days 天创建、非 staff、未删除、至少 1 件在架作品，
 *             按（在架作品总获赞 desc、作品数 desc、创建时间 desc）排序；
 *   · 编辑精选：featuredAt 非空且在架，按 featuredAt desc、id desc。
 */
import type { HotSearch, NewAuthor, Photo, Profile } from './types'

/** 热门搜索窗口（天）与条数 —— 与 api_hot_searches 的默认值一致 */
export const HOT_SEARCH_DAYS = 7
export const HOT_SEARCH_LIMIT = 10
/** 低于这个出现次数不进热门（去噪：一两个人搜一次不算「热门」） */
export const HOT_SEARCH_MIN_COUNT = 3
export const HOT_SEARCH_DAYS_MIN = 1
export const HOT_SEARCH_DAYS_MAX = 30
export const HOT_SEARCH_LIMIT_MAX = 20

/** 新作者窗口（天）与条数 —— 与 api_list_new_authors 的默认值一致 */
export const NEW_AUTHOR_DAYS = 90
export const NEW_AUTHOR_LIMIT = 6
export const NEW_AUTHOR_DAYS_MIN = 7
export const NEW_AUTHOR_DAYS_MAX = 365
export const NEW_AUTHOR_LIMIT_MAX = 20

/** 编辑精选首页条数 */
export const FEATURED_LIMIT = 12
export const FEATURED_LIMIT_MAX = 50

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 参数夹取：非法值（NaN、越界）回落到默认值而不是报错。
 * mock 与页面共用；api 侧对「非法值」返回 400，但夹取逻辑仍以此为准。
 */
export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}

/** 在架口径：已发布、未删除、有发布时间。与后端 RLS 的公开可见口径一致。 */
export function isPublicPhoto(photo: Photo): boolean {
  return photo.status === 'published' && !photo.deletedAt && Boolean(photo.publishedAt)
}

function withinDays(iso: string | null | undefined, now: number, days: number): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return false
  return t >= now - days * DAY_MS
}

/** 关键词归一：与搜索日志的 term_key = lower(btrim(term)) 同口径 */
export function normalizeHotTerm(term: string): string {
  return term.trim().toLocaleLowerCase()
}

/**
 * 热门搜索（mock 版口径）。
 *
 * mock 没有搜索日志表，这里用「近 N 天在架作品的标签」当搜索词的代理：
 * 标签就是用户实际会输入的检索词，且计数天然来自真实内容，不会像随机构造的
 * 假计数那样一点就搜不到东西。阈值与排序规则与 api_hot_searches 完全一致。
 *
 * @param photos 全部作品（内部只统计近 days 天发布的）
 */
export function buildHotSearches(
  photos: readonly Photo[],
  days: number = HOT_SEARCH_DAYS,
  limit: number = HOT_SEARCH_LIMIT,
  now: number = Date.now(),
): HotSearch[] {
  const stats = new Map<string, { term: string; count: number; lastAt: string }>()
  for (const photo of photos) {
    if (!isPublicPhoto(photo) || !withinDays(photo.publishedAt, now, days)) continue
    for (const tag of photo.tags) {
      const term = tag.trim()
      if (!term) continue
      const key = normalizeHotTerm(term)
      const entry = stats.get(key)
      if (entry) {
        entry.count += 1
        if ((photo.publishedAt ?? '') > entry.lastAt) {
          entry.lastAt = photo.publishedAt ?? ''
          // 保留最近一次的原始写法（与 api 的「取该 term_key 下最近一次写法」一致）
          entry.term = term
        }
      } else {
        stats.set(key, { term, count: 1, lastAt: photo.publishedAt ?? '' })
      }
    }
  }

  return [...stats.values()]
    .filter((entry) => entry.count >= HOT_SEARCH_MIN_COUNT)
    .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
    .slice(0, clampInt(limit, HOT_SEARCH_LIMIT, 1, HOT_SEARCH_LIMIT_MAX))
    .map((entry) => ({ term: entry.term, searchCount: entry.count }))
}

/** staff 不参与「新作者」推荐：编辑/管理员账号不是被发现的普通作者 */
function isStaff(profile: Profile): boolean {
  return profile.role === 'editor' || profile.role === 'admin'
}

/**
 * 新作者推荐。
 *
 * 「新」的口径是 profiles.created_at 落在近 days 天内。演示数据创建于播种时刻，
 * 时间一久整块就会空掉——所以窗口内没有任何人时回落到「所有符合内容条件的
 * 非 staff 作者」，按同样的排序取前 limit 个，保证演示环境不会出现空区块
 * （真实数据里几乎不会命中这条兜底）。
 */
export function buildNewAuthors(
  profiles: readonly Profile[],
  photos: readonly Photo[],
  days: number = NEW_AUTHOR_DAYS,
  limit: number = NEW_AUTHOR_LIMIT,
  now: number = Date.now(),
): NewAuthor[] {
  const publicPhotos = photos.filter(isPublicPhoto)
  const byAuthor = new Map<string, { count: number; likes: number }>()
  for (const photo of publicPhotos) {
    const entry = byAuthor.get(photo.authorId) ?? { count: 0, likes: 0 }
    entry.count += 1
    entry.likes += photo.likeCount
    byAuthor.set(photo.authorId, entry)
  }

  const candidates = profiles.filter(
    (profile) => !profile.deletedAt && !isStaff(profile) && (byAuthor.get(profile.id)?.count ?? 0) > 0,
  )
  const fresh = candidates.filter((profile) => withinDays(profile.createdAt, now, days))
  const pool = fresh.length > 0 ? fresh : candidates

  return pool
    .map((profile) => {
      const stat = byAuthor.get(profile.id)!
      return {
        username: profile.username,
        displayName: profile.displayName || profile.username,
        avatarKey: profile.avatarKey,
        photoCount: stat.count,
        likeTotal: stat.likes,
        createdAt: profile.createdAt,
      }
    })
    .sort(
      (a, b) =>
        b.likeTotal - a.likeTotal ||
        b.photoCount - a.photoCount ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.username.localeCompare(b.username),
    )
    .slice(0, clampInt(limit, NEW_AUTHOR_LIMIT, 1, NEW_AUTHOR_LIMIT_MAX))
}

/** 编辑精选作品流：featuredAt 非空 + 在架，按 featuredAt desc、id desc */
export function sortFeaturedPhotos(photos: readonly Photo[]): Photo[] {
  return photos
    .filter((photo) => isPublicPhoto(photo) && Boolean(photo.featuredAt))
    .sort(
      (a, b) =>
        (b.featuredAt ?? '').localeCompare(a.featuredAt ?? '') || b.id.localeCompare(a.id),
    )
}
