/**
 * 演示种子数据（DATA-MODEL §9 / ROADMAP §5）。
 * 规格：10 用户、80 作品、300 互动（likes+favorites）、12 篇文章、8 分类、4 主题。
 * 版权：全部作品 credit='示例素材'；示例图片占位（S3 前无真实图片文件，用纯色 SVG data URL 兜底）。
 */
import type {
  Article,
  Comment,
  Interaction,
  Photo,
  Profile,
} from '@/domain/types'
import { ARTICLE_TOPICS, CATEGORIES, DEMO_ACCOUNTS, DEMO_PASSWORD } from '@/domain/constants'

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

export interface SeedResult {
  profiles: Profile[]
  photos: Photo[]
  likes: Interaction[]
  favorites: Interaction[]
  comments: Comment[]
  articles: Article[]
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
    }
  })

  // 300 条互动，分布最近 5 周（覆盖多个周窗口，供榜单测试）
  const likes: Interaction[] = []
  const favorites: Interaction[] = []
  for (let i = 0; i < 300; i++) {
    const photo = pick(photos)
    const user = pick(profiles)
    // 自赞自藏允许存在（真实数据如此），榜单计算会排除
    const t = now - Math.floor(rand() * 35) * DAY - Math.floor(rand() * DAY)
    const it: Interaction = { userId: user.id, photoId: photo.id, createdAt: iso(t) }
    if (rand() < 0.6) likes.push(it)
    else favorites.push(it)
  }

  // 回填 photos 的派生计数（只读派生原则：由互动行计算）
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

  return { profiles, photos, likes, favorites, comments, articles }
}

export const SEED_PASSWORD = DEMO_PASSWORD
