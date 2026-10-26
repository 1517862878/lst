/**
 * Mock 搜索仓储。契约：SearchRepository。
 * 静态期：运行时全表扫描 + 简单关键词匹配（ROADMAP §7.1）。
 * 注意：完整 MiniSearch 索引与中文分词在 S6 落地（FRONTEND-WORK §4.6），
 * 本实现是 S2 的临时占位，接口已定，实现可原地替换。
 */
import type { Page, PhotoRepository, SearchQuery, SearchRepository } from '@/data/contracts'
import type { Photo } from '@/domain/types'
import { getDb } from '../db'

export const mockSearchRepository: SearchRepository = {
  async search(query: SearchQuery): Promise<Page<Photo>> {
    const db = await getDb()
    const all = (await db.getAll('photos')).filter((p) => p.status === 'published')
    const text = query.text.trim().toLowerCase()
    let matched = all
    if (text) {
      matched = all.filter((p) => {
        const haystack = [p.title, p.description, p.locationName, ...p.tags]
          .join(' ')
          .toLowerCase()
        return haystack.includes(text)
      })
    }
    if (query.categorySlug) matched = matched.filter((p) => p.categorySlug === query.categorySlug)
    if (query.sort === 'popular') {
      matched.sort((a, b) => b.likeCount + b.favoriteCount * 3 - (a.likeCount + a.favoriteCount * 3))
    } else {
      matched.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    }
    const limit = query.limit ?? 24
    return { items: matched.slice(0, limit), nextCursor: null, total: matched.length }
  },
}

/** 供照片列表复用的照片仓库引用（避免循环 import） */
export type { PhotoRepository }
