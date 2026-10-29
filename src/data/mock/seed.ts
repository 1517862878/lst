/**
 * 演示种子数据（DATA-MODEL §9 / ROADMAP §5）。
 * 规格：10 用户、80 作品、300 互动（likes+favorites）、12 篇文章、8 分类、4 主题。
 * 版权：全部作品 credit='示例素材'；示例图片占位（S3 前无真实图片文件，用纯色 SVG data URL 兜底）。
 */
import type {
  AppNotification,
  Article,
  Comment,
  Follow,
  Interaction,
  NotificationKind,
  Photo,
  Profile,
} from '@/domain/types'
import { ARTICLE_TOPICS, CATEGORIES, DEMO_ACCOUNTS, DEMO_PASSWORD } from '@/domain/constants'
import type { NotificationRow } from './db'
import { buildModerationSeed, type ModerationSeedResult } from './seedModeration'

const now = Date.now()
const DAY = 24 * 60 * 60 * 1000
const iso = (t: number): string => new Date(t).toISOString()

/** 确定性伪随机（mulberry32），保证 seed 可复现、契约测试稳定 */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20261026)
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!

const USER_NAMES = [
  ...DEMO_ACCOUNTS.map((d) => d.username),
  'chen', 'lin', 'wang', 'zhao', 'liu', 'yang', 'huang',
] as const

const TITLES = [
  '山间晨雾', '城市天际线', '老街黄昏', '机械之美', '电路板微距', '星空下的帐篷',
  '雨后的窗', '码头日出', '旧厂房的光影', '苔藓与石阶', '霓虹夜色', '稻田与风',
  '工业管道', '实验室一角', '古桥倒影', '废弃车站', '雾中灯塔', '齿轮特写',
  '雪后小径', '夜市烟火',
] as const

const LOCATIONS = [
  '云南·梅里雪山', '上海·陆家嘴', '成都·宽窄巷子', '沈阳·铁西区', '深圳·华强北',
  '青海·茶卡盐湖', '苏州·平江路', '青岛·小港码头', '重庆·工业博物馆', '杭州·西湖',
] as const

const DESCRIPTIONS = [
  '清晨五点半到达机位，等来第一缕光穿过云层。',
  '用长焦压缩空间，把楼群拍成城市森林。',
  '老街的烟火气，最值得按下快门。',
  '工业题材的魅力在于秩序与力量感。',
  '微距下的世界，细节惊人。',
] as const

export interface SeedResult extends ModerationSeedResult {
  profiles: Profile[]
  photos: Photo[]
  likes: Interaction[]
  favorites: Interaction[]
  comments: Comment[]
  articles: Article[]
  follows: Follow[]
  notifications: NotificationRow[]
}

