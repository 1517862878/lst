/**
 * API 标签仓储（8.3a）。
 *
 * 端点清单（已冻结，见 .tmp/phase83a-freeze.md 第 3 节）：
 *   GET /api/tags                     ?sort=hot|latest&limit=&prefix=
 *   GET /api/tags/:tag                 → 标签详情（含 relatedTags）
 *   GET /api/tags/:tag/photos          ?sort=latest|popular&cursor=&limit=
 *   GET /api/search/tags               ?q=&limit=
 *
 * 与 mock 实现同一份契约：页面只认 TagRepository，切换数据源页面零改动。
 */
import type {
  CursorListPage,
  TagDetail,
  TagListQuery,
  TagPhotoQuery,
  TagRepository,
  TagSuggestion,
  TagSummary,
} from '@/data/contracts'
import type { Photo } from '@/domain/types'
import { qs, request } from './client'

/** 列表端点通用形状：后端的 tags 视图固定回 items */
interface TagListResponse<T> {
  items: T[]
}

function tagPath(tag: string): string {
  return `/api/tags/${encodeURIComponent(tag)}`
}

export const apiTagRepository: TagRepository = {
  async list(query: TagListQuery): Promise<TagSummary[]> {
    const data = await request<TagListResponse<TagSummary>>(
      '/api/tags' +
        qs({
          sort: query.sort,
          limit: query.limit,
          prefix: query.prefix?.trim() || undefined,
        }),
    )
    return data.items
  },

  async get(tag: string): Promise<TagDetail> {
    return request<TagDetail>(tagPath(tag))
  },

  async photos(tag: string, query: TagPhotoQuery): Promise<CursorListPage<Photo>> {
    const data = await request<CursorListPage<Photo>>(
      tagPath(tag) +
        '/photos' +
        qs({ sort: query.sort, cursor: query.cursor, limit: query.limit }),
    )
    // 后端可能省略 nextCursor（最后一页），统一收敛成 null，页面只判 null
    return { items: data.items, nextCursor: data.nextCursor ?? null }
  },

  async suggest(prefix: string, options?: { limit?: number }): Promise<TagSuggestion[]> {
    const key = prefix.trim()
    if (!key) return []
    const data = await request<TagListResponse<TagSuggestion>>(
      '/api/search/tags' + qs({ q: key, limit: options?.limit }),
    )
    return data.items
  },
}
