/**
 * seed 初始化：首次访问把演示数据写入 IndexedDB（幂等，只跑一次）。
 * 调用方：main.tsx 启动时 ensureSeeded()（ROADMAP §5.2）。
 */
import { ARTICLE_TOPICS, CATEGORIES } from '@/domain/constants'
import { getDb, getMeta, setMeta } from './db'
import { buildSeedData } from './seed'

/**
 * 是否播种「80 件示例作品」。
 *
 * 默认值按构建环境分：
 *   · 生产构建（线上演示站）→ **关闭**。这 80 件作品没有真实图片文件，
 *     页面上是渐变色占位块；访客会把它们误认成站点自带的图，也分不清
 *     哪些是真实用户上传的。演示账号仍然播种，登录演示不受影响。
 *   · 开发 / 测试（vitest、Playwright、pnpm dev）→ 开启，
 *     E2E 的 13 个套件与「80 条确定性作品」断言全部依赖它。
 *
 * 想在生产构建里也保留示例作品：VITE_SEED_DEMO_PHOTOS=1 重新构建即可；
 * 反之在本地关掉：VITE_SEED_DEMO_PHOTOS=0。
 */
const SEED_DEMO_PHOTOS = parseSeedFlag(import.meta.env.VITE_SEED_DEMO_PHOTOS, import.meta.env.PROD)

function parseSeedFlag(raw: string | undefined, isProd: boolean): boolean {
  const flag = (raw ?? '').trim().toLowerCase()
  if (flag === '1' || flag === 'true') return true
  if (flag === '0' || flag === 'false') return false
  return !isProd
}

/**
 * 数据切片版本。
 *
 * 为什么不能只看 seededAt：老用户库里已经有 seededAt，直接 return 的话，
 * 二期新增的 follows / notifications 两张表永远是空的 ——
 * 表现为「升级后所有人都没有粉丝、也没有通知」，看起来像功能没做。
 * 所以再加一个切片号：老库带着旧切片号进来时，只补播新切片（社交关系），
 * 不动用户已有的作品/互动数据。
 *
 * 切片 3：8.2 治理（reports / sanctions / appeals / moderationActions）。
 * 同样只补播这四张表，不碰作品与互动。
 *
 * 切片 4：8.3d 通知语义（每条通知补 meta：回复 / 周榜）。老库里的通知是
 * 没有 meta 的旧剧本，重播一遍通知表即可（id 确定，put 覆盖；会把这 7 条
 * 的已读状态重置回种子值 —— 演示数据本来就是给人随手点的，可以接受）。
 *
 * 切片 5：2026-11 分类体系换代（题材 → 风格）。
 * 这一片与前面几片有本质区别 —— 它**必须改已有数据**，不能只是补播：
 *   · categories 表里躺着 8 个旧题材分类（风景/人文/…/黑白），
 *     而 mockCategoryRepository.list() 优先读库，读到旧行就永远显示旧分类；
 *   · photos.categorySlug 也还指向旧 slug，不迁移就会挂在已下架的分类上
 *     （后端那套外键约束在 mock 侧没有，所以不会报错，只会静默错乱）。
 * 所以这片做三件事：删旧分类行、写入新分类行、按语义映射改写作品的分类。
 * 旧→新映射与迁移 0038 逐条一致，保证 mock 与真实 API 行为同构。
 *
 * 切片 6：2026-11 停止播种示例作品（VITE_SEED_DEMO_PHOTOS 关闭时）。
 * 又一片「必须删已有数据」的切片：老访客的库里已经躺着 80 件示例作品，
 * 只是停止新增的话，他们刷新多少次都还能看到这些占位图。所以这一片做两件事：
 *   1) 删掉 seed-photo-NNN 及其派生数据（互动 / 评论 / 通知 / 组照 / 排名条目）；
 *   2) 清掉指向这些作品的引用（主题投稿与封面、收藏夹成员）。
 * **只删 seed 自己的确定性 id**（seed-photo-/seed-user-），绝不按「看起来像示例」
 * 猜 —— 用户自己上传的作品可能刚好叫这个名字，删错就是数据丢失。
 *
 * 切片 7：2026-11 学习板块改为「作者自行上传」，不再预置 12 篇虚拟教程。
 * 这一片同样是「必须删已有数据」：老浏览器里躺着 seed-article-01…12，
 * 不删的话学习板块永远显示那 12 篇正文为空的骨架。
 */
const SEED_SLICE = 7

/**
 * 旧分类 slug → 新分类 slug（与 supabase/migrations/0038 的映射表逐条一致）。
 *
 * 一致性为什么重要：mock 与 api 两种数据源要能互相替换，
 * 同一件作品在两种模式下不能落进不同风格的分类里。
 */
