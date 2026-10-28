import type { CursorListPage, InteractionRepository } from '@/data/contracts'
import type { Interaction, Photo } from '@/domain/types'
import { qs, request } from './client'

const photoPath = (photoId: string) => `/api/photos/${encodeURIComponent(photoId)}`
const profilePath = (username: string) => `/api/profiles/${encodeURIComponent(username)}`

export const apiInteractionRepository: InteractionRepository = {
  listLikesByUser(userId: string): Promise<Photo[]> {
    return request('/api/interactions' + qs({ userId, kind: 'likes' }))
  },
  listFavoritesByUser(userId: string): Promise<Photo[]> {
    return request('/api/interactions' + qs({ userId, kind: 'favorites' }))
  },
  listByUsername(
    username: string,
    kind: 'likes' | 'favorites',
    cursor?: string,
    limit?: number,
  ): Promise<CursorListPage<Photo>> {
    // 账号级隐私由服务端判定（私密账号 / 关闭「展示喜欢」时返回空页），前端不复制这套规则。
    return request<CursorListPage<Photo>>(
      `${profilePath(username)}/interactions` + qs({ kind, cursor, limit }),
    )
  },
  async getLikeState(userId: string, photoId: string): Promise<boolean> {
    const result = await request<{ active: boolean }>(
      `${photoPath(photoId)}/interaction-state` + qs({ userId, kind: 'like' }),
    )
    return result.active
  },
  async getFavoriteState(userId: string, photoId: string): Promise<boolean> {
    const result = await request<{ active: boolean }>(
      `${photoPath(photoId)}/interaction-state` + qs({ userId, kind: 'favorite' }),
    )
    return result.active
  },
  async toggleLike(userId: string, photoId: string): Promise<boolean> {
    const current = await this.getLikeState(userId, photoId)
    const result = await request<{ liked: boolean }>(`${photoPath(photoId)}/like`, {
      method: 'PUT', body: { liked: !current },
    })
    return result.liked
  },
  async toggleFavorite(userId: string, photoId: string): Promise<boolean> {
    const current = await this.getFavoriteState(userId, photoId)
    const result = await request<{ favorited: boolean }>(`${photoPath(photoId)}/favorite`, {
      method: 'PUT', body: { favorited: !current },
    })
    return result.favorited
  },
  listLikesByPhoto(photoId: string): Promise<Interaction[]> {
    return request(`${photoPath(photoId)}/interactions?kind=likes`)
  },
  listFavoritesByPhoto(photoId: string): Promise<Interaction[]> {
    return request(`${photoPath(photoId)}/interactions?kind=favorites`)
  },
}
