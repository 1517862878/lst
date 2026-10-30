/**
 * Mock 每周主题与活动仓储（8.4d）。
 *
 * 行为与 api 实现对齐（同一份契约，见 src/data/api/themes.ts）：
 *   · 三档公开列表互不重叠（进行中 / 即将开始 / 往期），草稿不在其中；
 *   · 只有 status='active' 且 now ∈ [startsAt, endsAt) 才能投稿与撤回；
 *   · 每人每主题最多 3 件（超出 LIMIT_EXCEEDED），重复投稿 CONFLICT；
 *   · 已入选的作品作者撤不回（FORBIDDEN），编辑取消精选不发通知；
 *   · 精选会给作者写一条 kind='system' + meta.type='theme_selected' 的通知
 *     （与 mock/social.ts 的通知同一张表，通知中心里能直接看到）。
 *
 * 落在 localStorage 而不是 IndexedDB：主题与投稿是「新表」，加进 IndexedDB 要升
 * schema 版本、写迁移、还要处理老库升级回滚（与 mock/repositories/collections.ts
 * 同一取舍）。投稿的**派生字段**（标题、作者名、缩略图）在读时从 IndexedDB 的
 * photos/profiles 联出来，不在本地存副本 —— 存了就会在作者改名/作品下架后失真。
 */
import {
  AppError,
  ErrorCodes,
  type ThemeEntryPage,
  type ThemeInput,
  type ThemeListFilter,
  type ThemeRepository,
  type ThemeSelectResult,
  type ThemeSubmitResult,
  type ThemeWriteResult,
} from '@/data/contracts'
import {
  MAX_ENTRIES_PER_AUTHOR,
  THEME_DESCRIPTION_MAX,
  THEME_ENTRY_NOTE_MAX,
  THEME_RESULT_NOTE_MAX,
  THEME_RULES_MAX,
  THEME_TITLE_MAX,
  isThemeOpen,
  sortThemesByStartDesc,
  themeBucket,
  validateThemeDraft,
  type ThemeDraft,
} from '@/domain/themes'
import type {
  IsoDate,
  MyThemeEntry,
  Photo,
  Profile,
  ThemeDetail,
  ThemeEntry,
  ThemeStatus,
  ThemeSummary,
} from '@/domain/types'
import { bumpDataVersion, getDb, type NotificationRow } from '../db'
import { mockAuthRepository } from './auth'

const THEMES_KEY = 'gy:themes'

/** 详情页投稿网格每页条数（与后端默认值一致；服务端会夹取到 1–48） */
const DEFAULT_PAGE_SIZE = 24

interface StoredTheme {
  id: string
  slug: string
  title: string
  description: string
  rules: string
  status: ThemeStatus
  startsAt: IsoDate
  endsAt: IsoDate
  coverPhotoId: string | null
  resultNote: string
  createdBy: string
  createdAt: IsoDate
  updatedAt: IsoDate
}

interface StoredEntry {
  themeId: string
  photoId: string
  submittedBy: string
  submittedAt: IsoDate
  isSelected: boolean
  selectedAt: IsoDate | null
  selectedBy: string | null
  note: string
}

interface Store {
  themes: StoredTheme[]
  entries: StoredEntry[]
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(THEMES_KEY)
    if (!raw) return { themes: [], entries: [] }
    const parsed = JSON.parse(raw) as Partial<Store>
    return {
      themes: Array.isArray(parsed.themes) ? parsed.themes : [],
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    }
  } catch {
    return { themes: [], entries: [] }
  }
}

function writeStore(store: Store): void {
  localStorage.setItem(THEMES_KEY, JSON.stringify(store))
}

/**
 * 清空本地主题库（单测用）。
 *
 * 写一个**空库**而不是删 key：删掉之后下一次读取会重新补种子数据，
 * 单测里就会出现「刚清干净又冒出三个演示主题」的怪现象。
 */
export function resetMockThemes(): void {
  writeStore({ themes: [], entries: [] })
}

async function requireSession() {
  const session = await mockAuthRepository.getSession()
  if (!session) throw new AppError(ErrorCodes.UNAUTHORIZED, '请先登录')
  return session
}

async function requireStaff() {
  const session = await requireSession()
  if (session.role !== 'editor' && session.role !== 'admin') {
    throw new AppError(ErrorCodes.FORBIDDEN, '需要编辑或管理员权限')
  }
  return session
}

async function loadPhotos(): Promise<Photo[]> {
  const db = await getDb()
  return db.getAll('photos')
}

async function loadProfiles(): Promise<Profile[]> {
  const db = await getDb()
  return db.getAll('profiles')
}

