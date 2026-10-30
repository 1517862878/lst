/**
 * 社交关系的纯函数层（二期闭环）。
 *
 * 为什么单独抽一层：
 *   vitest 跑在 jsdom 里，**没有 IndexedDB**，mock 仓储的数据库路径（idb 调用）
 *   在单测里根本跑不起来。把「排序 / 过滤 / 游标编解码 / 未读统计 / 文案」这些
 *   真正含业务规则的逻辑做成不依赖数据库的纯函数，mock 与 api 两套实现共用同一份，
 *   单测才能覆盖到规则本身（IndexedDB 与网络路径由 E2E 覆盖）。
 *
 * 无 React、无仓储、无副作用。
 */
import type { AppNotification, BlockedUser, Follow, FollowCounts, Photo, Profile, UserHit } from './types'

/** domain 层只依赖该最小形状，避免反向依赖 data/mock。 */
export interface BlockRelation {
  blockerId: string
  blockedId: string
  createdAt: string
}

/** 列表默认页长（关注列表 / 关注动态） */
export const SOCIAL_PAGE_SIZE = 24
/** 通知默认页长 */
export const NOTIFICATION_PAGE_SIZE = 20
/** 拉黑列表默认页长（与后端 api_list_blocks 的默认 limit=20 对齐） */
export const BLOCK_PAGE_SIZE = 20
/** 用户搜索默认条数（与后端 api_search_users 的默认 limit=20 对齐） */
export const USER_SEARCH_PAGE_SIZE = 20
/** 搜索关键词长度上限（1–30，与 0024 的 api_search_users 逐字一致） */
export const SEARCH_QUERY_MAX_LENGTH = 30

/** 游标分页返回（与契约一致：items + nextCursor，不带 total） */
export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
}

// ===== 游标 =====

/**
 * 编码游标：base64url(最后一条的排序键)。
 *
 * 用编码而不是裸 id，是为了让游标对前端「不透明」——调用方不应该能从中读出
 * 业务含义（否则有人会开始拼游标），同时避免 id 里的 '/'、'#' 破坏 URL。
 */
export function encodeCursor(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let raw = ''
  for (const b of bytes) raw += String.fromCharCode(b)
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 解码游标；非法游标返回 null（当作「从头开始」而不是抛错，避免老链接直接 500） */
export function decodeCursor(cursor: string): string | null {
  try {
    const padded = cursor.replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

// ===== 通用列表操作 =====

/**
 * 按 createdAt 倒序（新的在前）。
 * createdAt 相同时用 keyOf 再排一次，保证「全序」——排序不稳定会让游标分页
 * 在边界上重复或漏项（同一个时间戳的一批数据必须每次排出同样顺序）。
 */
export function sortByCreatedAtDesc<T extends { createdAt: string }>(
  items: readonly T[],
  keyOf?: (item: T) => string,
): T[] {
  return [...items].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
    if (!keyOf) return 0
    const ka = keyOf(a)
    const kb = keyOf(b)
    return ka < kb ? 1 : ka > kb ? -1 : 0
  })
}

/**
 * 游标分页：cursor 指向「上一页最后一条」的排序键，本页从它之后开始。
 *
 * keyOf 必须与列表的排序键一致（这里都是各自主键），否则翻页会重复或漏项。
 * 非法/未知游标 → 返回首页（decodeCursor 已经保证不抛错）。
 */
export function paginateByCursor<T>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number,
  keyOf: (item: T) => string,
): CursorPage<T> {
  const size = limit > 0 ? limit : SOCIAL_PAGE_SIZE
  let start = 0
  if (cursor) {
    const lastKey = decodeCursor(cursor)
    if (lastKey !== null) {
      const index = items.findIndex((item) => keyOf(item) === lastKey)
      // 找不到（数据被删/游标过期）时按首页处理，而不是返回空页卡死翻页
      start = index >= 0 ? index + 1 : 0
    }
  }
  const slice = items.slice(start, start + size)
  const last = slice[slice.length - 1]
  const nextCursor = start + size < items.length && last ? encodeCursor(keyOf(last)) : null
  return { items: slice, nextCursor }
}

