/**
 * Mock 社交仓储（二期：关注 / 关注动态 / 站内通知）。
 *
 * 行为必须与 api 实现一致（同一份契约、同一套纯函数），差异只在数据落地位置：
 * 这里落在 IndexedDB，api 那边落在 PostgreSQL。
 */
import { AppError, ErrorCodes, type CursorListPage, type SocialRepository } from '@/data/contracts'
import type { AppNotification, Follow, Photo, Profile } from '@/domain/types'
import {
  NOTIFICATION_PAGE_SIZE,
  SOCIAL_PAGE_SIZE,
  feedPhotos,
  findProfileByUsername,
  followCounts,
  followingIdsOf,
  markNotificationsRead,
  paginateByCursor,
  sortByCreatedAtDesc,
  unreadNotificationCount,
} from '@/domain/social'
import { bumpDataVersion, getDb, type NotificationRow } from '../db'
import { mockAuthRepository } from './auth'

/** 出库前剥掉存储层的归属字段（契约里的 AppNotification 没有 userId） */
function toNotification(row: NotificationRow): AppNotification {
  const { userId: _userId, ...rest } = row
  return rest
}

/**
 * 取当前会话；未登录抛 UNAUTHORIZED。
 * isFollowing 是唯一例外（未登录返回 false）—— 关注按钮在游客态也要能渲染。
 */
async function requireSession() {
  const session = await mockAuthRepository.getSession()
  if (!session) throw new AppError(ErrorCodes.UNAUTHORIZED, '请先登录后再操作')
  return session
}

async function loadProfiles(): Promise<Profile[]> {
  const db = await getDb()
  return db.getAll('profiles')
}

/** 按用户名取资料（大小写不敏感，对应 Postgres 的 citext） */
async function requireProfile(username: string): Promise<Profile> {
  const profile = findProfileByUsername(await loadProfiles(), username)
  if (!profile) throw new AppError(ErrorCodes.NOT_FOUND, `用户不存在：${username}`)
  return profile
}

export const mockSocialRepository: SocialRepository = {
  async follow(username: string): Promise<void> {
    const session = await requireSession()
    const target = await requireProfile(username)
    if (target.id === session.userId) {
      throw new AppError(ErrorCodes.VALIDATION, '不能关注自己')
    }

    const db = await getDb()
    const existing = await db.get('follows', [session.userId, target.id])
    if (existing) return // 幂等：重复关注不报错、不重复计数

    const row: Follow = {
      followerId: session.userId,
      followingId: target.id,
      createdAt: new Date().toISOString(),
    }
    await db.put('follows', row)

    // 被关注者收到一条通知（演示数据源也走真实链路，便于用 bob 登录验证铃铛）
    const actor = (await loadProfiles()).find((p) => p.id === session.userId) ?? null
    const notification: NotificationRow = {
      id: `notify-follow-${session.userId}-${target.id}`,
      userId: target.id,
      kind: 'follow',
      actor,
      photoId: null,
      commentId: null,
      readAt: null,
      createdAt: row.createdAt,
    }
    await db.put('notifications', notification)

    await bumpDataVersion()
  },

  async unfollow(username: string): Promise<void> {
    const session = await requireSession()
    const target = await requireProfile(username)
    const db = await getDb()
    const existing = await db.get('follows', [session.userId, target.id])
    if (!existing) return // 幂等

    await db.delete('follows', [session.userId, target.id])
    // 刻意不删除当初那条 follow 通知：真实产品里「某人关注过你」是历史事实，
    // 取关后再把通知抹掉，用户会以为通知系统丢了消息。
    await bumpDataVersion()
  },

  async isFollowing(username: string): Promise<boolean> {
    const session = await mockAuthRepository.getSession()
    if (!session) return false
    const target = findProfileByUsername(await loadProfiles(), username)
    if (!target) return false
    const db = await getDb()
    return (await db.get('follows', [session.userId, target.id])) !== undefined
  },

  async counts(username: string): Promise<{ followers: number; following: number }> {
    const target = await requireProfile(username)
    const db = await getDb()
    return followCounts(await db.getAll('follows'), target.id)
  },

  async listFollowers(username: string, cursor?: string): Promise<CursorListPage<Profile>> {
    const target = await requireProfile(username)
    const db = await getDb()
    const rows = (await db.getAll('follows')).filter((f) => f.followingId === target.id)
    const ordered = sortByCreatedAtDesc(rows, (f) => f.followerId)
    const page = paginateByCursor(ordered, cursor, SOCIAL_PAGE_SIZE, (f) => f.followerId)
    const profiles = await db.getAll('profiles')
    const byId = new Map(profiles.map((p) => [p.id, p]))
    return {
      items: page.items.map((f) => byId.get(f.followerId)).filter((p): p is Profile => Boolean(p)),
      nextCursor: page.nextCursor,
    }
  },

  async listFollowing(username: string, cursor?: string): Promise<CursorListPage<Profile>> {
    const target = await requireProfile(username)
    const db = await getDb()
    const rows = (await db.getAll('follows')).filter((f) => f.followerId === target.id)
    const ordered = sortByCreatedAtDesc(rows, (f) => f.followingId)
    const page = paginateByCursor(ordered, cursor, SOCIAL_PAGE_SIZE, (f) => f.followingId)
    const profiles = await db.getAll('profiles')
    const byId = new Map(profiles.map((p) => [p.id, p]))
    return {
      items: page.items.map((f) => byId.get(f.followingId)).filter((p): p is Profile => Boolean(p)),
      nextCursor: page.nextCursor,
    }
  },

  async feed(cursor?: string): Promise<CursorListPage<Photo>> {
    const session = await requireSession()
    const db = await getDb()
    const following = followingIdsOf(await db.getAll('follows'), session.userId)
    const items = feedPhotos(await db.getAll('photos'), following)
    return paginateByCursor(items, cursor, SOCIAL_PAGE_SIZE, (p) => p.id)
  },

  async notifications(cursor?: string): Promise<CursorListPage<AppNotification>> {
    const session = await requireSession()
    const db = await getDb()
    const mine = (await db.getAll('notifications')).filter((n) => n.userId === session.userId)
    const ordered = sortByCreatedAtDesc(mine, (n) => n.id)
    const page = paginateByCursor(ordered, cursor, NOTIFICATION_PAGE_SIZE, (n) => n.id)
    return { items: page.items.map(toNotification), nextCursor: page.nextCursor }
  },

  async unreadCount(): Promise<number> {
    const session = await requireSession()
    const db = await getDb()
    const mine = (await db.getAll('notifications')).filter((n) => n.userId === session.userId)
    return unreadNotificationCount(mine)
  },

  async markRead(ids?: string[]): Promise<void> {
    const session = await requireSession()
    const db = await getDb()
    const mine = (await db.getAll('notifications')).filter((n) => n.userId === session.userId)
    const changed = markNotificationsRead(mine, ids, new Date().toISOString())
    for (const row of changed) {
      await db.put('notifications', { ...row, userId: session.userId })
    }
    if (changed.length > 0) await bumpDataVersion()
  },
}
