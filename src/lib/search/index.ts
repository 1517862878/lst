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

/** 是否为纯拉丁/数字查询（可用模糊匹配）；含中文则只做精确 + 前缀 */
function isLatinQuery(query: string): boolean {
  return /^[a-zA-Z0-9\s]+$/.test(query)
}

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

/**
 * 搜索，返回匹配的 photo id 列表（按相关度排序）。
 *
 * 两个关键取舍（都由 E2E 发现）：
 *   1) combineWith: 'AND' —— MiniSearch 默认是 OR：查询「zzzz不存在的关键词zzzz」
 *      被分词成 ["zzzz","不存在","的","关键","词"]，其中「的」这类单字几乎命中所有
 *      作品，导致搜无意义内容返回 57 个结果。改成 AND（所有词都要命中）后为 0。
 *   2) fuzzy 仅对纯拉丁查询启用 —— 中文分词后做模糊匹配会把大量词算作近似，
 *      搜索结果会变得"什么都搜得到"。英文/数字才需要容忍拼写错误。
 */
export function searchPhotos(photos: Photo[], query: string): Photo[] {
  const idx = buildIndex(photos)
  const q = query.trim()
  if (!q) return []

  const results = idx.search(q, {
    boost: { title: 3, tags: 2 },
    prefix: true,
    combineWith: 'AND',
    fuzzy: isLatinQuery(q) ? 0.2 : false,
  })

  const byId = new Map(photos.map((p) => [p.id, p]))
  return results.map((r) => byId.get(r.id)).filter((p): p is Photo => p !== undefined)
}