// ===== 关注关系 =====

/** 统计某用户的粉丝数 / 关注数（纯函数，供 mock 与页面共用） */
export function followCounts(follows: readonly Follow[], userId: string): FollowCounts {
  let followers = 0
  let following = 0
  for (const f of follows) {
    if (f.followingId === userId) followers += 1
    if (f.followerId === userId) following += 1
  }
  return { followers, following }
}

/** 我关注了谁（Set of userId） */
export function followingIdsOf(follows: readonly Follow[], userId: string): Set<string> {
  const ids = new Set<string>()
  for (const f of follows) if (f.followerId === userId) ids.add(f.followingId)
  return ids
}

/** 我关注了某个人吗（大小写不敏感，用户名在数据层是 citext） */
export function isFollowingUsername(
  follows: readonly Follow[],
  profiles: readonly Profile[],
  userId: string,
  username: string,
): boolean {
  const target = findProfileByUsername(profiles, username)
  if (!target) return false
  return follows.some((f) => f.followerId === userId && f.followingId === target.id)
}

/** 按用户名查资料（大小写不敏感）；找不到返回 undefined */
export function findProfileByUsername(profiles: readonly Profile[], username: string): Profile | undefined {
  const needle = username.trim().toLowerCase()
  return profiles.find((p) => p.username.toLowerCase() === needle)
}

// ===== 拉黑与用户搜索 =====

/** 任一方向有拉黑即视为两人之间不可见。 */
export function isBlockedBetween(
  blocks: readonly BlockRelation[],
  firstUserId: string,
  secondUserId: string,
): boolean {
  return blocks.some(
    (block) =>
      (block.blockerId === firstUserId && block.blockedId === secondUserId) ||
      (block.blockerId === secondUserId && block.blockedId === firstUserId),
  )
}

/** 当前用户不可见的所有用户 id（双方任一方向拉黑）。 */
export function blockedUserIdsOf(blocks: readonly BlockRelation[], userId: string): Set<string> {
  const ids = new Set<string>()
  for (const block of blocks) {
    if (block.blockerId === userId) ids.add(block.blockedId)
    if (block.blockedId === userId) ids.add(block.blockerId)
  }
  return ids
}

/** 拉黑时移除两人之间双向关注，返回新列表与实际移除条数。 */
export function removeFollowsBetween(
  follows: readonly Follow[],
  firstUserId: string,
  secondUserId: string,
): { follows: Follow[]; removed: number } {
  const kept = follows.filter(
    (follow) =>
      !(
        (follow.followerId === firstUserId && follow.followingId === secondUserId) ||
        (follow.followerId === secondUserId && follow.followingId === firstUserId)
      ),
  )
  return { follows: kept, removed: follows.length - kept.length }
}

/** 按冻结排序规则搜索用户，并排除与查看者任一方向拉黑的用户。 */
export function searchUserHits(
  profiles: readonly Profile[],
  follows: readonly Follow[],
  blocks: readonly BlockRelation[],
  viewerId: string | null,
  query: string,
  limit = USER_SEARCH_PAGE_SIZE,
): UserHit[] {
  const needle = query.trim().toLowerCase().slice(0, SEARCH_QUERY_MAX_LENGTH)
  if (!needle) return []
  const excluded = viewerId ? blockedUserIdsOf(blocks, viewerId) : new Set<string>()
  const size = Math.min(50, Math.max(1, limit))

  return profiles
    .filter(
      (profile) =>
        profile.deletedAt === null &&
        !excluded.has(profile.id) &&
        (profile.username.toLowerCase().includes(needle) || profile.displayName.toLowerCase().includes(needle)),
    )
    .map((profile) => ({
      profile,
      prefix:
        profile.username.toLowerCase().startsWith(needle) || profile.displayName.toLowerCase().startsWith(needle),
      followerCount: followCounts(follows, profile.id).followers,
    }))
    .sort((a, b) => {
      if (a.prefix !== b.prefix) return a.prefix ? -1 : 1
      if (a.followerCount !== b.followerCount) return b.followerCount - a.followerCount
      return a.profile.username.localeCompare(b.profile.username)
    })
    .slice(0, size)
    .map(({ profile, followerCount }) => ({
      username: profile.username,
      displayName: profile.displayName,
      avatarKey: profile.avatarKey,
      bio: profile.bio,
      followerCount,
      isFollowing: viewerId
        ? follows.some((follow) => follow.followerId === viewerId && follow.followingId === profile.id)
        : false,
    }))
}

