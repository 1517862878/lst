/**
 * 创作者统计的纯函数层（8.3d）。
 *
 * 与 social.ts / discover.ts 同一策略：把「口径、排序、分页夹取」这些真正的业务
 * 规则做成不依赖数据库/网络/React 的纯函数，mock 仓储与单测共用；api 侧由
 * Postgres 函数（api_my_stats / api_my_photo_stats）实现同一份口径。
 *
 * 口径（与 supabase/migrations/20261029003000_notification_and_stats.sql 的
 * api_creator_stats / api_photo_stats 逐条对齐，mock 与 api 才能互换）：
 *   · 作品数 = 本人名下未删除的作品（含草稿、已下架、被隐藏）；
 *   · 在架   = status='published' 且未删除（与公开可见口径 isPublicPhoto 一致）；
 *   · 草稿   = status='draft' 且未删除；
 *   · 获赞/收藏/评论/浏览 = **只累加在架作品**上的派生计数。
 *     草稿的浏览与点赞不计入「影响力」：草稿根本没见过人，把它算进去会让作者
 *     对「这件作品火了」产生错误判断。
 *   · 粉丝/关注 = follows 表里指向我 / 由我发出的条数。
 */
import type { CreatorStats, Follow, Photo, PhotoStats } from './types'

/** 作品数据表默认行数 —— 与后端 api_my_photo_stats 的默认 limit=50 一致 */
export const PHOTO_STATS_LIMIT = 50
export const PHOTO_STATS_LIMIT_MIN = 1
export const PHOTO_STATS_LIMIT_MAX = 100
export const PHOTO_STATS_OFFSET_MIN = 0

/**
 * 参数夹取：非法值（NaN / 越界 / 非数字）回落到默认值。
 *
 * 与后端「越界返回 400」并存：api 实现对非法值直接抛 VALIDATION，
 * mock 实现用这里的夹取（本地库不该因为翻页参数写错就整页报错）。
 */
export function clampStatsLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return PHOTO_STATS_LIMIT
  return Math.min(Math.max(Math.trunc(value), PHOTO_STATS_LIMIT_MIN), PHOTO_STATS_LIMIT_MAX)
}

export function clampStatsOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return PHOTO_STATS_OFFSET_MIN
  return Math.max(Math.trunc(value), PHOTO_STATS_OFFSET_MIN)
}

/** 本人名下、未删除的作品（统计口径的取样范围） */
export function statsPhotosOf(photos: readonly Photo[], userId: string): Photo[] {
  return photos.filter((photo) => photo.authorId === userId && photo.deletedAt === null)
}

/**
 * 汇总我的创作数据。
 *
 * 计数优先用行上的派生字段（likeCount 等）：它们在点赞/评论写入时同步维护，
 * 再回表数 likes/comments 只会得到同一个数字，却要多读两张表。
 *
 * 注意 published 判定与计数累加是**同一个条件**：四个互动总数只收在架作品，
 * 与后端 filter (where status='published' and deleted_at is null) 一致。
 */
export function creatorStatsOf(
  photos: readonly Photo[],
  follows: readonly Follow[],
  userId: string,
): CreatorStats {
  const mine = statsPhotosOf(photos, userId)
  let publishedCount = 0
  let draftCount = 0
  let likeTotal = 0
  let favoriteTotal = 0
  let commentTotal = 0
  let viewTotal = 0

  for (const photo of mine) {
    if (photo.status === 'published') {
      publishedCount += 1
      likeTotal += photo.likeCount
      favoriteTotal += photo.favoriteCount
      commentTotal += photo.commentCount
      viewTotal += photo.viewCount
    } else if (photo.status === 'draft') {
      draftCount += 1
    }
  }

  let followerCount = 0
  let followingCount = 0
  for (const follow of follows) {
    if (follow.followingId === userId) followerCount += 1
    if (follow.followerId === userId) followingCount += 1
  }

  return {
    photoCount: mine.length,
    publishedCount,
    draftCount,
    likeTotal,
    favoriteTotal,
    commentTotal,
    viewTotal,
    followerCount,
    followingCount,
  }
}

/**
 * 统计视图的状态口径：hidden（被审核隐藏）并入 removed。
 *
 * 为什么合并：数据表的「状态」列是给作者看「这件还在不在外面」，
 * 隐藏与下架对作者的处置动作是同一个（都看不到），再分一格只会让人困惑。
 */
export function statsStatusOf(photo: Photo): PhotoStats['status'] {
  if (photo.status === 'published') return 'published'
  if (photo.status === 'draft') return 'draft'
  return 'removed'
}

/**
 * 数据表排序：按「发布时间，没有就用创建时间」倒序，同时间按 id 倒序。
 *
 * 与后端 `order by coalesce(published_at, created_at) desc, id desc` 逐字一致
 * —— 这里**不做**「在架优先」的二次分组：两套实现必须给出同样的前 50 行，
 * 否则 mock 演示与真实环境看到的顺序不同，翻页也会错位。
 */
function compareStatsRows(a: Photo, b: Photo): number {
  const ta = a.publishedAt ?? a.createdAt
  const tb = b.publishedAt ?? b.createdAt
  if (ta !== tb) return ta < tb ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/** 我的作品数据行（按 limit/offset 切片，供「查看全部」翻页复用） */
export function photoStatsOf(
  photos: readonly Photo[],
  userId: string,
  query?: { limit?: number; offset?: number },
): PhotoStats[] {
  const limit = clampStatsLimit(query?.limit)
  const offset = clampStatsOffset(query?.offset)
  return statsPhotosOf(photos, userId)
    .sort(compareStatsRows)
    .slice(offset, offset + limit)
    .map((photo) => ({
      photoId: photo.id,
      title: photo.title,
      status: statsStatusOf(photo),
      publishedAt: photo.publishedAt,
      likeCount: photo.likeCount,
      favoriteCount: photo.favoriteCount,
      commentCount: photo.commentCount,
      viewCount: photo.viewCount,
      // 公开投影里 featuredAt 可能是 undefined（见 Photo.featuredAt 注释），
      // 统计行的契约是 `IsoDate | null`，这里统一收敛成 null
      featuredAt: photo.featuredAt ?? null,
    }))
}