export function buildSeedData(): SeedResult {
  const profiles: Profile[] = USER_NAMES.map((username, i) => {
    const demo = DEMO_ACCOUNTS.find((d) => d.username === username)
    return {
      id: `seed-user-${i + 1}`,
      username,
      displayName: demo?.displayName ?? `用户${i + 1}`,
      avatarKey: null,
      bio: '用镜头记录生活。',
      role: demo?.role ?? 'user',
      links: [],
      licensePreference: 'all_rights_reserved',
      createdAt: iso(now - 90 * DAY),
      updatedAt: iso(now - 30 * DAY),
      deletedAt: null,
    }
  })

  const photos: Photo[] = Array.from({ length: 80 }, (_, i) => {
    const author = pick(profiles)
    const category = pick(CATEGORIES)
    const publishedAt = now - Math.floor(rand() * 60) * DAY - Math.floor(rand() * DAY)
    const w = 1600 + Math.floor(rand() * 800)
    // 8.3c：前 3 件作品预先标为「编辑精选」，首页区块开箱即有内容。
    // 注意不要为它调用 rand()——rand 是固定种子的序列，插一次调用就会把后面
    // 所有作者的 likeCount/发布时间整体错位，平静的演示数据会突然变得不可复现。
    const featuredAt = i < 3 ? iso(now - (i + 1) * DAY) : null
    const h = Math.round(w * (rand() * 0.5 + 0.6))
    return {
      id: `seed-photo-${String(i + 1).padStart(3, '0')}`,
      authorId: author.id,
      title: `${pick(TITLES)}${i >= 20 ? ` ${i + 1}` : ''}`,
      description: pick(DESCRIPTIONS),
      categorySlug: category.slug,
      tags: [category.name, pick(['风光', '街拍', '长曝', '黑白', '微距'])].slice(0, 3),
      locationName: pick(LOCATIONS),
      locationLat: null,
      locationLng: null,
      locationPrecision: 'city',
      shotAt: iso(publishedAt - Math.floor(rand() * 30) * DAY),
      exif: {
        Make: pick(['Canon', 'Nikon', 'Sony', 'Fujifilm']),
        Model: pick(['EOS R5', 'Z6 II', 'A7 IV', 'X-T5']),
        FNumber: pick([1.8, 2.8, 4, 5.6, 8, 11]),
        ExposureTime: pick(['1/125', '1/250', '1/500', '1/1000', '2s']),
        ISO: pick([100, 200, 400, 800]),
        FocalLength: pick([24, 35, 50, 85, 200]),
      },
      imageKey: `photos/${author.id}/${i + 1}/display.webp`,
      thumbKey: `photos/${author.id}/${i + 1}/thumb.webp`,
      width: w,
      height: h,
      blurhash: null,
      license: 'all_rights_reserved',
      credit: '示例素材',
      status: 'published',
      likeCount: 0,
      favoriteCount: 0,
      commentCount: 0,
      viewCount: Math.floor(rand() * 500),
      publishedAt: iso(publishedAt),
      createdAt: iso(publishedAt),
      updatedAt: iso(publishedAt),
      deletedAt: null,
      featuredAt,
    }
  })

  // 300 条互动，分布最近 5 周（覆盖多个周窗口，供榜单测试）
  //
  // 两个必须注意的点（都由 E2E 发现）：
  //   1) 互动不能完全随机撒在 35 天里 —— 那样落在「本周窗口」的只有寥寥几条，
  //      分散到 80 个作品后绝大多数得分为 0，排行榜看起来像坏了。
  //      因此按 60% 集中在最近 7 天、40% 散布到前 4 周。
  //   2) likes/favorites 的主键是 (userId, photoId)，**同一用户对同一作品只能有一行**。
  //      早先是纯随机组合，导致生成 300 条但实际只存入 267 条（重复被 IDB 覆盖），
  //      而 likeCount 却按去重前的数组统计 —— 计数虚高，点赞后重算反而"变小"，
  //      表现为"点了赞数字不动"。所以这里用组合键去重，保证数量与计数一致。
  const usedKeys = new Set<string>()
  const likes: Interaction[] = []
  const favorites: Interaction[] = []

  let guard = 0
  while (likes.length + favorites.length < 300 && guard++ < 10000) {
    const photo = pick(photos)
    const user = pick(profiles)

    // 自赞自藏允许存在（真实数据如此），榜单计算会排除
    const recent = rand() < 0.6
    const t = recent
      ? now - Math.floor(rand() * 6.5 * DAY) // 本周内（0–6.5 天）
      : now - 7 * DAY - Math.floor(rand() * 28 * DAY) // 前 4 周

    const key = `${user.id}|${photo.id}`
    if (usedKeys.has(key)) continue // 同一用户对同一作品只允许一次互动
    usedKeys.add(key)

    const it: Interaction = { userId: user.id, photoId: photo.id, createdAt: iso(t) }
    if (rand() < 0.6) likes.push(it)
    else favorites.push(it)
  }

  // 回填 photos 的派生计数（只读派生原则：由互动行计算）
  // 因为上面已保证 (userId, photoId) 唯一，这里的计数与数据库实际行数完全一致
  const likeMap = new Map<string, number>()
  const favMap = new Map<string, number>()
  for (const l of likes) likeMap.set(l.photoId, (likeMap.get(l.photoId) ?? 0) + 1)
  for (const f of favorites) favMap.set(f.photoId, (favMap.get(f.photoId) ?? 0) + 1)
  for (const p of photos) {
    p.likeCount = likeMap.get(p.id) ?? 0
    p.favoriteCount = favMap.get(p.id) ?? 0
  }

  const comments: Comment[] = [
    {
      id: 'seed-comment-1',
      photoId: photos[0]!.id,
      authorId: profiles[1]!.id,
      parentId: null,
      body: '这张的光影太棒了，能问下机位吗？',
      status: 'visible',
      createdAt: iso(now - 2 * DAY),
      updatedAt: iso(now - 2 * DAY),
      deletedAt: null,
    },
    {
      id: 'seed-comment-2',
      photoId: photos[0]!.id,
      authorId: profiles[0]!.id,
      parentId: 'seed-comment-1',
      body: '谢谢！机位在观景台东侧，日出前半小时到。',
      status: 'visible',
      createdAt: iso(now - 2 * DAY + 3600_000),
      updatedAt: iso(now - 2 * DAY + 3600_000),
      deletedAt: null,
    },
    {
      id: 'seed-comment-3',
      photoId: photos[1]!.id,
      authorId: profiles[2]!.id,
      parentId: null,
      body: '城市森林的压迫感拍出来了。',
      status: 'visible',
      createdAt: iso(now - 1 * DAY),
      updatedAt: iso(now - 1 * DAY),
      deletedAt: null,
    },
  ]
  for (const p of photos) {
    p.commentCount = comments.filter((c) => c.photoId === p.id).length
  }

  // 12 篇文章骨架（S7 填充正文）
  const articles: Article[] = ARTICLE_TOPICS.flatMap((topic, ti) =>
    Array.from({ length: 3 }, (_, ai) => {
      const idx = ti * 3 + ai + 1
      const t = now - (90 - idx * 7) * DAY
      return {
        id: `seed-article-${idx}`,
        slug: `${topic.slug}-${ai + 1}`,
        topicSlug: topic.slug,
        title: `${topic.name}入门 · 第 ${ai + 1} 讲`,
        summary: '正文将在 S7 阶段填充。',
        bodyMd: `# ${topic.name} · 第 ${ai + 1} 讲\n\n> 正文将在 S7 阶段填充。`,
        coverKey: null,
        authorId: profiles[2]!.id,
        difficulty: ai === 0 ? 'beginner' : ai === 1 ? 'intermediate' : 'advanced',
        readingMinutes: 5 + ai * 3,
        tags: [topic.name],
        equipment: [],
        relatedPhotoIds: [],
        status: 'published',
        publishedAt: iso(t),
        updatedAt: iso(t),
        version: 1,
      }
    }),
  )

  // ===== 二期：关注关系 =====
  //
  // 用「i 关注 i+1 / i+2 / i+3」的环形规则，而不是随机取对：
  //   1) 不需要消耗 rand() —— 上面 photos/interactions 的随机序列完全不变，
  //      已有 E2E 依赖的种子数据（作品标题、点赞数）一个字节都不会动；
  //   2) 每个用户都被 3 个人关注、也关注 3 个人，demo 账号首屏不会是「0 粉丝」的尴尬状态。
  // 再给前 5 个用户各加一条外环关注，让计数互不相同（便于肉眼核对不是写死的常量）。
  const follows: Follow[] = []
  const followKeys = new Set<string>()
  const addFollow = (followerId: string, followingId: string, t: number) => {
    if (followerId === followingId) return
    const key = `${followerId}|${followingId}`
    if (followKeys.has(key)) return
    followKeys.add(key)
    follows.push({ followerId, followingId, createdAt: iso(t) })
  }
  const total = profiles.length
  for (let i = 0; i < total; i++) {
    for (let step = 1; step <= 3; step++) {
      addFollow(profiles[i]!.id, profiles[(i + step) % total]!.id, now - (i * 3 + step) * DAY)
    }
    if (i < 5) addFollow(profiles[i]!.id, profiles[(i + 6) % total]!.id, now - (i + 1) * DAY)
  }

  // ===== 二期：站内通知 =====
  //
  // 只给三个 demo 账号（alice / bob / editor）播种：能登录的账号才有通知页可看，
  // 给其余 7 个用户造数据只是白占空间。
  // 时间粒度用小时而不是天 —— 通知列表按时间倒序，同一天的几条要能排出稳定顺序。
  const photosByAuthor = new Map<string, Photo[]>()
  for (const p of photos) {
    const list = photosByAuthor.get(p.authorId)
    if (list) list.push(p)
    else photosByAuthor.set(p.authorId, [p])
  }
  const commentIdOnPhoto = (photoId: string): string | null =>
    comments.find((c) => c.photoId === photoId && c.status === 'visible')?.id ?? null

  const notifications: NotificationRow[] = []
  const NOTIFY_KINDS: NotificationKind[] = ['like', 'comment', 'follow', 'like', 'comment', 'system']
  profiles.slice(0, DEMO_ACCOUNTS.length).forEach((owner, oi) => {
    const own = (photosByAuthor.get(owner.id) ?? []).slice(0, NOTIFY_KINDS.length)
    if (own.length === 0) return
    const others = profiles.filter((p) => p.id !== owner.id)
    NOTIFY_KINDS.forEach((kind, ki) => {
      const photo = own[ki % own.length]!
      const actor = kind === 'system' ? null : others[(oi * 3 + ki) % others.length]!
      const createdAt = iso(now - (ki * 5 + 1) * 3600_000)
      const isPhotoKind = kind === 'like' || kind === 'comment'
      const notification: AppNotification = {
        id: `seed-notify-${owner.id}-${ki + 1}`,
        kind,
        actor,
        photoId: isPhotoKind ? photo.id : null,
        commentId: kind === 'comment' ? commentIdOnPhoto(photo.id) : null,
        // 最新的 3 条留未读：首次登录就能看到铃铛红点，点进去又能看到「未读」标记
        readAt: ki < 3 ? null : iso(now - (ki * 5 + 1) * 3600_000 + 3600_000),
        createdAt,
      }
      notifications.push({ ...notification, userId: owner.id })
    })
  })

  // ===== 8.2 治理：举报 / 处罚 / 申诉 / 审计 =====
  // 单独一个模块生成：内容只引用上面已经算好的 profiles/photos/comments，
  // 且全程不碰 rand()，所以不会影响前面任何一条种子值。
  const moderation = buildModerationSeed(profiles, photos, comments, now)

  return { profiles, photos, likes, favorites, comments, articles, follows, notifications, ...moderation }
}

export const SEED_PASSWORD = DEMO_PASSWORD
