/**
 * Mock 评论仓储。契约：CommentRepository。
 * 分页同为游标、倒序；软删保留占位。
 */
import { AppError, ErrorCodes, type CommentListQuery, type CommentRepository } from '@/data/contracts'
import type { Comment } from '@/domain/types'
import { getDb, bumpDataVersion } from '../db'

function encodeCursor(key: string): string {
  return btoa(key).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const mockCommentRepository: CommentRepository = {
  async list(query: CommentListQuery): Promise<{ items: Comment[]; nextCursor: string | null; total: number }> {
    const db = await getDb()
    const all = (await db.getAll('comments'))
      .filter((c) => c.photoId === query.photoId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const limit = query.limit ?? 20
    let startIndex = 0
    if (query.cursor) {
      const lastId = query.cursor
      startIndex = all.findIndex((c) => c.id === lastId)
      if (startIndex === -1) startIndex = 0
      else startIndex += 1
    }
    const items = all.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < all.length
    const nextCursor = hasMore ? encodeCursor(items[items.length - 1]!.id) : null
    return { items, nextCursor, total: all.length }
  },

  async create(input: {
    photoId: string
    authorId: string
    parentId: string | null
    body: string
  }): Promise<Comment> {
    const db = await getDb()
    const photo = await db.get('photos', input.photoId)
    if (!photo) throw new AppError(ErrorCodes.NOT_FOUND, `作品不存在：${input.photoId}`)
    const now = new Date().toISOString()
    const comment: Comment = {
      id: crypto.randomUUID(),
      photoId: input.photoId,
      authorId: input.authorId,
      parentId: input.parentId,
      body: input.body,
      status: 'visible',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    await db.put('comments', comment)
    await db.put('photos', { ...photo, commentCount: photo.commentCount + 1 })
    await bumpDataVersion()
    return comment
  },

  async softRemove(id: string): Promise<void> {
    const db = await getDb()
    const comment = await db.get('comments', id)
    if (!comment) throw new AppError(ErrorCodes.NOT_FOUND, `评论不存在：${id}`)
    const now = new Date().toISOString()
    await db.put('comments', { ...comment, status: 'removed', deletedAt: now, updatedAt: now })
    const photo = await db.get('photos', comment.photoId)
    if (photo) {
      await db.put('photos', { ...photo, commentCount: Math.max(0, photo.commentCount - 1) })
    }
    await bumpDataVersion()
  },
}