/** 投稿只认「已发布且未删除」的作品（与 api_list_theme_entries 的过滤一致） */
function isLivePhoto(photo: Photo | undefined): photo is Photo {
  return Boolean(photo && photo.status === 'published' && !photo.deletedAt)
}

function requireTheme(store: Store, slug: string): StoredTheme {
  const theme = store.themes.find((item) => item.slug === slug)
  if (!theme) throw new AppError(ErrorCodes.NOT_FOUND, '这个主题不存在或还没公开')
  return theme
}

function summarize(theme: StoredTheme, store: Store, photos: Map<string, Photo>): ThemeSummary {
  const rows = store.entries.filter(
    (entry) => entry.themeId === theme.id && isLivePhoto(photos.get(entry.photoId)),
  )
  return {
    id: theme.id,
    slug: theme.slug,
    title: theme.title,
    description: theme.description,
    status: theme.status,
    startsAt: theme.startsAt,
    endsAt: theme.endsAt,
    coverPhotoId: theme.coverPhotoId,
    entryCount: rows.length,
    selectedCount: rows.filter((entry) => entry.isSelected).length,
  }
}

function isStaff(session: { role: string } | null): boolean {
  return session?.role === 'editor' || session?.role === 'admin'
}

/**
 * 首次使用时给一个可演示的初始状态：一期已结束的主题（含精选与结果说明）+ 一期
 * 正在征集的主题。
 *
 * 只造一期 active：数据库用部分唯一索引保证「同一时刻最多一个 active」，
 * 「即将开始」是这一期还在未来时的那一档，不是另一行。
 * key 存在（哪怕内容是空库）就不再补种，否则人工清库/单测重置都会被覆盖。
 */
async function ensureSeed(): Promise<void> {
  if (localStorage.getItem(THEMES_KEY) !== null) return
  const photos = (await loadPhotos()).filter((photo) => isLivePhoto(photo))
  const day = 24 * 60 * 60 * 1000
  const base = Date.now()
  const at = (offsetDays: number) => new Date(base + offsetDays * day).toISOString()

  const past: StoredTheme = {
    id: 'mock-theme-past-city-night',
    slug: 'city-night',
    title: '城市夜色',
    description: '霓虹、雨夜与末班车：把城市入夜后的样子拍下来。',
    rules: '1. 一人最多投稿 3 件\n2. 需为本人原创拍摄\n3. 后期不限，但请保留画面真实感',
    status: 'closed',
    startsAt: at(-24),
    endsAt: at(-10),
    coverPhotoId: photos[0]?.id ?? null,
    resultNote: '本期共收到 12 件投稿，编辑部选出了 3 件作品收录进「夜色」专题。',
    createdBy: 'mock-editor',
    createdAt: at(-26),
    updatedAt: at(-10),
  }

  const active: StoredTheme = {
    id: 'mock-theme-active-autumn-light',
    slug: 'autumn-light',
    title: '秋日光线',
    description: '秋天的侧逆光、长影子与低饱和色调。',
    rules: '1. 一人最多投稿 3 件\n2. 需为本人原创拍摄\n3. 拍摄地点不限，欢迎写明坐标',
    status: 'active',
    startsAt: at(-3),
    endsAt: at(5),
    coverPhotoId: null,
    resultNote: '',
    createdBy: 'mock-editor',
    createdAt: at(-6),
    updatedAt: at(-3),
  }

  // 投稿从现有作品里挑：没有作品时主题照建，只是空着（演示库不该凭空造作品）
  const entries: StoredEntry[] = []
  const pick = (theme: StoredTheme, offset: number, count: number, selected: number) => {
    const chosen = photos.slice(offset, offset + count)
    chosen.forEach((photo, index) => {
      const isSelected = index < selected
      entries.push({
        themeId: theme.id,
        photoId: photo.id,
        submittedBy: photo.authorId,
        submittedAt: at(-20 + index),
        isSelected,
        selectedAt: isSelected ? at(-11) : null,
        selectedBy: isSelected ? 'mock-editor' : null,
        note: isSelected ? '构图稳，光线层次好，入选本期专题。' : '',
      })
    })
  }
  if (photos.length > 0) {
    pick(past, 0, Math.min(4, photos.length), Math.min(2, photos.length))
    if (photos.length > 4) pick(active, 4, Math.min(3, photos.length - 4), 0)
    else pick(active, 0, Math.min(2, photos.length), 0)
    if (!past.coverPhotoId && entries[0]) past.coverPhotoId = entries[0].photoId
  }

  writeStore({ themes: [past, active], entries })
}

