/**
 * Mock 搜索仓储。契约：SearchRepository。
 * 静态期：运行时全表扫描 + 简单关键词匹配（ROADMAP §7.1）。
 * 注意：完整 MiniSearch 索引与中文分词在 S6 落地（FRONTEND-WORK §4.6），
 * 本实现是 S2 的临时占位，接口已定，实现可原地替换。
 */
import type { Page, PhotoRepository, SearchQuery, SearchRepository } from '@/data/contracts'
import type { Photo, UserHit } from '@/domain/types'
import { getDb } from '../db'
import { normalizeSearchText, normalizeTag } from '@/lib/search/normalize'
import { searchUserHits } from '@/domain/social'
import { mockAuthRepository } from './auth'

export const mockSearchRepository: SearchRepository = {
  async search(query: SearchQuery): Promise<Page<Photo>> {
    const db = await getDb()
    const all = (await db.getAll('photos')).filter((p) => p.status === 'published')
    const text = normalizeSearchText(query.text)
    let matched = all
    if (text) {
      const terms = text.split(' ').filter(Boolean)
      matched = all.filter((p) => {
        const haystack = normalizeSearchText([p.title, p.description, p.locationName, ...p.tags].join(' '))
        return terms.every((term) => haystack.includes(term))
      })
    }
    if (query.categorySlug) matched = matched.filter((p) => p.categorySlug === query.categorySlug)
    if (query.tags?.length) {
      const requiredTags = query.tags.map(normalizeTag)
      matched = matched.filter((p) => {
        const photoTags = new Set(p.tags.map(normalizeTag))
        return requiredTags.every((tag) => photoTags.has(tag))
      })
    }
    if (query.locationName) {
      const location = normalizeSearchText(query.locationName)
      matched = matched.filter((p) => normalizeSearchText(p.locationName).includes(location))
    }
    if (query.sort === 'hot') {
      matched.sort((a, b) => b.likeCount + b.favoriteCount * 3 - (a.likeCount + a.favoriteCount * 3))
    } else if (query.sort === 'latest') {
      matched.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    }
    const limit = query.limit ?? 24
    return { items: matched.slice(0, limit), nextCursor: null, total: matched.length }
  },

  async searchUsers(query: string, options?: { limit?: number }): Promise<UserHit[]> {
    const db = await getDb()
    const session = await mockAuthRepository.getSession()
    const [profiles, follows, blocks] = await Promise.all([
      db.getAll('profiles'),
      db.getAll('follows'),
      db.getAll('blocks'),
    ])
    return searchUserHits(profiles, follows, blocks, session?.userId ?? null, query, options?.limit)
  },
}

/** 供照片列表复用的照片仓库引用（避免循环 import） */
export type { PhotoRepository }