const CATEGORY_SLUG_MIGRATION: Record<string, string> = {
  landscape: 'travel-doc',
  people: 'travel-doc',
  architecture: 'cinematic-dark',
  industrial: 'cinematic-dark',
  technology: 'new-chinese',
  macro: 'japanese-soft',
  night: 'hk-retro',
  monochrome: 'cinematic-dark',
}

let seeding: Promise<void> | null = null

export async function ensureSeeded(): Promise<void> {
  if (seeding) return seeding
  seeding = (async () => {
    const seededAt = await getMeta<string>('seededAt')
    const slice = await getMeta<number>('seedSlice')
    const db = await getDb()

    if (!seededAt) {
      const seed = buildSeedData({ includeDemoPhotos: SEED_DEMO_PHOTOS })

      const tx = db.transaction(
        [
          'profiles',
          'photos',
          'categories',
          'likes',
          'favorites',
          'comments',
          'topics',
          'articles',
          'follows',
          'notifications',
          'reports',
          'sanctions',
          'appeals',
          'moderationActions',
        ],
        'readwrite',
      )
      for (const p of seed.profiles) await tx.objectStore('profiles').put(p)
      for (const p of seed.photos) await tx.objectStore('photos').put(p)
      for (const c of CATEGORIES) await tx.objectStore('categories').put(c)
      for (const l of seed.likes) await tx.objectStore('likes').put(l)
      for (const f of seed.favorites) await tx.objectStore('favorites').put(f)
      for (const c of seed.comments) await tx.objectStore('comments').put(c)
      for (const t of ARTICLE_TOPICS) await tx.objectStore('topics').put(t)
      for (const a of seed.articles) await tx.objectStore('articles').put(a)
      for (const f of seed.follows) await tx.objectStore('follows').put(f)
      for (const n of seed.notifications) await tx.objectStore('notifications').put(n)
      for (const r of seed.reports) await tx.objectStore('reports').put(r)
      for (const s of seed.sanctions) await tx.objectStore('sanctions').put(s)
      for (const a of seed.appeals) await tx.objectStore('appeals').put(a)
      for (const a of seed.moderationActions) await tx.objectStore('moderationActions').put(a)
      await tx.done

      await setMeta('seededAt', new Date().toISOString())
      await setMeta('dataVersion', 1)
      await setMeta('seedSlice', SEED_SLICE)
      return
    }

    // 开关关闭时，先清掉库里残留的示例作品 —— 这一步必须在「切片号已满就提前返回」之前。
    //
    // 为什么要提前：典型场景是「本地开着播种用了一阵，之后用生产构建打开」。
    // 这种浏览器的 seedSlice 早就是 6（首次启动即写入），第 136 行的提前返回会让
    // 后面的切片逻辑全部跳过，清理就永远不会执行了。
    // 所以清理只依赖两件事：开关关闭 + 库里确实还有 seed-photo-NNN（空操作时零成本）。
    // 开关开着时（开发 / E2E）不进这个分支，免得把刚播的种子删了。
    if (!SEED_DEMO_PHOTOS) {
      await removeDemoPhotoSeed()
    }

    // 0039：清掉预置的虚拟教程文章。与作品清理同样的道理 ——
    // 老浏览器的 seedSlice 早已写满，必须放在「提前返回」之前。
    // 只删 seed-article-NN（seed 自己的确定性 id），绝不按「看起来像官方教程」猜。
    await removeSeedArticles()

    if ((slice ?? 1) >= SEED_SLICE) return

    const seed = buildSeedData({ includeDemoPhotos: SEED_DEMO_PHOTOS })

    // 老库补播社交切片：只写 follows / notifications（id 确定，重复跑也安全）
    if ((slice ?? 1) < 2) {
      const tx = db.transaction(['follows', 'notifications'], 'readwrite')
      for (const f of seed.follows) await tx.objectStore('follows').put(f)
      for (const n of seed.notifications) await tx.objectStore('notifications').put(n)
      await tx.done
    }

    // 8.3d 通知切片：通知表带上 meta（回复 / 周榜），只重播通知，不动其它表
    if ((slice ?? 1) < 4) {
      const notifyTx = db.transaction(['notifications'], 'readwrite')
      for (const n of seed.notifications) await notifyTx.objectStore('notifications').put(n)
      await notifyTx.done
    }

    // 8.2 治理切片：四张表全部按确定 id 写入，重复跑只会覆盖同一条演示记录
    const moderationTx = db.transaction(
      ['reports', 'sanctions', 'appeals', 'moderationActions'],
      'readwrite',
    )
    for (const r of seed.reports) await moderationTx.objectStore('reports').put(r)
    for (const s of seed.sanctions) await moderationTx.objectStore('sanctions').put(s)
    for (const a of seed.appeals) await moderationTx.objectStore('appeals').put(a)
    for (const a of seed.moderationActions) {
      await moderationTx.objectStore('moderationActions').put(a)
    }
    await moderationTx.done

    // 切片 5：分类体系换代 —— 删旧分类、写新分类、改写作品分类
    if ((slice ?? 1) < 5) {
      const catTx = db.transaction(['categories', 'photos'], 'readwrite')
      const categories = catTx.objectStore('categories')

      // 1) 删掉旧题材分类（它们在 CATEGORIES 里已不存在）
      const oldSlugs = Object.keys(CATEGORY_SLUG_MIGRATION)
      for (const slug of oldSlugs) await categories.delete(slug)

      // 2) 写入 8 个新风格分类
      for (const c of CATEGORIES) await categories.put(c)

      // 3) 逐件改写作品的分类（只动 categorySlug，其它字段原样保留）
      const photos = catTx.objectStore('photos')
      const all = await photos.getAll()
      let migrated = 0
      for (const photo of all) {
        const next = CATEGORY_SLUG_MIGRATION[photo.categorySlug]
        if (!next) continue
        await photos.put({ ...photo, categorySlug: next, updatedAt: new Date().toISOString() })
        migrated += 1
      }
      await catTx.done
      if (migrated > 0) {
        console.info(`[seed] 分类体系换代：${migrated} 件作品已迁移到风格分类`)
      }
    }

    // 切片 6 的清理已在上面「提前返回」之前完成（见该处注释），这里只保留切片号推进。
    await setMeta('seedSlice', SEED_SLICE)
  })()
  return seeding
}