/** 我主动拉黑的用户，按 (createdAt, blockedId) 倒序映射为公开投影。 */
export function blockedUsers(
  blocks: readonly BlockRelation[],
  profiles: readonly Profile[],
  blockerId: string,
): Array<BlockedUser & { blockedId: string; createdAt: string }> {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]))
  return blocks
    .filter((block) => block.blockerId === blockerId)
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
      return a.blockedId < b.blockedId ? 1 : a.blockedId > b.blockedId ? -1 : 0
    })
    .flatMap((block) => {
      const profile = profilesById.get(block.blockedId)
      return profile
        ? [{
            username: profile.username,
            displayName: profile.displayName,
            avatarKey: profile.avatarKey,
            bio: profile.bio,
            blockedAt: block.createdAt,
            blockedId: block.blockedId,
            createdAt: block.createdAt,
          }]
        : []
    })
}

// ===== 关注动态（feed） =====

/**
 * 关注动态 = 我关注的作者发布的已发布作品，按发布时间倒序。
 *
 * 排序键用 publishedAt（回退 createdAt），不是行的 createdAt —— 草稿是后来发布的，
 * 用 createdAt 会让「刚发布的旧草稿」沉在很下面。
 * 刻意**不包含自己的作品**：主页已经有「作品」列表，混进动态流只会让
 * 「关注动态」失去筛选意义（"我关注的人发了什么"）。
 */
export function feedPhotos(photos: readonly Photo[], followingIds: ReadonlySet<string>): Photo[] {
  // filter 已返回新数组，sort 就地排序不会动到入参
  return photos
    .filter((p) => p.status === 'published' && p.deletedAt === null && followingIds.has(p.authorId))
    .sort((a, b) => {
      const ta = a.publishedAt ?? a.createdAt
      const tb = b.publishedAt ?? b.createdAt
      if (ta !== tb) return ta < tb ? 1 : -1
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
    })
}

// ===== 通知 =====

/** 未读条数 */
export function unreadNotificationCount(items: readonly AppNotification[]): number {
  let n = 0
  for (const item of items) if (item.readAt === null) n += 1
  return n
}

/** 未读通知 id（按列表顺序） */
export function unreadNotificationIds(items: readonly AppNotification[]): string[] {
  return items.filter((item) => item.readAt === null).map((item) => item.id)
}

/**
 * 把通知标为已读，返回**真正发生变化**的那些行（已读的不重复写库）。
 * ids 为 undefined 表示「全部标记为已读」。
 */
export function markNotificationsRead(
  items: readonly AppNotification[],
  ids: readonly string[] | undefined,
  readAt: string,
): AppNotification[] {
  const wanted = ids ? new Set(ids) : null
  const changed: AppNotification[] = []
  for (const item of items) {
    if (item.readAt !== null) continue
    if (wanted && !wanted.has(item.id)) continue
    changed.push({ ...item, readAt })
  }
  return changed
}

/**
 * 通知主文案（纯函数，页面与单测共用）。
 * photoTitle 可选：列表页拿不到作品标题时不硬编「未知作品」，而是说「你的作品」。
 */
