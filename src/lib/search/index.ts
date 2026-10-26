/**
 * MiniSearch 索引封装（ROADMAP §7.1 / FRONTEND-WORK §4.6）。
 * 运行时建索引（数据本就在浏览器，无构建期索引）。
 */
import MiniSearch from 'minisearch'
import type { Photo } from '@/domain/types'
import { tokenize } from './tokenize'

export interface SearchDoc {
  id: string
  title: string
  description: string
  locationName: string
  tags: string
}

let index: MiniSearch<SearchDoc> | null = null

/** 建立索引（惰性单次；数据变更后需 rebuild） */
export function buildIndex(photos: Photo[]): MiniSearch<SearchDoc> {
  if (index) return index
  index = new MiniSearch<SearchDoc>({
    fields: ['title', 'description', 'locationName', 'tags'],
    storeFields: ['id'],
    tokenize: (text) => tokenize(text),
    searchOptions: {
      boost: { title: 3, tags: 2 },
      prefix: true,
      fuzzy: 0.2,
    },
  })
  index.addAll(
    photos.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      locationName: p.locationName,
      tags: p.tags.join(' '),
    })),
  )
  return index
}

/** 失效索引（数据写入后调用） */
export function invalidateIndex(): void {
  index = null
}

/** 搜索，返回匹配的 photo id 列表（按相关度排序） */
export function searchPhotos(photos: Photo[], query: string): Photo[] {
  const idx = buildIndex(photos)
  const results = idx.search(query)
  const byId = new Map(photos.map((p) => [p.id, p]))
  return results.map((r) => byId.get(r.id)).filter((p): p is Photo => p !== undefined)
}
