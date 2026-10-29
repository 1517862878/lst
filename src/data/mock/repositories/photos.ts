/**
 * Mock 照片仓储（静态期实现）。
 * 契约：PhotoRepository（data/contracts）；行为与 supabase 实现一致，契约测试同跑。
 */
import { AppError, ErrorCodes, type Page, type PhotoCreateInput, type PhotoListQuery, type PhotoPatch, type PhotoRepository } from '@/data/contracts'
import type { Photo, Profile } from '@/domain/types'
import { findProfileByUsername } from '@/domain/social'
import { exifVisibilityOf, withExifPrivacyAll } from '@/domain/photography'
import { getDb, bumpDataVersion } from '../db'

/**
 * 读取时的拍摄参数掩码（8.4a）。
 *
 * 与后端投影同口径：隐藏时 `exif` 变 `{}` 且带 `exifHidden: true`，
 * 页面据此显示「作者未公开拍摄参数」。放在数据层而不是页面里，是因为
 * 聚合（器材）、列表（卡片）与详情（EXIF 表）都要用同一份判定。
 */
async function applyExifPrivacy(photos: Photo[]): Promise<Photo[]> {
  const db = await getDb()
  let profiles: Profile[] = []
  try {
    const rows = await db.getAll('profiles')
    if (Array.isArray(rows)) profiles = rows
  } catch {
    profiles = []
  }
  const visibility = new Map(profiles.map((profile) => [profile.id, exifVisibilityOf(profile)]))
  return withExifPrivacyAll(photos, (authorId) => visibility.get(authorId))
}

/** 游标编解码：base64url（photo.id 与 sort 键组成，防伪造直接按游标翻页即可） */
function encodeCursor(key: string): string {
  return btoa(key).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeCursor(cursor: string): string {
  const padded = cursor.replace(/-/g, '+').replace(/_/g, '/')
  return atob(padded)
}

const DEFAULT_LIMIT = 24

export const mockPhotoRepository: PhotoRepository = {
  async list(query: PhotoListQuery): Promise<Page<Photo>> {
    const db = await getDb()
    let photos = (await db.getAll('photos')).filter((p) => p.status === 'published')
    if (query.categorySlug) photos = photos.filter((p) => p.categorySlug === query.categorySlug)
    if (query.authorUsername) {
      // 与真实后端同口径：先按 username 定位作者（用户名大小写不敏感 = Postgres 的 citext），
      // 再按 authorId 过滤。作者不存在时是空列表而不是报错——主页已处理 404，列表不该再抛。
      const author = findProfileByUsername(await db.getAll('profiles'), query.authorUsername)
      photos = author ? photos.filter((p) => p.authorId === author.id) : []
    }

    // 排序：latest 按 publishedAt 降序；popular 按 (likeCount*1 + favoriteCount*3) 降序
    if (query.sort === 'popular') {
      photos.sort((a, b) => {
        const scoreA = a.likeCount + a.favoriteCount * 3
        const scoreB = b.likeCount + b.favoriteCount * 3
        if (scoreB !== scoreA) return scoreB - scoreA
        return (b.publishedAt ?? '') < (a.publishedAt ?? '') ? -1 : 1
      })
    } else {
      photos.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    }

    const limit = query.limit ?? DEFAULT_LIMIT
    let startIndex = 0
    if (query.cursor) {
      // 游标 = 上一页最后一条的 id；按当前排序找到它的位置
      const lastId = decodeCursor(query.cursor)
      startIndex = photos.findIndex((p) => p.id === lastId)
      if (startIndex === -1) startIndex = 0
      else startIndex += 1
    }

    const items = await applyExifPrivacy(photos.slice(startIndex, startIndex + limit))
    const hasMore = startIndex + limit < photos.length
    const nextCursor = hasMore ? encodeCursor(items[items.length - 1]!.id) : null

    return { items, nextCursor, total: photos.length }
  },

  async get(id: string): Promise<Photo> {
    const db = await getDb()
    const photo = await db.get('photos', id)
    // 与真实 API/RLS 保持一致：软撤回记录仅供内部审计，公开详情按不存在处理。
    if (!photo || photo.status !== 'published') throw new AppError(ErrorCodes.NOT_FOUND, `作品不存在：${id}`)
    return (await applyExifPrivacy([photo]))[0]!
  },

  async create(input: PhotoCreateInput, id = crypto.randomUUID()): Promise<Photo> {
    const db = await getDb()
    const now = new Date().toISOString()
    const photo: Photo = {
      id,
      ...input,
      status: 'draft',
      likeCount: 0,
      favoriteCount: 0,
      commentCount: 0,
      viewCount: 0,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    await db.put('photos', photo)
    await bumpDataVersion()
    return photo
  },

  async publish(id: string): Promise<Photo> {
    const db = await getDb()
    const photo = await db.get('photos', id)
    if (!photo) throw new AppError(ErrorCodes.NOT_FOUND, `作品不存在：${id}`)
    const now = new Date().toISOString()
    const updated: Photo = { ...photo, status: 'published', publishedAt: now, updatedAt: now }
    await db.put('photos', updated)
    await bumpDataVersion()
    return updated
  },

  async update(id: string, patch: PhotoPatch): Promise<Photo> {
    const db = await getDb()
    const photo = await db.get('photos', id)
    if (!photo) throw new AppError(ErrorCodes.NOT_FOUND, `作品不存在：${id}`)
    const updated: Photo = { ...photo, ...patch, updatedAt: new Date().toISOString() }
    await db.put('photos', updated)
    await bumpDataVersion()
    return updated
  },

  async remove(id: string): Promise<void> {
    const db = await getDb()
    const photo = await db.get('photos', id)
    if (!photo) throw new AppError(ErrorCodes.NOT_FOUND, `作品不存在：${id}`)
    await db.put('photos', { ...photo, status: 'removed', deletedAt: new Date().toISOString() })
    await bumpDataVersion()
  },

  async related(id: string, limit = 6): Promise<Photo[]> {
    const db = await getDb()
    const photo = await db.get('photos', id)
    if (!photo) throw new AppError(ErrorCodes.NOT_FOUND, `作品不存在：${id}`)
    const all = (await db.getAll('photos')).filter(
      (p) => p.status === 'published' && p.categorySlug === photo.categorySlug && p.id !== id,
    )
    all.sort((a, b) => b.likeCount - a.likeCount)
    return applyExifPrivacy(all.slice(0, limit))
  },
}
