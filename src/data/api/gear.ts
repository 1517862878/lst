/**
 * API 器材仓储（8.4a）。
 *
 * 契约：GearRepository（src/data/contracts）；行为与 mock 实现一致。
 * 后端函数：public.api_list_gear / public.api_gear_photos（迁移 0031）。
 */
import type { CursorListPage, GearPhotoQuery, GearRepository, GearSummary } from '@/data/contracts'
import type { GearKind } from '@/domain/photography'
import type { Photo } from '@/domain/types'
import { GEAR_LIMIT, GEAR_KIND_LABELS, isGearKind } from '@/domain/photography'
import { request, qs } from './client'

export const apiGearRepository: GearRepository = {
  async list(limit = GEAR_LIMIT): Promise<GearSummary[]> {
    const data = await request<{ items: GearSummary[] }>('/api/gear' + qs({ limit }))
    // 后端已按 kind/label 排序；这里只把空 label 挡掉（脏 EXIF 不该长出一个空按钮）
    return (data.items ?? []).filter((item) => item.label.trim() !== '')
  },

  async photos(
    kind: GearKind,
    label: string,
    query: GearPhotoQuery = {},
  ): Promise<CursorListPage<Photo>> {
    if (!isGearKind(kind)) {
      throw new Error(`未知器材类型：${kind}（只支持 ${Object.keys(GEAR_KIND_LABELS).join(' / ')}）`)
    }
    return request<CursorListPage<Photo>>(
      `/api/gear/${encodeURIComponent(kind)}/photos` +
        qs({ label, limit: query.limit, cursor: query.cursor ?? undefined }),
    )
  },
}