/**
 * 删除示例作品及其派生数据（切片 6，仅 VITE_SEED_DEMO_PHOTOS 关闭时执行）。
 *
 * 只按 seed 自己的确定性 id 匹配 `seed-photo-NNN`。**不按 credit='示例素材' 匹配** ——
 * 用户完全可能自己署名「示例素材」，按署名删会把真实作品一起删掉。
 *
 * 删完必须清引用，否则老库里会留下指向不存在作品的洞（点开就是 404 / 空白卡）：
 *   · 按 photoId 直接删：likes / favorites / comments / notifications / photoItems / rankEntries；
 *   · 按 seed 自己的 id 删治理演示数据（它们的目标也都是示例作品）；
 *   · localStorage 里的主题投稿与封面（`gy:themes`）、收藏夹成员 —— 把示例作品剔除。
 *
 * 事务边界：上面这些 getAll 都是 idb 的 Promise 形式，同事务内 await 是安全的
 * （idb 会把微任务链保持在事务内），但不能在事务里再发起别的 await 之外的落库写入
 * 之外的操作 —— 所以 localStorage 的处理放在事务**之后**。
 */
/**
 * 删除预置的虚拟教程文章（切片 7）。
 *
 * 只匹配 seed 自己的确定性 id `seed-article-NN`。**不按 slug / 标题 / 作者匹配**：
 * 用户完全可能自己也写一篇叫「拍摄技巧入门 · 第 1 讲」，按标题删就会误删真实文章。
 *
 * 不需要额外清引用：文章不挂别的东西（relatedPhotoIds 只是字符串数组，
 * 指向的作品被删时也不会反过来影响文章本身）。
 */
async function removeSeedArticles(): Promise<void> {
  const db = await getDb()
  const all = await db.getAll('articles')
  const demo = all.filter((a) => SEED_ARTICLE_ID_RE.test(a.id))
  if (demo.length === 0) return
  const tx = db.transaction('articles', 'readwrite')
  for (const article of demo) await tx.objectStore('articles').delete(article.id)
  await tx.done
  console.info(`[seed] 已清理 ${demo.length} 篇预置虚拟教程`)
}

/** seed 预置的虚拟教程 id：seed-article-1 … seed-article-12 */
const SEED_ARTICLE_ID_RE = /^seed-article-\d{1,2}$/

