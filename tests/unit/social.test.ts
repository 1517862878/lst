/**
 * 社交闭环纯函数层单测（src/domain/social.ts）。
 *
 * 为什么测这一层而不是直接测仓储：jsdom 里没有 IndexedDB，mock 仓储的数据库路径
 * 跑不起来；而这一层是 mock 与 api **共用**的业务规则（排序 / 游标 / 计数 / 未读 / 文案）。
 * 仓储自身的 I/O 编排另有 mock-social.test.ts（桩掉 db 模块）与 api-social.test.ts（桩掉 http）。
 */
import { describe, expect, it } from 'vitest'
import type { AppNotification, Follow, Photo, Profile } from '@/domain/types'
import {
  decodeCursor,
  encodeCursor,
  feedPhotos,
  findProfileByUsername,
  followCounts,
  followingIdsOf,
  isFollowingUsername,
  markNotificationsRead,
  notificationIconName,
  notificationLink,
  notificationText,
  paginateByCursor,
  sortByCreatedAtDesc,
  unreadNotificationCount,
  unreadNotificationIds,
} from '@/domain/social'

// ===== 夹具 =====

function profile(id: string, username: string, displayName = username): Profile {
  return {
    id,
    username,
    displayName,
    avatarKey: null,
    bio: '',
    role: 'user',
    links: [],
    licensePreference: 'all_rights_reserved',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
}

function photo(id: string, authorId: string, overrides: Partial<Photo> = {}): Photo {
  return {
    id,
    authorId,
    title: `作品 ${id}`,
    description: '',
    categorySlug: 'landscape',
    tags: [],
    locationName: '',
    locationLat: null,
    locationLng: null,
    locationPrecision: 'city',
    shotAt: null,
    exif: null,
    imageKey: `photos/${id}.webp`,
    thumbKey: `photos/${id}-thumb.webp`,
    width: 1600,
    height: 1067,
    blurhash: null,
    license: 'all_rights_reserved',
    credit: null,
    status: 'published',
    likeCount: 0,
    favoriteCount: 0,
    commentCount: 0,
    viewCount: 0,
    publishedAt: '2026-02-01T00:00:00.000Z',
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function notification(id: string, overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    kind: 'like',
    actor: profile('u-actor', 'actor', '阿茶'),
    photoId: 'p1',
    commentId: null,
    readAt: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
  }
}

const follow = (followerId: string, followingId: string, createdAt = '2026-02-01T00:00:00.000Z'): Follow => ({
  followerId,
  followingId,
  createdAt,
})

// ===== 游标 =====

describe('游标编解码', () => {
  it('往返后得到原值', () => {
    for (const raw of ['p-1', '中文 id/带#号', 'notify-1']) {
      expect(decodeCursor(encodeCursor(raw))).toBe(raw)
    }
  })

  it('编码结果对 URL 安全（只出现 base64url 字符）', () => {
    expect(encodeCursor('a/b+c?d=e')).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('非法游标返回 null 而不是抛错', () => {
    // 老链接里的游标可能被截断/改写；抛错会让整个列表 500，退化成首页更合理
    expect(decodeCursor('!!!not-base64!!!')).toBeNull()
  })
})

// ===== 排序与分页 =====

describe('sortByCreatedAtDesc', () => {
  it('按 createdAt 倒序', () => {
    const items = [
      { id: 'a', createdAt: '2026-02-01T00:00:00.000Z' },
      { id: 'b', createdAt: '2026-02-03T00:00:00.000Z' },
      { id: 'c', createdAt: '2026-02-02T00:00:00.000Z' },
    ]
    expect(sortByCreatedAtDesc(items).map((i) => i.id)).toEqual(['b', 'c', 'a'])
  })

  it('时间戳相同时用 keyOf 兜底，保证全序（否则游标翻页会重复/漏项）', () => {
    const same = '2026-02-01T00:00:00.000Z'
    const items = [
      { id: 'b', createdAt: same },
      { id: 'c', createdAt: same },
      { id: 'a', createdAt: same },
    ]
    const once = sortByCreatedAtDesc(items, (i) => i.id).map((i) => i.id)
    const twice = sortByCreatedAtDesc([...items].reverse(), (i) => i.id).map((i) => i.id)
    expect(once).toEqual(['c', 'b', 'a'])
    expect(twice).toEqual(once)
  })

  it('不改动入参', () => {
    const items = [
      { id: 'a', createdAt: '2026-02-01T00:00:00.000Z' },
      { id: 'b', createdAt: '2026-02-02T00:00:00.000Z' },
    ]
    sortByCreatedAtDesc(items)
    expect(items.map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('paginateByCursor', () => {
  const items = Array.from({ length: 5 }, (_, index) => ({ id: `i${index}`, createdAt: '2026-02-01T00:00:00.000Z' }))
  const keyOf = (item: { id: string }) => item.id

  it('首页返回前 limit 条并给出 nextCursor', () => {
    const page = paginateByCursor(items, undefined, 2, keyOf)
    expect(page.items.map(keyOf)).toEqual(['i0', 'i1'])
    expect(page.nextCursor).not.toBeNull()
  })

  it('用上一页的 nextCursor 取下一页，不重不漏', () => {
    const first = paginateByCursor(items, undefined, 2, keyOf)
    const second = paginateByCursor(items, first.nextCursor ?? undefined, 2, keyOf)
    const third = paginateByCursor(items, second.nextCursor ?? undefined, 2, keyOf)
    expect(second.items.map(keyOf)).toEqual(['i2', 'i3'])
    expect(third.items.map(keyOf)).toEqual(['i4'])
  })

  it('最后一页的 nextCursor 为 null（前端据此停止翻页）', () => {
    const last = paginateByCursor(items, undefined, 5, keyOf)
    expect(last.items).toHaveLength(5)
    expect(last.nextCursor).toBeNull()
  })

  it('未知游标退化为首页，不返回空页（否则「加载更多」会卡死）', () => {
    const page = paginateByCursor(items, encodeCursor('已删除的行'), 2, keyOf)
    expect(page.items.map(keyOf)).toEqual(['i0', 'i1'])
  })

  it('limit 非正数时回落到默认页长而不是返回空', () => {
    const page = paginateByCursor(items, undefined, 0, keyOf)
    expect(page.items.length).toBeGreaterThan(0)
  })
})

// ===== 关注关系 =====

describe('关注统计', () => {
  const follows = [follow('me', 'a'), follow('me', 'b'), follow('c', 'me'), follow('d', 'a')]

  it('followCounts 分别数粉丝与关注，互不串台', () => {
    expect(followCounts(follows, 'me')).toEqual({ followers: 1, following: 2 })
    expect(followCounts(follows, 'a')).toEqual({ followers: 2, following: 0 })
    expect(followCounts(follows, 'nobody')).toEqual({ followers: 0, following: 0 })
  })

  it('followingIdsOf 只收「我关注的人」', () => {
    expect([...followingIdsOf(follows, 'me')].sort()).toEqual(['a', 'b'])
  })

  it('findProfileByUsername 大小写不敏感并去掉首尾空格', () => {
    const profiles = [profile('u1', 'Lin')]
    expect(findProfileByUsername(profiles, '  lin ')).toEqual(profiles[0])
    expect(findProfileByUsername(profiles, 'nobody')).toBeUndefined()
  })

  it('isFollowingUsername 走用户名而不是 id', () => {
    const profiles = [profile('u-a', 'Alice'), profile('u-b', 'Bob')]
    const mine = [follow('me', 'u-b')]
    expect(isFollowingUsername(mine, profiles, 'me', 'bob')).toBe(true)
    expect(isFollowingUsername(mine, profiles, 'me', 'ALICE')).toBe(false)
    // 目标不存在（用户已注销）时返回 false，而不是抛错
    expect(isFollowingUsername(mine, profiles, 'me', 'ghost')).toBe(false)
  })
})

// ===== 关注动态 =====

describe('feedPhotos', () => {
  const following = new Set(['u-a'])

  it('只保留「我关注的作者」且已发布、未删除的作品', () => {
    const photos = [
      photo('p1', 'u-a'),
      photo('p2', 'u-b'), // 没关注
      photo('p3', 'u-a', { status: 'draft' }),
      photo('p4', 'u-a', { deletedAt: '2026-02-02T00:00:00.000Z' }),
    ]
    expect(feedPhotos(photos, following).map((p) => p.id)).toEqual(['p1'])
  })

  it('按 publishedAt 倒序；草稿后发布时按发布时间而不是创建时间', () => {
    const photos = [
      photo('old-draft', 'u-a', { publishedAt: '2026-03-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }),
      photo('new', 'u-a', { publishedAt: '2026-02-10T00:00:00.000Z', createdAt: '2026-02-10T00:00:00.000Z' }),
    ]
    expect(feedPhotos(photos, following).map((p) => p.id)).toEqual(['old-draft', 'new'])
  })

  it('publishedAt 缺失时退回 createdAt', () => {
    const photos = [
      photo('a', 'u-a', { publishedAt: null, createdAt: '2026-02-01T00:00:00.000Z' }),
      photo('b', 'u-a', { publishedAt: null, createdAt: '2026-02-05T00:00:00.000Z' }),
    ]
    expect(feedPhotos(photos, following).map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('同一时间发布时用 id 兜底全序，保证游标稳定', () => {
    const same = '2026-02-01T00:00:00.000Z'
    const photos = [photo('b', 'u-a', { publishedAt: same }), photo('a', 'u-a', { publishedAt: same })]
    expect(feedPhotos(photos, following).map((p) => p.id)).toEqual(['b', 'a'])
    expect(feedPhotos([...photos].reverse(), following).map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('不改动入参（页面上同时渲染作品墙与动态流时会互相干扰）', () => {
    const photos = [photo('a', 'u-a'), photo('b', 'u-a')]
    const before = photos.map((p) => p.id)
    feedPhotos(photos, following)
    expect(photos.map((p) => p.id)).toEqual(before)
  })

  it('没关注任何人时返回空数组', () => {
    expect(feedPhotos([photo('a', 'u-a')], new Set())).toEqual([])
  })
})

// ===== 通知 =====

describe('通知未读统计', () => {
  const items = [
    notification('n1'),
    notification('n2', { readAt: '2026-02-02T00:00:00.000Z' }),
    notification('n3'),
  ]

  it('unreadNotificationCount 只数 readAt 为 null 的', () => {
    expect(unreadNotificationCount(items)).toBe(2)
    expect(unreadNotificationCount([])).toBe(0)
  })

  it('unreadNotificationIds 保持列表顺序', () => {
    expect(unreadNotificationIds(items)).toEqual(['n1', 'n3'])
  })

  it('markNotificationsRead 只返回真正变化的行（已读的不重复写库）', () => {
    const changed = markNotificationsRead(items, ['n1', 'n2', 'n9'], '2026-03-01T00:00:00.000Z')
    expect(changed.map((n) => n.id)).toEqual(['n1'])
    expect(changed[0]?.readAt).toBe('2026-03-01T00:00:00.000Z')
  })

  it('ids 为 undefined 表示全部标记为已读', () => {
    const changed = markNotificationsRead(items, undefined, '2026-03-01T00:00:00.000Z')
    expect(changed.map((n) => n.id)).toEqual(['n1', 'n3'])
  })

  it('不改动入参', () => {
    markNotificationsRead(items, undefined, '2026-03-01T00:00:00.000Z')
    expect(items.map((n) => n.readAt)).toEqual([null, '2026-02-02T00:00:00.000Z', null])
  })
})

describe('通知文案与跳转', () => {
  it('有 actor 时用展示名（而不是 @用户名）', () => {
    expect(notificationText(notification('n1', { kind: 'like' }), '晨雾')).toBe('阿茶 赞了《晨雾》')
    expect(notificationText(notification('n1', { kind: 'follow' }))).toBe('阿茶 关注了你')
  })

  it('拿不到作品标题时不硬编「未知作品」', () => {
    expect(notificationText(notification('n1', { kind: 'comment' }))).toBe('阿茶 评论了你的作品')
  })

  it('actor 为空时退回无人称文案', () => {
    expect(notificationText(notification('n1', { kind: 'system', actor: null }))).toBe('系统通知')
    expect(notificationText(notification('n1', { kind: 'like', actor: null }))).toBe('你的作品收到了新的赞')
  })

  it('展示名缺失时退回 @username', () => {
    const actor = { ...profile('u-a', 'actor'), displayName: '' }
    expect(notificationText(notification('n1', { kind: 'follow', actor }))).toBe('@actor 关注了你')
  })

  it('点赞/评论跳作品页、关注跳对方主页、系统通知无跳转', () => {
    expect(notificationLink(notification('n1', { kind: 'like', photoId: 'p9' }))).toEqual({
      to: '/works/p9',
      label: '查看作品',
    })
    expect(notificationLink(notification('n1', { kind: 'follow' }))).toEqual({
      to: '/u/actor',
      label: '查看主页',
    })
    expect(notificationLink(notification('n1', { kind: 'system', actor: null, photoId: null }))).toBeNull()
  })

  it('作品已删除（photoId 为空）时不给必然 404 的链接', () => {
    expect(notificationLink(notification('n1', { kind: 'like', photoId: null }))).toBeNull()
  })

  it('图标语义名齐四种类型', () => {
    expect(notificationIconName('like')).toBe('heart')
    expect(notificationIconName('comment')).toBe('message')
    expect(notificationIconName('follow')).toBe('user-plus')
    expect(notificationIconName('system')).toBe('megaphone')
  })
})