export function notificationText(n: AppNotification, photoTitle?: string): string {
  const who = n.actor ? n.actor.displayName || `@${n.actor.username}` : '有人'
  const work = photoTitle ? `《${photoTitle}》` : '你的作品'
  switch (n.kind) {
    case 'like':
      return n.actor ? `${who} 赞了${work}` : `你的作品收到了新的赞`
    case 'comment':
      // 8.3d：回复通知（meta.reply）与「直接评论作品」是两件事，
      // 前者落点在「你的那条评论」，文案必须区分，否则作者会去找错地方
      if (isReplyNotification(n)) {
        return n.actor ? `${who} 回复了你的评论` : '有人回复了你的评论'
      }
      return n.actor ? `${who} 评论了${work}` : `你的作品收到了新评论`
    case 'follow':
      return n.actor ? `${who} 关注了你` : '有新的关注者'
    default: {
      const rank = weeklyRankOf(n)
      if (rank) return `你的作品${photoTitle ? `《${photoTitle}》` : ''}入选 ${rank.isoWeek} 周榜第 ${rank.rank} 名`
      // 8.4d：主题精选通知（system + theme_selected）必须与榜单区分开 ——
      // 两条通知都是 kind='system'，只按 kind 兜底会把它写成「系统通知」，
      // 作者根本不知道该去哪看自己的作品。
      const theme = themeSelectionOf(n)
      if (theme) {
        const work = photoTitle ? `《${photoTitle}》` : '你的作品'
        return theme.title ? `${work}入选主题「${theme.title}」精选` : `${work}入选了本周主题精选`
      }
      return n.actor ? `${who} 发来一条系统通知` : '系统通知'
    }
  }
}

export interface NotificationLink {
  to: string
  label: string
}

/**
 * 通知的跳转目标：点赞/评论 → 作品页；关注 → 对方主页；主题精选 → 主题详情页；
 * 其余系统通知无跳转。
 * photoId 缺失时（作品已删除）退化为无跳转，而不是给一个必然 404 的链接。
 */
export function notificationLink(n: AppNotification): NotificationLink | null {
  if ((n.kind === 'like' || n.kind === 'comment') && n.photoId) {
    return { to: `/works/${n.photoId}`, label: '查看作品' }
  }
  if (n.kind === 'follow' && n.actor) {
    return { to: `/u/${n.actor.username}`, label: '查看主页' }
  }
  const theme = themeSelectionOf(n)
  if (theme) return { to: `/themes/${theme.slug}`, label: '查看主题' }
  return null
}

/** 通知类型的图标语义名（供 UI 选图标，避免各页面各写一套 switch） */
export function notificationIconName(kind: AppNotification['kind']): 'heart' | 'message' | 'user-plus' | 'megaphone' {
  switch (kind) {
    case 'like':
      return 'heart'
    case 'comment':
      return 'message'
    case 'follow':
      return 'user-plus'
    default:
      return 'megaphone'
  }
}

// ===== 通知的附加语义（8.3d）=====

/**
 * 是否为「回复了我的评论」。
 *
 * 后端 meta 的形状是 `Record<string, unknown> | null`，字段永远稀疏且类型不可信，
 * 所以这里既判存在性也判字面量（`reply: 'true'` 之类的脏数据不算）。
 */
export function isReplyNotification(n: AppNotification): boolean {
  return n.kind === 'comment' && n.meta?.reply === true
}

/** 周榜入选的 (isoWeek, rank)；不是榜单通知或字段残缺时返回 null */
export function weeklyRankOf(n: AppNotification): { isoWeek: string; rank: number } | null {
  if (n.kind !== 'system') return null
  const meta = n.meta
  if (!meta || meta.kind !== 'weekly_rank') return null
  const { isoWeek, rank } = meta
  if (typeof isoWeek !== 'string' || isoWeek === '') return null
  if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 1) return null
  return { isoWeek, rank }
}

