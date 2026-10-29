/**
 * 单测共用的实体工厂。
 *
 * 8.4a 一口气新增了五组界面测试，每处各写一份 Photo 字面量会让任何一次
 * 契约加字段都变成「改五处、漏一处」。这里只放**必填字段**的默认值，
 * 要测什么就传什么 —— 覆盖项一律由调用方的 overrides 决定，不做隐式默认。
 */
import type { Photo, Profile } from '@/domain/types'

/** 一个已发布、公开可见、坐标只到城市的最小作品。 */
export function makePhoto(id: string, overrides: Partial<Photo> = {}): Photo {
  return {
    id,
    authorId: 'u1',
    title: id,
    description: '',
    categorySlug: 'landscape',
    tags: [],
    locationName: '',
    locationLat: null,
    locationLng: null,
    locationPrecision: 'city',
    shotAt: null,
    exif: null,
    imageKey: `${id}.jpg`,
    thumbKey: `${id}-thumb.jpg`,
    width: 1600,
    height: 1067,
    blurhash: null,
    license: 'cc_by',
    credit: null,
    status: 'published',
    likeCount: 0,
    favoriteCount: 0,
    commentCount: 0,
    viewCount: 0,
    publishedAt: '2026-03-01T00:00:00.000Z',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

/** 一个默认公开拍摄参数、没设代表作的作者资料。 */
export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'u1',
    username: 'me',
    displayName: '我',
    avatarKey: null,
    bio: '',
    role: 'user',
    links: [],
    licensePreference: 'cc_by',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}
