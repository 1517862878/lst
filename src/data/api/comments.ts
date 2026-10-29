import type { CommentListQuery, CommentRepository, Page } from '@/data/contracts'
import type { Comment } from '@/domain/types'
import { qs, request } from './client'

const pathOf = (photoId: string) => `/api/photos/${encodeURIComponent(photoId)}/comments`

export const apiCommentRepository: CommentRepository = {
  list(query: CommentListQuery): Promise<Page<Comment>> {
    // sort 只在非默认值时下发：后端缺省即 latest，省略可少一个缓存维度
    return request(
      pathOf(query.photoId) +
        qs({
          sort: query.sort && query.sort !== 'latest' ? query.sort : undefined,
          cursor: query.cursor,
          limit: query.limit,
        }),
    )
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
  setLocked(photoId: string, locked: boolean) {
    return request<{ photoId: string; commentsLocked: boolean }>(
      `/api/photos/${encodeURIComponent(photoId)}/comments-lock`,
      { method: 'PUT', body: { locked } },
    )
  },
}
