import type { CommentListQuery, CommentRepository, Page } from '@/data/contracts'
import type { Comment } from '@/domain/types'
import { qs, request } from './client'

const pathOf = (photoId: string) => `/api/photos/${encodeURIComponent(photoId)}/comments`

export const apiCommentRepository: CommentRepository = {
  list(query: CommentListQuery): Promise<Page<Comment>> {
    return request(pathOf(query.photoId) + qs({ cursor: query.cursor, limit: query.limit }))
  },
  create(input): Promise<Comment> {
    return request(pathOf(input.photoId), {
      method: 'POST',
      body: { parentId: input.parentId, body: input.body },
    })
  },
  async softRemove(id: string): Promise<void> {
    await request(`/api/comments/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
}