/** 把存储行 + 联表信息投影成契约里的 ThemeEntry */
function toEntry(
  row: StoredEntry,
  photo: Photo,
  author: Profile | undefined,
): ThemeEntry {
  const username = author?.username ?? photo.authorUsername ?? ''
  return {
    photoId: row.photoId,
    isSelected: row.isSelected,
    note: row.note,
    selectedAt: row.selectedAt,
    submittedAt: row.submittedAt,
    title: photo.title,
    authorId: photo.authorId,
    authorUsername: username,
    authorDisplayName: author?.displayName ?? username,
    imageKey: photo.imageKey,
    thumbKey: photo.thumbKey,
    likeCount: photo.likeCount,
    favoriteCount: photo.favoriteCount,
  }
}

/**
 * 投稿排序：精选在前 → 精选内部按入选时间升序（先选的在前）→ 其余按投稿时间倒序。
 * 用字符串比较而非 localeCompare：ISO 8601 的字典序就是时间序，见 domain/themes.ts。
 */
function compareEntries(a: StoredEntry, b: StoredEntry): number {
  if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1
  if (a.isSelected) {
    const left = a.selectedAt ?? ''
    const right = b.selectedAt ?? ''
    if (left !== right) {
      if (!left) return 1
      if (!right) return -1
      return left < right ? -1 : 1
    }
  }
  if (a.submittedAt !== b.submittedAt) return a.submittedAt < b.submittedAt ? 1 : -1
  return 0
}

function assertWindow(startsAt: string, endsAt: string): void {
  const start = new Date(startsAt).getTime()
  const end = new Date(endsAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new AppError(ErrorCodes.VALIDATION, '开始/结束时间格式不正确')
  }
  if (end <= start) throw new AppError(ErrorCodes.VALIDATION, '结束时间必须晚于开始时间')
}