/**
 * 主题精选通知的 (slug, title)；不是主题精选或字段残缺时返回 null（8.4d）。
 *
 * 与 weeklyRankOf 同一套防御：meta 是 `Record<string, unknown>` 出身，
 * 字段永远稀疏且类型不可信，所以既判存在性也判类型。title 允许缺失 ——
 * 通知照发，文案退化成「本周主题精选」而不是不显示这条通知。
 */
export function themeSelectionOf(n: AppNotification): { slug: string; title: string } | null {
  if (n.kind !== 'system') return null
  const meta = n.meta
  if (!meta || meta.kind !== 'theme_selected') return null
  const { themeSlug, themeTitle } = meta
  if (typeof themeSlug !== 'string' || themeSlug === '') return null
  return { slug: themeSlug, title: typeof themeTitle === 'string' ? themeTitle : '' }
}

/**
 * 互动聚合用的分组键：同一 photoId 的评论通知才可能折叠。
 * 没有 photoId 的评论通知不参与聚合（拿不到作品就无法判断「同一处」）。
 */
function commentGroupKey(n: AppNotification): string | null {
  return n.kind === 'comment' && n.photoId ? n.photoId : null
}

/**
 * 相邻评论通知的折叠单元。
 *
 * 为什么是「相邻」而不是「按 photoId 全局合并」：
 * 通知列表是按时间倒序的流水，把同一作品的评论从列表各处抽出来堆在一起，
 * 会让时间线前后颠倒（上午的评论排在昨晚的点赞下面），用户读到的顺序就错了。
 * 折叠只在**时间上连续**的一段里做，时间线始终单调。
 */
export type NotificationGroup =
  | { type: 'single'; key: string; item: AppNotification }
  | {
      type: 'comment-bundle'
      /** 组内第一条的 id：既是 key 也是展开状态的锚点 */
      key: string
      photoId: string
      items: AppNotification[]
    }

/** 折叠下限：同一作品连续 2 条以上评论才值得折叠（1 条折叠等于没折叠） */
export const COMMENT_BUNDLE_MIN = 2

/** 把通知流水切成「单条 / 评论折叠组」。只合并相邻且同 photoId 的评论。 */
export function groupNotifications(items: readonly AppNotification[]): NotificationGroup[] {
  const groups: NotificationGroup[] = []
  let index = 0
  while (index < items.length) {
    const item = items[index]
    if (!item) break
    const key = commentGroupKey(item)
    if (key === null) {
      groups.push({ type: 'single', key: item.id, item })
      index += 1
      continue
    }
    // 向后吃掉所有「相邻 + 同 photoId + 也是评论」的条目
    let end = index + 1
    while (end < items.length) {
      const next = items[end]
      if (!next || commentGroupKey(next) !== key) break
      end += 1
    }
    const run = items.slice(index, end)
    const first = run[0]!
    groups.push(
      run.length >= COMMENT_BUNDLE_MIN
        ? { type: 'comment-bundle', key: first.id, photoId: key, items: run }
        : { type: 'single', key: first.id, item: first },
    )
    index = end
  }
  return groups
}

/**
 * 折叠组的已读状态：all = 全部已读，none = 全部未读，partial = 部分未读。
 * 为什么要三态：组头和明细各需要一个「未读点」，只判「有没有未读」时
 * 部分已读和全部未读长得一模一样，用户看不出组里还剩几条没看。
 */
export type BundleReadState = 'all' | 'none' | 'partial'

export function bundleReadState(items: readonly AppNotification[]): BundleReadState {
  let unread = 0
  for (const item of items) if (item.readAt === null) unread += 1
  if (unread === 0) return 'all'
  return unread === items.length ? 'none' : 'partial'
}

/** 折叠组里还没读的 id（点开展开时把它们一次性标记已读） */
export function bundleUnreadIds(items: readonly AppNotification[]): string[] {
  return unreadNotificationIds(items)
}
