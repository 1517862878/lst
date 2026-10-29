/**
 * API 发现仓储（8.3c）。
 *
 * 端点清单（冻结契约 .tmp/phase83c-freeze.md 第 3 节）：
 *   GET  /api/discover/hot-searches           ?days=&limit=   → { items: HotSearch[] }
 *   GET  /api/discover/new-authors            ?days=&limit=   → { items: NewAuthor[] }
 *   GET  /api/discover/featured               ?cursor=&limit= → { items, nextCursor }
 *   POST /api/admin/photos/:id/feature                          → { photoId, featuredAt }
 *   DELETE /api/admin/photos/:id/feature                        → { photoId, featuredAt: null }
 *
 * 与 mock 实现同一份契约：页面只认 DiscoverRepository，切换数据源页面零改动。
 */
import type {
  CursorListPage,
  DiscoverRepository,
  EditorChoiceResult,
  HotSearch,
  HotSearchQuery,
  NewAuthor,
  NewAuthorQuery,
} from '@/data/contracts'
import type { Photo } from '@/domain/types'
import { qs, request } from './client'

/** 两个聚合端点都只回 items（没有分页） */
interface DiscoverListResponse<T> {
  items: T[]
}

function adminPhotoPath(photoId: string, action: 'feature'): string {
  return `/api/admin/photos/${encodeURIComponent(photoId)}/${action}`
}

export const apiDiscoverRepository: DiscoverRepository = {
  async hotSearches(query?: HotSearchQuery): Promise<HotSearch[]> {
    const data = await request<DiscoverListResponse<HotSearch>>(
      '/api/discover/hot-searches' + qs({ days: query?.days, limit: query?.limit }),
    )
    return data.items
  },

  async newAuthors(query?: NewAuthorQuery): Promise<NewAuthor[]> {
    const data = await request<DiscoverListResponse<NewAuthor>>(
      '/api/discover/new-authors' + qs({ days: query?.days, limit: query?.limit }),
    )
    return data.items
  },

  async featured(cursor?: string, limit?: number): Promise<CursorListPage<Photo>> {
    const data = await request<CursorListPage<Photo>>(
      '/api/discover/featured' + qs({ cursor, limit }),
    )
    // 后端可能省略 nextCursor（最后一页），统一收敛成 null，页面只判 null
    return { items: data.items ?? [], nextCursor: data.nextCursor ?? null }
  },

  async setEditorChoice(photoId: string, featured: boolean): Promise<EditorChoiceResult> {
    return request<EditorChoiceResult>(adminPhotoPath(photoId, 'feature'), {
      method: featured ? 'POST' : 'DELETE',
    })
  },
}