export const mockThemeRepository: ThemeRepository = {
  async list(status: ThemeListFilter): Promise<ThemeSummary[]> {
    await ensureSeed()
    const store = readStore()
    const photos = new Map((await loadPhotos()).map((photo) => [photo.id, photo]))
    const now = new Date()
    return sortThemesByStartDesc(
      store.themes.filter((theme) => themeBucket(theme, now) === status),
    ).map((theme) => summarize(theme, store, photos))
  },

  async get(slug: string): Promise<ThemeDetail> {
    await ensureSeed()
    const store = readStore()
    const theme = requireTheme(store, slug)
    const session = await mockAuthRepository.getSession()
    // 草稿对非编辑一律「不存在」：不泄露「有这么一期还没公开」
    if (theme.status === 'draft' && !isStaff(session)) {
      throw new AppError(ErrorCodes.NOT_FOUND, '这个主题不存在或还没公开')
    }
    const photos = new Map((await loadPhotos()).map((photo) => [photo.id, photo]))
    return {
      ...summarize(theme, store, photos),
      rules: theme.rules,
      resultNote: theme.resultNote,
      isOpen: isThemeOpen(theme),
    }
  },

  async listEntries(slug: string, query): Promise<ThemeEntryPage> {
    await ensureSeed()
    const store = readStore()
    const theme = requireTheme(store, slug)
    const photos = new Map((await loadPhotos()).map((photo) => [photo.id, photo]))
    const profiles = new Map((await loadProfiles()).map((profile) => [profile.id, profile]))

    const rows = store.entries
      .filter((entry) => entry.themeId === theme.id)
      .filter((entry) => isLivePhoto(photos.get(entry.photoId)))
      .filter((entry) => (query?.selectedOnly ? entry.isSelected : true))
      .sort(compareEntries)

    const limit = Math.min(48, Math.max(1, Math.floor(query?.limit ?? DEFAULT_PAGE_SIZE)))
    const offset = Math.max(0, Math.floor(query?.offset ?? 0))
    const page = rows.slice(offset, offset + limit)
    const nextOffset = offset + limit < rows.length ? offset + limit : null
    return {
      items: page.map((row) => toEntry(row, photos.get(row.photoId) as Photo, profiles.get(row.submittedBy))),
      total: rows.length,
      nextOffset,
    }
  },

  async myEntries(slug: string): Promise<MyThemeEntry[]> {
    const session = await requireSession()
    await ensureSeed()
    const store = readStore()
    const theme = requireTheme(store, slug)
    const photos = new Map((await loadPhotos()).map((photo) => [photo.id, photo]))
    return store.entries
      .filter((entry) => entry.themeId === theme.id && entry.submittedBy === session.userId)
      .filter((entry) => isLivePhoto(photos.get(entry.photoId)))
      .sort(compareEntries)
      .map((entry) => ({
        photoId: entry.photoId,
        title: photos.get(entry.photoId)?.title ?? '',
        isSelected: entry.isSelected,
        note: entry.note,
        submittedAt: entry.submittedAt,
      }))
  },

  async submitEntry(slug: string, photoId: string): Promise<ThemeSubmitResult> {
    const session = await requireSession()
    await ensureSeed()
    const store = readStore()
    const theme = requireTheme(store, slug)
    if (!isThemeOpen(theme)) {
      throw new AppError(ErrorCodes.FORBIDDEN, '这个主题当前不在投稿期内')
    }
    const photo = (await loadPhotos()).find((item) => item.id === photoId)
    if (!photo || photo.deletedAt) throw new AppError(ErrorCodes.NOT_FOUND, '这件作品不存在')
    if (photo.authorId !== session.userId) {
      throw new AppError(ErrorCodes.FORBIDDEN, '只能投稿自己的作品')
    }
    if (photo.status !== 'published') {
      throw new AppError(ErrorCodes.VALIDATION, '只有已发布的作品可以投稿')
    }
    if (store.entries.some((entry) => entry.themeId === theme.id && entry.photoId === photoId)) {
      throw new AppError(ErrorCodes.CONFLICT, '这件作品已经在主题里了')
    }
    const mine = store.entries.filter(
      (entry) => entry.themeId === theme.id && entry.submittedBy === session.userId,
    )
    if (mine.length >= MAX_ENTRIES_PER_AUTHOR) {
      throw new AppError(
        ErrorCodes.LIMIT_EXCEEDED,
        `每个主题最多投稿 ${MAX_ENTRIES_PER_AUTHOR} 件作品`,
      )
    }
    const submittedAt = new Date().toISOString()
    store.entries.push({
      themeId: theme.id,
      photoId,
      submittedBy: session.userId,
      submittedAt,
      isSelected: false,
      selectedAt: null,
      selectedBy: null,
      note: '',
    })
    writeStore(store)
    return {
      photoId,
      submittedAt,
      entryCount: store.entries.filter((entry) => entry.themeId === theme.id).length,
    }
  },

  async withdrawEntry(slug: string, photoId: string): Promise<void> {
    const session = await requireSession()
    await ensureSeed()
    const store = readStore()
    const theme = requireTheme(store, slug)
    const index = store.entries.findIndex(
      (entry) => entry.themeId === theme.id && entry.photoId === photoId,
    )
    if (index < 0) throw new AppError(ErrorCodes.NOT_FOUND, '这件作品不在主题里')
    const entry = store.entries[index] as StoredEntry
    if (entry.submittedBy !== session.userId) {
      throw new AppError(ErrorCodes.FORBIDDEN, '只有投稿人可以撤回')
    }
    if (entry.isSelected) {
      throw new AppError(ErrorCodes.FORBIDDEN, '已入选的作品不能撤回，请联系编辑')
    }
    if (!isThemeOpen(theme)) {
      throw new AppError(ErrorCodes.FORBIDDEN, '主题已结束，不能再撤回投稿')
    }
    store.entries.splice(index, 1)
    writeStore(store)
  },

  async createTheme(input: ThemeInput): Promise<ThemeWriteResult> {
    const staff = await requireStaff()
    await ensureSeed()
    const store = readStore()
    const slug = input.slug.trim()
    const status = input.status ?? 'draft'
    const draft: ThemeDraft = {
      slug,
      title: input.title.trim(),
      description: input.description ?? '',
      rules: input.rules ?? '',
      status,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      resultNote: input.resultNote ?? '',
    }
    const errors = validateThemeDraft(draft)
    if (errors.length > 0) throw new AppError(ErrorCodes.VALIDATION, errors[0] as string)
    if (store.themes.some((theme) => theme.slug === slug)) {
      throw new AppError(ErrorCodes.CONFLICT, '这个 slug 已经被占用了')
    }
    if (status === 'active' && store.themes.some((theme) => theme.status === 'active')) {
      throw new AppError(ErrorCodes.CONFLICT, '已有一个进行中的主题')
    }
    if (input.coverPhotoId) {
      // 新主题此刻还没有投稿，封面不可能合法
      throw new AppError(ErrorCodes.VALIDATION, '封面必须是该主题的投稿作品')
    }
    const now = new Date().toISOString()
    const theme: StoredTheme = {
      id: `mock-theme-${crypto.randomUUID()}`,
      ...draft,
      coverPhotoId: null,
      createdBy: staff.userId,
      createdAt: now,
      updatedAt: now,
    }
    store.themes.push(theme)
    writeStore(store)
    return { id: theme.id, slug: theme.slug, status: theme.status }
  },

  async updateTheme(id: string, patch: Partial<ThemeInput>): Promise<ThemeWriteResult> {
    await requireStaff()
    await ensureSeed()
    const store = readStore()
    const theme = store.themes.find((item) => item.id === id)
    if (!theme) throw new AppError(ErrorCodes.NOT_FOUND, '这个主题不存在')
    if (patch.slug !== undefined && patch.slug.trim() !== theme.slug) {
      throw new AppError(ErrorCodes.VALIDATION, 'slug 创建后不能修改')
    }
    const next: StoredTheme = {
      ...theme,
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.rules !== undefined ? { rules: patch.rules } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.startsAt !== undefined ? { startsAt: patch.startsAt } : {}),
      ...(patch.endsAt !== undefined ? { endsAt: patch.endsAt } : {}),
      ...(patch.resultNote !== undefined ? { resultNote: patch.resultNote } : {}),
      ...(patch.coverPhotoId !== undefined ? { coverPhotoId: patch.coverPhotoId } : {}),
      updatedAt: new Date().toISOString(),
    }
    assertWindow(next.startsAt, next.endsAt)
    if (
      next.description.length > THEME_DESCRIPTION_MAX ||
      next.rules.length > THEME_RULES_MAX ||
      next.resultNote.length > THEME_RESULT_NOTE_MAX ||
      next.title.length > THEME_TITLE_MAX
    ) {
      throw new AppError(ErrorCodes.VALIDATION, '标题/简介/规则/结果说明超出字数上限')
    }
    if (next.status === 'active') {
      const other = store.themes.find((item) => item.id !== theme.id && item.status === 'active')
      if (other) throw new AppError(ErrorCodes.CONFLICT, '已有一个进行中的主题')
    }
    if (next.coverPhotoId) {
      const isEntry = store.entries.some(
        (entry) => entry.themeId === theme.id && entry.photoId === next.coverPhotoId,
      )
      if (!isEntry) throw new AppError(ErrorCodes.VALIDATION, '封面必须是该主题的投稿作品')
    }
    const index = store.themes.findIndex((item) => item.id === id)
    store.themes[index] = next
    writeStore(store)
    return { id: next.id, slug: next.slug, status: next.status }
  },

  async selectEntry(slug, photoId, input): Promise<ThemeSelectResult> {
    const staff = await requireStaff()
    await ensureSeed()
    const store = readStore()
    const theme = requireTheme(store, slug)
    const entry = store.entries.find(
      (item) => item.themeId === theme.id && item.photoId === photoId,
    )
    if (!entry) throw new AppError(ErrorCodes.NOT_FOUND, '这件作品不在主题里')
    const note = input.note ?? entry.note
    if (note.length > THEME_ENTRY_NOTE_MAX) {
      throw new AppError(ErrorCodes.VALIDATION, `评语最多 ${THEME_ENTRY_NOTE_MAX} 个字`)
    }
    // 只有「未选中 → 选中」才通知：改评语、重复点选都不该给作者再发一条
    const notify = input.selected && !entry.isSelected
    const now = new Date().toISOString()
    entry.isSelected = input.selected
    entry.note = note
    entry.selectedAt = input.selected ? (entry.selectedAt ?? now) : null
    entry.selectedBy = input.selected ? staff.userId : null
    writeStore(store)

    if (notify) {
      const db = await getDb()
      const photo = await db.get('photos', photoId)
      const notification: NotificationRow = {
        // 固定 id：同一次精选重复触发不会堆出多条通知（put 覆盖），
        // 也让「取消后重新精选」在通知中心里保持一条。
        id: `mock-notify-theme-${theme.id}-${photoId}`,
        userId: entry.submittedBy,
        kind: 'system',
        actor: null,
        photoId,
        commentId: null,
        readAt: null,
        createdAt: now,
        photoTitle: photo?.title ?? null,
        photoThumbKey: photo?.thumbKey ?? null,
        meta: { kind: 'theme_selected', themeSlug: theme.slug, themeTitle: theme.title },
      }
      await db.put('notifications', notification)
      await bumpDataVersion()
    }

    const selectedCount = store.entries.filter(
      (item) => item.themeId === theme.id && item.isSelected,
    ).length
    return { isSelected: entry.isSelected, selectedCount }
  },

  async adminList(): Promise<ThemeSummary[]> {
    await requireStaff()
    await ensureSeed()
    const store = readStore()
    const photos = new Map((await loadPhotos()).map((photo) => [photo.id, photo]))
    return sortThemesByStartDesc(store.themes).map((theme) => summarize(theme, store, photos))
  },
}
