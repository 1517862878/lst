/**
 * Mock 照片仓储（静态期实现）。
 * 契约：PhotoRepository（data/contracts）；行为与 supabase 实现一致，契约测试同跑。
 */
import {
  AppError,
  ErrorCodes,
  type Page,
  type PhotoCreateInput,
  type PhotoItemInput,
  type PhotoItemsResult,
  type PhotoListQuery,
  type PhotoPatch,
  type PhotoRepository,
} from '@/data/contracts'
import type { Photo, PhotoItem, Profile } from '@/domain/types'
import { findProfileByUsername } from '@/domain/social'
import { exifVisibilityOf, withExifPrivacyAll } from '@/domain/photography'
import { normalizeCaption, validatePhotoItems } from '@/domain/photoItems'
import { getDb, bumpDataVersion, type PhotoItemRow } from '../db'

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

/**
 * getDb() 的最小结构：只声明组照要用到的那一个索引方法。
 *
 * 单测里的 db 桩只实现 get/put/getAll 三件套（见 mock-profile-lists.test.ts），
 * 所以这里不按 GyDBSchema 的完整类型标注，运行时缺方法就当作「没有组照」。
 */
type PhotoItemsIndex = {
  getAllFromIndex?: (store: 'photoItems', index: 'photoId', query: string) => Promise<unknown>
}

/**
 * 读一件作品的组照条目，按 position 升序。
 *
 * 为什么要 try：早期版本的本地库没有 photoItems 这张表。缺表 = 没有组照，
 * 和 8.4c 之前完全等价，不应该让详情页整页报错。
 */
async function readPhotoItems(access: PhotoItemsIndex, photoId: string): Promise<PhotoItem[]> {
  if (typeof access.getAllFromIndex !== 'function') return []
  try {
    const rows = (await access.getAllFromIndex('photoItems', 'photoId', photoId)) as PhotoItemRow[]
    return [...rows]
      .sort((a, b) => a.position - b.position)
      .map((row) => ({
        id: row.id,
        position: row.position,
        imageKey: row.imageKey,
        thumbKey: row.thumbKey,
        width: row.width,
        height: row.height,
        blurhash: row.blurhash,
        caption: row.caption,
      }))
  } catch {
    return []
  }
}

/** 把 db 收窄成「能查组照索引」的形状（真实 db 有该方法，桩没有） */
function itemsIndexOf(db: unknown): PhotoItemsIndex {
  return db as PhotoItemsIndex
}

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
    // 组照条目只在详情里带出（列表不查这张表，避免每页 N 次读）。
    const items = await readPhotoItems(itemsIndexOf(db), photo.id)
    const withItems: Photo = { ...photo, items, itemCount: photo.itemCount ?? items.length }
    return (await applyExifPrivacy([withItems]))[0]!
  },

  async create(input: PhotoCreateInput, id = crypto.randomUUID()): Promise<Photo> {
    const db = await getDb()
    const now = new Date().toISOString()
    const photo: Photo = {
      id,
      ...input,
      // 评论开关默认允许（8.4b）：数据库列是 not null default false，
      // 这里也显式落一个 false，避免 undefined 与 false 两种「允许」并存
      commentsLocked: input.commentsLocked === true,
      // 新建作品的组照张数就是 0（items 由 replaceItems 单独写，见 8.4c）
      itemCount: 0,
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

  /**
   * 整组替换组照（8.4c）。
   *
   * 语义逐条对齐后端 replace_photo_items（迁移 0033）：
   * - 顺序 = 数组顺序，position 由服务端从 0 重排，客户端传的位置一概不认；
   * - 条目数 ≤ 9（多了是 23514，前端也提前拦，见 domain/photoItems）；
   * - 第 1 张就是封面：photos.image_key / thumb_key / 宽高 / blurhash 跟着它走；
   * - 空数组 = 退回单图，**保持** photos 上原来的封面键不动，页面继续按单图渲染。
   */
  async replaceItems(id: string, items: PhotoItemInput[]): Promise<PhotoItemsResult> {
    const db = await getDb()
    const photo = await db.get('photos', id)
    if (!photo) throw new AppError(ErrorCodes.NOT_FOUND, `作品不存在：${id}`)
    const invalid = validatePhotoItems(items)
    if (invalid) throw new AppError(ErrorCodes.VALIDATION, invalid)

    const now = new Date().toISOString()
    const rows: PhotoItemRow[] = items.map((item, position) => ({
      id: crypto.randomUUID(),
      photoId: id,
      position,
      imageKey: item.imageKey,
      thumbKey: item.thumbKey,
      width: item.width,
      height: item.height,
      blurhash: item.blurhash,
      caption: normalizeCaption(item.caption),
    }))

    // 先清旧行（主键是 [photoId, position]，条数变少时旧的高位序号必须显式删掉）
    const stale = await readPhotoItems(itemsIndexOf(db), id)
    for (const row of stale) await db.delete('photoItems', [id, row.position])
    for (const row of rows) await db.put('photoItems', row)

    const cover = rows[0]
    const updated: Photo = {
      ...photo,
      itemCount: rows.length,
      updatedAt: now,
      // 空数组不动封面：单图作品 replaceItems([]) 是幂等的
      ...(cover
        ? {
            imageKey: cover.imageKey,
            thumbKey: cover.thumbKey,
            width: cover.width,
            height: cover.height,
            blurhash: cover.blurhash,
          }
        : {}),
    }
    await db.put('photos', updated)
    await bumpDataVersion()
    return { photoId: id, itemCount: rows.length, items: rows.map(({ photoId: _photoId, ...item }) => item) }
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
