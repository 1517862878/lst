/**
 * API 社交仓储（二期：关注 / 关注动态 / 站内通知）。
 *
 * 端点清单已冻结：
 *   PUT    /api/profiles/:username/follow
 *   DELETE /api/profiles/:username/follow
 *   GET    /api/profiles/:username/followers
 *   GET    /api/profiles/:username/following
 *   GET    /api/feed
 *   GET    /api/me/notifications
 *   GET    /api/me/notifications/unread-count
 *   POST   /api/me/notifications/read
 *
 * 清单里**没有** isFollowing 与 counts 的专用端点。这两个方法按下面两条规则从
 * 已有端点推导；如果后端后续补了专用端点，只需要改这两个函数体，页面与 hooks 不动：
 *   · counts    —— 读 followers / following 两个列表响应里的 total（服务端算了就用）；
 *                  没算（只有 { items, nextCursor }）时退化为「本页已取到的条数」，
 *                  即**下界估计**：宁可少报，也不编一个看起来精确的假数字。
 *   · isFollowing —— 从「我的关注列表」里有界扫描（最多 3 页 × 100 条）找对方。
 */
import type { AppNotification, FollowCounts, Photo, Profile } from '@/domain/types'
import type { CursorListPage, SocialRepository } from '@/data/contracts'
import { apiAuthRepository } from './auth'
import { qs, request } from './client'

/** 列表端点的通用形状；total 可选（清单只约定 items + nextCursor） */
interface RemoteList<T> {
  items: T[]
  nextCursor: string | null
  total?: number
}

/** isFollowing 的扫描上限：最多翻 3 页（每页条数由服务端决定，端点不接受 limit 参数）。
 *  关注几千人的账号会退化为「可能误报未关注」——这是冻结端点下的取舍：
 *  宁可按钮显示「关注」让人多按一次（幂等，无副作用），也不要为了精确而无限翻页。 */
const SCAN_PAGES = 3

const profilePath = (username: string) => `/api/profiles/${encodeURIComponent(username)}`

function followers(username: string, cursor?: string): Promise<RemoteList<Profile>> {
  return request<RemoteList<Profile>>(`${profilePath(username)}/followers${qs({ cursor })}`)
}

function following(username: string, cursor?: string): Promise<RemoteList<Profile>> {
  return request<RemoteList<Profile>>(`${profilePath(username)}/following${qs({ cursor })}`)
}

export const apiSocialRepository: SocialRepository = {
  async follow(username: string): Promise<void> {
    await request<void>(`${profilePath(username)}/follow`, { method: 'PUT' })
  },

  async unfollow(username: string): Promise<void> {
    await request<void>(`${profilePath(username)}/follow`, { method: 'DELETE' })
  },

  async isFollowing(username: string): Promise<boolean> {
    const session = await apiAuthRepository.getSession()
    if (!session) return false
    const needle = username.trim().toLowerCase()

    let cursor: string | undefined
    for (let page = 0; page < SCAN_PAGES; page++) {
      const data: RemoteList<Profile> = await following(session.username, cursor)
      if (data.items.some((p) => p.username.toLowerCase() === needle)) return true
      if (!data.nextCursor) return false
      cursor = data.nextCursor
    }
    return false
  },

  async counts(username: string): Promise<FollowCounts> {
    const [fans, follows] = await Promise.all([
      followers(username),
      following(username),
    ])
    // total 优先：只有服务端真算了总数才是精确值。
    // 没有 total 时用本页条数：这是**下界估计**，宁可少报也不能编造。
    return {
      followers: fans.total ?? fans.items.length,
      following: follows.total ?? follows.items.length,
    }
  },

  async listFollowers(username: string, cursor?: string): Promise<CursorListPage<Profile>> {
    const data: RemoteList<Profile> = await followers(username, cursor)
    return { items: data.items, nextCursor: data.nextCursor }
  },

  async listFollowing(username: string, cursor?: string): Promise<CursorListPage<Profile>> {
    const data: RemoteList<Profile> = await following(username, cursor)
    return { items: data.items, nextCursor: data.nextCursor }
  },

  async feed(cursor?: string): Promise<CursorListPage<Photo>> {
    const data: RemoteList<Photo> = await request<RemoteList<Photo>>(`/api/feed${qs({ cursor })}`)
    return { items: data.items, nextCursor: data.nextCursor }
  },

  async notifications(cursor?: string): Promise<CursorListPage<AppNotification>> {
    const data: RemoteList<AppNotification> = await request<RemoteList<AppNotification>>(
      `/api/me/notifications${qs({ cursor })}`,
    )
    return { items: data.items, nextCursor: data.nextCursor }
  },

  async unreadCount(): Promise<number> {
    // 后端可能返回裸数字，也可能返回 { count }；两种都认，避免为形状争论卡住联调
    const data = await request<number | { count: number }>('/api/me/notifications/unread-count')
    return typeof data === 'number' ? data : data.count
  },

  async markRead(ids?: string[]): Promise<void> {
    // 不传 ids = 全部标记为已读（空对象而不是省略 body，语义更明确）
    await request<void>('/api/me/notifications/read', {
      method: 'POST',
      body: ids && ids.length > 0 ? { ids } : {},
    })
  },
}
