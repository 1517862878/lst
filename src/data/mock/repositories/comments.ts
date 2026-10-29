/**
 * Mock 评论仓储。契约：CommentRepository。
 *
 * 分页同为游标；排序 latest（默认）/ oldest 由 query.sort 决定，游标含义跟着排序走。
 * 软删保留占位。
 *
 * 8.4b 的两个作者控制与 api 实现保持同一套判定：
 *   · 锁：作者关掉评论后，**任何人**（包括作者自己）再提交都被 409 拒绝，
 *     而不是前端悄悄藏掉输入框就算数；
 *   · 删：评论作者本人或作品作者都能删，其余人 FORBIDDEN；已删除的再删一次不报错。
 *   判定用当前会话，与真实 RLS 的口径一致 —— 页面传不传 authorId 都不影响授权。
 */
import {
  AppError,
  ErrorCodes,
  type CommentListQuery,
  type CommentRepository,
  type CommentSort,
} from '@/data/contracts'
import type { Comment } from '@/domain/types'
import { isBlockedBetween } from '@/domain/social'
import { getDb, bumpDataVersion } from '../db'
import { mockAuthRepository } from './auth'

function encodeCursor(key: string): string {
  return btoa(key).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// 游标对页面是不透明串：发出去的是 base64url，收回来要还原成 id 再找位置，
// 否则翻页永远从第一条开始（api 仓储由后端解码，两边行为必须一致）
function decodeCursor(cursor: string): string {
  return atob(cursor.replace(/-/g, '+').replace(/_/g, '/'))
}

const byCreatedAt = (sort: CommentSort) => (a: Comment, b: Comment) => {
  const order = a.createdAt.localeCompare(b.createdAt)
  // 同一毫秒的并发评论用 id 兜底，保证两种排序下总顺序稳定（否则游标翻页会漏条）
  const key = order !== 0 ? order : a.id.localeCompare(b.id)
  return sort === 'oldest' ? key : -key
}

async function requireSession() {
  const session = await mockAuthRepository.getSession()
  if (!session) throw new AppError(ErrorCodes.UNAUTHORIZED, '请先登录后再操作')
  return session
}

export const mockCommentRepository: CommentRepository = {
  async list(query: CommentListQuery): Promise<{ items: Comment[]; nextCursor: string | null; total: number }> {
    const db = await getDb()
    const all = (await db.getAll('comments'))
      .filter((c) => c.photoId === query.photoId)
      .sort(byCreatedAt(query.sort ?? 'latest'))
    const limit = query.limit ?? 20
    let startIndex = 0
    if (query.cursor) {
      const lastId = decodeCursor(query.cursor)
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
    // 409 而不是 403：这不是「你没权限」，而是「这件作品的评论区现在关着」，
    // 前端据此给出与页面锁定态一致的文案，而不是「无权评论」。
    if (photo.commentsLocked === true) {
      throw new AppError(ErrorCodes.CONFLICT, '作者已关闭这件作品的评论')
    }
    if (
      input.authorId !== photo.authorId &&
      isBlockedBetween(await db.getAll('blocks'), input.authorId, photo.authorId)
    ) {
      throw new AppError(ErrorCodes.FORBIDDEN, '你无法评论该用户的作品')
    }
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
    const session = await requireSession()
    const db = await getDb()
    const comment = await db.get('comments', id)
    if (!comment) throw new AppError(ErrorCodes.NOT_FOUND, `评论不存在：${id}`)
    const photo = await db.get('photos', comment.photoId)
    const isCommentAuthor = comment.authorId === session.userId
    const isPhotoAuthor = photo?.authorId === session.userId
    if (!isCommentAuthor && !isPhotoAuthor) {
      throw new AppError(ErrorCodes.FORBIDDEN, '只能删除自己的评论，或自己作品下的评论')
    }
    // 已删除：幂等返回，避免重试把 commentCount 再减一次
    if (comment.status === 'removed' || comment.deletedAt) return
    const now = new Date().toISOString()
    await db.put('comments', { ...comment, status: 'removed', deletedAt: now, updatedAt: now })
    if (photo) {
      await db.put('photos', { ...photo, commentCount: Math.max(0, photo.commentCount - 1) })
    }
    await bumpDataVersion()
  },

  async setLocked(photoId: string, locked: boolean): Promise<{ photoId: string; commentsLocked: boolean }> {
    const session = await requireSession()
    const db = await getDb()
    const photo = await db.get('photos', photoId)
    if (!photo) throw new AppError(ErrorCodes.NOT_FOUND, `作品不存在：${photoId}`)
    if (photo.authorId !== session.userId) {
      throw new AppError(ErrorCodes.FORBIDDEN, '只有作品作者可以关闭评论')
    }
    const next = locked === true
    if (photo.commentsLocked !== next) {
      await db.put('photos', { ...photo, commentsLocked: next, updatedAt: new Date().toISOString() })
      await bumpDataVersion()
    }
    return { photoId, commentsLocked: next }
  },
}
