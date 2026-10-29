/**
 * API 收藏夹与服务端草稿仓储（8.3b）。
 *
 * 端点清单（已冻结，见 .tmp/phase83b-freeze.md §2）：
 *   GET/PUT/DELETE /api/me/publish-draft
 *   GET  /api/me/collections
 *   GET  /api/u/:username/collections
 *   POST /api/collections          PATCH/DELETE /api/collections/:id
 *   GET  /api/collections/:id      GET /api/collections/:id/items
 *   POST /api/collections/:id/items     DELETE /api/collections/:id/items/:photoId
 *
 * 与 mock 实现同一份契约：页面只认 CollectionRepository，切换数据源页面零改动。
 * 可见性（private / unlisted / public）全部由数据库判定，本层不写第二套；
 * 不可见的夹后端回 404（不是 403），这里原样抛出去，页面据此渲染空态。
 */
import {
  AppError,
  ErrorCodes,
  type Collection,
  type CollectionRepository,
  type CollectionSummary,
  type CollectionVisibility,
  type CursorListPage,
  type PublishDraft,
  type PublishDraftPayload,
} from '@/data/contracts'
import type { Photo } from '@/domain/types'
import { qs, request } from './client'

interface ItemsResponse<T> {
  items: T[]
}

/** 详情端点一次事务返回夹信息 + 首屏条目，这里只取夹信息，条目交给分页接口 */
interface CollectionDetailResponse {
  collection: Collection | null
  items: Photo[]
  nextCursor: string | null
}

function collectionPath(id: string): string {
  return `/api/collections/${encodeURIComponent(id)}`
}

export const apiCollectionRepository: CollectionRepository = {
  async getMyDraft(): Promise<PublishDraft> {
    const data = await request<{ payload: PublishDraftPayload | null; updatedAt: string | null }>(
      '/api/me/publish-draft',
    )
    return { payload: data.payload ?? null, updatedAt: data.updatedAt ?? null }
  },

  async saveMyDraft(payload: PublishDraftPayload): Promise<{ updatedAt: string }> {
    return request<{ updatedAt: string }>('/api/me/publish-draft', {
      method: 'PUT',
      body: { payload },
    })
  },

  async deleteMyDraft(): Promise<void> {
    await request<void>('/api/me/publish-draft', { method: 'DELETE' })
  },

  async listMyCollections(): Promise<CollectionSummary[]> {
    const data = await request<ItemsResponse<CollectionSummary>>('/api/me/collections')
    return data.items
  },

  async listUserCollections(username: string): Promise<CollectionSummary[]> {
    const data = await request<ItemsResponse<CollectionSummary>>(
      `/api/u/${encodeURIComponent(username)}/collections`,
    )
    return data.items
  },

  async getCollection(id: string): Promise<Collection> {
    const data = await request<CollectionDetailResponse>(collectionPath(id))
    // 后端对不可见夹返回空集 + 404，两种形态都收敛成 NOT_FOUND：
    // 页面只需要「看不到」这一个语义，不必区分「不存在」与「无权」。
    if (!data.collection) throw new AppError(ErrorCodes.NOT_FOUND, '这个收藏夹不存在或不可见')
    return data.collection
  },

  async listCollectionItems(
    id: string,
    options?: { cursor?: string | null; limit?: number },
  ): Promise<CursorListPage<Photo>> {
    const data = await request<CursorListPage<Photo>>(
      `${collectionPath(id)}/items` + qs({ cursor: options?.cursor, limit: options?.limit }),
    )
    return { items: data.items, nextCursor: data.nextCursor ?? null }
  },

  async createCollection(input: {
    title: string
    description?: string
    visibility?: CollectionVisibility
  }): Promise<CollectionSummary> {
    return request<CollectionSummary>('/api/collections', {
      method: 'POST',
      body: {
        title: input.title,
        description: input.description,
        visibility: input.visibility,
      },
    })
  },

  async updateCollection(
    id: string,
    patch: { title?: string; description?: string; visibility?: CollectionVisibility },
  ): Promise<CollectionSummary> {
    return request<CollectionSummary>(collectionPath(id), { method: 'PATCH', body: patch })
  },

  async deleteCollection(id: string): Promise<void> {
    await request<void>(collectionPath(id), { method: 'DELETE' })
  },

  async addItem(collectionId: string, photoId: string): Promise<{ itemCount: number }> {
    return request<{ itemCount: number }>(`${collectionPath(collectionId)}/items`, {
      method: 'POST',
      body: { photoId },
    })
  },

  async removeItem(collectionId: string, photoId: string): Promise<{ itemCount: number }> {
    return request<{ itemCount: number }>(
      `${collectionPath(collectionId)}/items/${encodeURIComponent(photoId)}`,
      { method: 'DELETE' },
    )
  },
}
