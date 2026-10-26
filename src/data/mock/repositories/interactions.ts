/**
 * Mock 互动仓储（点赞/收藏）。
 * 契约：InteractionRepository。计数永远由数据派生（ROADMAP §5.3）。
 */
import { AppError, ErrorCodes, type InteractionRepository } from '@/data/contracts'
import type { Interaction, Photo } from '@/domain/types'
import { getDb, bumpDataVersion } from '../db'

async function recount(db: Awaited<ReturnType<typeof getDb>>, photoId: string): Promise<void> {
  const photo = await db.get('photos', photoId)
  if (!photo) return
  const [likes, favorites] = await Promise.all([db.getAll('likes'), db.getAll('favorites')])
  await db.put('photos', {
    ...photo,
    likeCount: likes.filter((r) => r.photoId === photoId).length,
    favoriteCount: favorites.filter((r) => r.photoId === photoId).length,
  })
}

export const mockInteractionRepository: InteractionRepository = {
  async listLikesByUser(userId: string): Promise<Photo[]> {
    const db = await getDb()
    const rows = await db.getAll('likes')
    const ids = rows.filter((r) => r.userId === userId).map((r) => r.photoId)
    const photos: Photo[] = []
    for (const id of ids) {
      const p = await db.get('photos', id)
      if (p && p.status === 'published') photos.push(p)
    }
    return photos.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
  },

  async listFavoritesByUser(userId: string): Promise<Photo[]> {
    const db = await getDb()
    const rows = await db.getAll('favorites')
    const ids = rows.filter((r) => r.userId === userId).map((r) => r.photoId)
    const photos: Photo[] = []
    for (const id of ids) {
      const p = await db.get('photos', id)
      if (p && p.status === 'published') photos.push(p)
    }
    return photos.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
  },

  async getLikeState(userId: string, photoId: string): Promise<boolean> {
    const db = await getDb()
    const row = await db.get('likes', [userId, photoId])
    return row !== undefined
  },

  async getFavoriteState(userId: string, photoId: string): Promise<boolean> {
    const db = await getDb()
    const row = await db.get('favorites', [userId, photoId])
    return row !== undefined
  },

  async toggleLike(userId: string, photoId: string): Promise<boolean> {
    const db = await getDb()
    const photo = await db.get('photos', photoId)
    if (!photo) throw new AppError(ErrorCodes.NOT_FOUND, `作品不存在：${photoId}`)
    const existing = await db.get('likes', [userId, photoId])
    if (existing) {
      await db.delete('likes', [userId, photoId])
    } else {
      const row: Interaction = { userId, photoId, createdAt: new Date().toISOString() }
      await db.put('likes', row)
    }
    await recount(db, photoId)
    await bumpDataVersion()
    return existing === undefined
  },

  async toggleFavorite(userId: string, photoId: string): Promise<boolean> {
    const db = await getDb()
    const photo = await db.get('photos', photoId)
    if (!photo) throw new AppError(ErrorCodes.NOT_FOUND, `作品不存在：${photoId}`)
    const existing = await db.get('favorites', [userId, photoId])
    if (existing) {
      await db.delete('favorites', [userId, photoId])
    } else {
      const row: Interaction = { userId, photoId, createdAt: new Date().toISOString() }
      await db.put('favorites', row)
    }
    await recount(db, photoId)
    await bumpDataVersion()
    return existing === undefined
  },

  async listLikesByPhoto(photoId: string): Promise<Interaction[]> {
    const db = await getDb()
    return db.getAll('likes').then((rows) => rows.filter((r) => r.photoId === photoId))
  },

  async listFavoritesByPhoto(photoId: string): Promise<Interaction[]> {
    const db = await getDb()
    return db.getAll('favorites').then((rows) => rows.filter((r) => r.photoId === photoId))
  },
}