async function removeDemoPhotoSeed(): Promise<void> {
  const db = await getDb()
  const demoIds = new Set(
    (await db.getAll('photos')).filter((p) => DEMO_PHOTO_ID_RE.test(p.id)).map((p) => p.id),
  )
  if (demoIds.size === 0) return

  const tx = db.transaction(
    [
      'photos',
      'likes',
      'favorites',
      'comments',
      'notifications',
      'photoItems',
      'rankEntries',
      'reports',
      'sanctions',
      'appeals',
      'moderationActions',
    ],
    'readwrite',
  )
  const store = <T extends Parameters<typeof tx.objectStore>[0]>(name: T) => tx.objectStore(name)

  // 1) 作品本体
  for (const id of demoIds) await store('photos').delete(id)

  // 2) 按 photoId 关联的派生行：主键形状各不相同，统一「读出来自己判断再按主键删」
  const likes = await store('likes').getAll()
  for (const row of likes) {
    if (demoIds.has(row.photoId)) await store('likes').delete([row.userId, row.photoId])
  }
  const favs = await store('favorites').getAll()
  for (const row of favs) {
    if (demoIds.has(row.photoId)) await store('favorites').delete([row.userId, row.photoId])
  }
  for (const row of await store('comments').getAll()) {
    if (demoIds.has(row.photoId)) await store('comments').delete(row.id)
  }
  for (const row of await store('notifications').getAll()) {
    if (row.photoId && demoIds.has(row.photoId)) await store('notifications').delete(row.id)
  }
  for (const row of await store('photoItems').getAll()) {
    if (demoIds.has(row.photoId)) await store('photoItems').delete([row.photoId, row.position])
  }
  for (const row of await store('rankEntries').getAll()) {
    if (demoIds.has(row.photoId)) await store('rankEntries').delete([row.snapshotId, row.rank])
  }

  // 3) 治理演示数据：目标就是示例作品 / 示例评论，一并清掉
  for (const row of await store('reports').getAll()) {
    if (SEED_MODERATION_ID_RE.test(row.id)) await store('reports').delete(row.id)
  }
  for (const row of await store('sanctions').getAll()) {
    if (SEED_MODERATION_ID_RE.test(row.id)) await store('sanctions').delete(row.id)
  }
  for (const row of await store('appeals').getAll()) {
    if (SEED_MODERATION_ID_RE.test(row.id)) await store('appeals').delete(row.id)
  }
  for (const row of await store('moderationActions').getAll()) {
    if (SEED_MODERATION_ID_RE.test(row.id)) await store('moderationActions').delete(row.id)
  }

  await tx.done

  pruneDemoPhotoRefs(demoIds)
  console.info(`[seed] 已清理 ${demoIds.size} 件示例作品及其派生数据`)
}

/** seed 生成的示例作品 id：seed-photo-001 … seed-photo-NNN */
const DEMO_PHOTO_ID_RE = /^seed-photo-\d{3}$/
/** seed 生成的治理演示 id：seed-report-* / seed-sanction-* / seed-appeal-* / seed-action-* */
const SEED_MODERATION_ID_RE = /^seed-(report|sanction|appeal|action)-/

/**
 * 清掉 localStorage 里指向示例作品的引用。
 *
 * 为什么单独处理：主题与收藏夹都存在 localStorage（不是 IndexedDB），
 * 事务内碰不到它们；而留着「成员已经不存在」的收藏夹/主题，页面上会显示
 * 「3 件作品」却点开一片空白。这里宁可把成员剔干净，也不删用户自建的主题本身。
 */
function pruneDemoPhotoRefs(demoIds: ReadonlySet<string>): void {
  try {
    const themesRaw = localStorage.getItem('gy:themes')
    if (themesRaw) {
      const data = JSON.parse(themesRaw) as {
        themes?: Array<{ coverPhotoId?: string | null }>
        entries?: Array<{ photoId?: string }>
      }
      const entries = (data.entries ?? []).filter((e) => !(e.photoId && demoIds.has(e.photoId)))
      const themes = (data.themes ?? []).map((t) =>
        t.coverPhotoId && demoIds.has(t.coverPhotoId) ? { ...t, coverPhotoId: null } : t,
      )
      localStorage.setItem('gy:themes', JSON.stringify({ ...data, themes, entries }))
    }

    // 收藏夹 store 的 key 随实现而定，逐个键找「带 collections 数组」的那一个，
    // 避免把 key 名写死在这里（写死就会和仓储实现分叉）。
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || key === 'gy:themes' || key === 'gy:session') continue
      const raw = localStorage.getItem(key)
      if (!raw || !raw.includes('photoIds')) continue
      const data = JSON.parse(raw) as { collections?: Array<{ photoIds?: string[] }> }
      if (!Array.isArray(data.collections)) continue
      const collections = data.collections.map((c) => ({
        ...c,
        photoIds: (c.photoIds ?? []).filter((id) => !demoIds.has(id)),
      }))
      localStorage.setItem(key, JSON.stringify({ ...data, collections }))
    }
  } catch (e) {
    // 清理引用失败不该让首屏起不来：留下几条悬空引用，比整站白屏好得多
    console.warn('[seed] 清理示例作品引用失败', e)
  }
}

