/**
 * 服务端草稿 + 收藏夹数据访问层（0028）。
 *
 * 约定（与 repositories/social.ts 同构）：
 *   1) publish_drafts / collections / collection_items 三张表对 app_user 完全没有
 *      权限（RLS 打开、零 policy、revoke all），所以这里的每一次读写都只能经 0028
 *      的 SECURITY DEFINER 函数；
 *   2) 调用方必须把 client 放进 withRls(userId, ...) 事务里 —— auth.uid() 读的是
 *      事务级的 app.user_id，事务外调用会退化成匿名，写操作直接 AUTH_REQUIRED(42501)；
 *   3) **可见性判定只在 SQL 函数里做一次**：private 仅本人、unlisted 凭 id 可读、
 *      public 任何人、软删任何情况不可读。本层只把「函数返回空集」翻译成 404，
 *      不在 TS 里再写一套权限逻辑（两套判定迟早会漂移）；
 *   4) 条目分页的游标编码与 repositories/comments.ts 同一套（base64url 的 JSON），
 *      但载荷是收藏夹自己的排序键 {p: position, a: added_at, i: photo_id}，
 *      因为 SQL 侧排序是 position asc, added_at desc, photo_id desc（三列缺一不可）。
 */
import type { PoolClient } from 'pg'
import { notFound, validation } from '../lib/errors.js'
import { iso } from '../lib/mappers.js'
import { mapPhotoWithAuthor, type PhotoWithAuthorRow } from './photos.js'

/** 条目分页上限；超过按 50 截断（与 SQL 里 least(greatest(...)) 的钳制一致）。 */
export const MAX_ITEMS_PAGE_SIZE = 50

export type CollectionVisibility = 'private' | 'unlisted' | 'public'

/** GET /api/me/publish-draft 的载荷；没有草稿时两个字段都是 null。 */
export interface PublishDraftDto {
  payload: unknown
  updatedAt: string | null
}

/** 列表里的一行 = 夹元数据 + 计数与封面（封面取自夹内第一件可见作品）。 */
export interface CollectionSummaryDto {
  id: string
  title: string
  description: string
  visibility: CollectionVisibility
  itemCount: number
  coverPhotoId: string | null
  ownerUsername: string
  ownerDisplayName: string
  updatedAt: string | null
}

/** 单夹详情。ownerId 只对本人生效地出现在载荷里（与前端 /c/:id 的“我的夹”判定一致）。 */
export interface CollectionDetailDto {
  id: string
  title: string
  description: string
  visibility: CollectionVisibility
  ownerId: string | null
  ownerUsername: string
  ownerDisplayName: string
  createdAt: string | null
  updatedAt: string | null
}

/**
 * 夹里的一件作品 = 作品卡片（mapPhoto 的完整投影，前端作品卡片直接复用）
 * + 作者公开字段（一次 join 取出，不做 N+1）+ 归属元数据。
 */
export interface CollectionItemDto extends ReturnType<typeof mapPhotoWithAuthor> {
  /** 该作品在夹内的排序位（同一 position 时按 added_at desc, photo_id desc） */
  position: number
  /** 加入夹的时间（不是作品发布时间） */
  addedAt: string | null
}

export interface CollectionItemsPage {
  items: CollectionItemDto[]
  nextCursor: string | null
}

/** api_list_collection_items 的每一项：photos 整行 + 作者公开字段 + 归属元数据。 */
interface CollectionItemRow extends PhotoWithAuthorRow {
  added_at: unknown
  position: number | null
}

interface ItemsCursor {
  p: number
  a: string
  i: string
}

function encodeItemsCursor(cursor: ItemsCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

/**
 * 解码条目游标。
 *
 * 为什么要在这里死校验：SQL 侧收到坏游标会抛 INVALID_CURSOR(22023)，
 * 被 translateDbError 翻成英文 message 的 400；而更糟的情况是放行后游标里的键
 * 全变 null，分页静默从头开始，用户翻页会看到重复内容。所以坏游标必须在这里拦下。
 */
function parseItemsCursor(cursor: string | undefined): ItemsCursor | null {
  if (!cursor) return null
  if (cursor.length > 256) throw validation('无效的翻页游标')
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw validation('无效的翻页游标')
  }
  if (typeof parsed !== 'object' || parsed === null) throw validation('无效的翻页游标')
  const value = parsed as Record<string, unknown>
  if (typeof value.p !== 'number' || !Number.isInteger(value.p)) throw validation('无效的翻页游标')
  if (typeof value.a !== 'string' || typeof value.i !== 'string') throw validation('无效的翻页游标')
  return { p: value.p, a: value.a, i: value.i }
}

function toSummary(row: {
  id: string
  title: string
  description: string
  visibility: string
  item_count: number
  cover_photo_id: string | null
  owner_username: string
  owner_display_name: string
  updated_at: unknown
}): CollectionSummaryDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    visibility: row.visibility as CollectionVisibility,
    itemCount: Number(row.item_count ?? 0),
    coverPhotoId: row.cover_photo_id,
    ownerUsername: row.owner_username,
    ownerDisplayName: row.owner_display_name,
    updatedAt: iso(row.updated_at),
  }
}

function toDetail(row: {
  id: string
  title: string
  description: string
  visibility: string
  owner_id: string | null
  owner_username: string
  owner_display_name: string
  created_at: unknown
  updated_at: unknown
}): CollectionDetailDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    visibility: row.visibility as CollectionVisibility,
    ownerId: row.owner_id,
    ownerUsername: row.owner_username,
    ownerDisplayName: row.owner_display_name,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function toItem(card: CollectionItemRow): CollectionItemDto {
  return {
    ...mapPhotoWithAuthor(card),
    position: Number(card.position ?? 0),
    addedAt: iso(card.added_at),
  }
}

// ============================================================================
// 草稿（api_get/save/delete_publish_draft）
// ============================================================================

/** 读本人草稿。没有草稿时函数返回空集 —— 这不是错误，返回 {payload: null}。 */
export async function getPublishDraft(client: PoolClient): Promise<PublishDraftDto> {
  const { rows } = await client.query<{ payload: unknown; updated_at: unknown }>(
    'select payload, updated_at from public.api_get_publish_draft()',
  )
  const row = rows[0]
  if (!row) return { payload: null, updatedAt: null }
  return { payload: row.payload ?? null, updatedAt: iso(row.updated_at) }
}

/**
 * 覆盖保存本人草稿（upsert）。形状与 64KB 护栏在函数里，越界抛 23514 → 400。
 * payload 由路由校验成 JSON 对象后传进来，这里再 JSON.stringify 一次交给 jsonb 入参。
 */
export async function savePublishDraft(
  client: PoolClient,
  payload: Record<string, unknown>,
): Promise<{ updatedAt: string | null }> {
  const { rows } = await client.query<{ updated_at: unknown }>(
    'select updated_at from public.api_save_publish_draft($1::jsonb)',
    [JSON.stringify(payload)],
  )
  return { updatedAt: iso(rows[0]?.updated_at ?? null) }
}

/** 丢弃本人草稿（幂等：本来没有也不报错）。 */
export async function deletePublishDraft(client: PoolClient): Promise<void> {
  await client.query('select public.api_delete_publish_draft()')
}

// ============================================================================
// 收藏夹（api_list/get/create/update/delete_collection）
// ============================================================================

/**
 * 数据库里 PROFILE_NOT_FOUND(P0002) 表示「目标资料不存在、已注销或对我不可见」。
 * 直接冒泡会把英文标记当成用户可见文案，所以在这里翻成 404。
 */
async function asProfileNotFound<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'P0002') {
      throw notFound('用户不存在或未公开')
    }
    throw err
  }
}

/**
 * 某用户的夹列表。
 *
 * includePrivate 只有在「目标就是自己」时才会被 SQL 采纳（函数内部比对 auth.uid()），
 * 所以这里传 true 也不是越权开关：拿别人的 private 夹没有任何路径。
 */
export async function listCollections(
  client: PoolClient,
  input: { ownerUsername: string; includePrivate: boolean },
): Promise<CollectionSummaryDto[]> {
  return asProfileNotFound(async () => {
    const { rows } = await client.query<{
      id: string
      title: string
      description: string
      visibility: string
      item_count: number
      cover_photo_id: string | null
      owner_username: string
      owner_display_name: string
      updated_at: unknown
    }>('select * from public.api_list_collections($1::text, $2::boolean)', [
      input.ownerUsername,
      input.includePrivate,
    ])
    return rows.map(toSummary)
  })
}

/**
 * 单夹详情。函数对不可见（私密他人 / 已软删）返回空集，这里翻成 404 ——
 * 404 而不是 403：告诉调用方「这个 id 看不到」本身就足够，403 反而确认了夹存在。
 */
export async function getCollection(client: PoolClient, id: string): Promise<CollectionDetailDto> {
  const { rows } = await client.query<{
    id: string
    title: string
    description: string
    visibility: string
    owner_id: string | null
    owner_username: string
    owner_display_name: string
    created_at: unknown
    updated_at: unknown
  }>('select * from public.api_get_collection($1::uuid)', [id])
  const row = rows[0]
  if (!row) throw notFound('收藏夹不存在或不可见')
  return toDetail(row)
}

export async function createCollection(
  client: PoolClient,
  input: { title: string; description: string; visibility: CollectionVisibility },
): Promise<CollectionDetailDto> {
  const { rows } = await client.query<Parameters<typeof toDetail>[0]>(
    'select * from public.api_create_collection($1::text, $2::text, $3::text)',
    [input.title, input.description, input.visibility],
  )
  const row = rows[0]
  if (!row) throw notFound('收藏夹创建失败')
  return toDetail(row)
}

/**
 * 局部更新：null 表示「这一列不改」（契约要求 PATCH 可以只传 visibility）。
 * 非本人 42501（translateDbError → 403），已删除 P0002（→ 404）。
 */
export async function updateCollection(
  client: PoolClient,
  id: string,
  patch: { title?: string; description?: string; visibility?: CollectionVisibility },
): Promise<CollectionDetailDto> {
  const { rows } = await client.query<Parameters<typeof toDetail>[0]>(
    'select * from public.api_update_collection($1::uuid, $2::text, $3::text, $4::text)',
    [id, patch.title ?? null, patch.description ?? null, patch.visibility ?? null],
  )
  const row = rows[0]
  if (!row) throw notFound('收藏夹不存在或不可见')
  return toDetail(row)
}

/** 软删（置 deleted_at）。幂等：重复删除不报错。 */
export async function deleteCollection(client: PoolClient, id: string): Promise<void> {
  await client.query('select public.api_delete_collection($1::uuid)', [id])
}

// ============================================================================
// 夹内作品（api_add/remove_collection_item、api_list_collection_items）
// ============================================================================

/** 加入夹（幂等：已在夹里不报错，返回当前数量）。非已发布作品 → 23514 → 400。 */
export async function addCollectionItem(
  client: PoolClient,
  input: { collectionId: string; photoId: string },
): Promise<number> {
  const { rows } = await client.query<{ item_count: number }>(
    'select item_count from public.api_add_collection_item($1::uuid, $2::uuid)',
    [input.collectionId, input.photoId],
  )
  return Number(rows[0]?.item_count ?? 0)
}

export async function removeCollectionItem(
  client: PoolClient,
  input: { collectionId: string; photoId: string },
): Promise<number> {
  const { rows } = await client.query<{ item_count: number }>(
    'select item_count from public.api_remove_collection_item($1::uuid, $2::uuid)',
    [input.collectionId, input.photoId],
  )
  return Number(rows[0]?.item_count ?? 0)
}

/**
 * 夹内条目分页。
 *
 * 函数对不可见夹返回**零行**（不是一行空数组），所以这里用「零行 ⇒ 404」区分
 * 「空夹（一行、items=[]）」和「无权看」。排序由 SQL 的
 * position asc, added_at desc, photo_id desc 保证稳定，游标取上一页最后一行的
 * (position, added_at, photo_id) 再按同一顺序翻页，不漏不重。
 */
export async function listCollectionItems(
  client: PoolClient,
  input: { collectionId: string; cursor?: string; limit?: number },
): Promise<CollectionItemsPage> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_ITEMS_PAGE_SIZE)
  const cursor = parseItemsCursor(input.cursor)
  const { rows } = await client.query<{
    items: CollectionItemRow[]
    next_cursor: Partial<ItemsCursor> | null
  }>('select items, next_cursor from public.api_list_collection_items($1::uuid, $2::jsonb, $3::integer)', [
    input.collectionId,
    cursor ? JSON.stringify(cursor) : null,
    limit,
  ])
  const row = rows[0]
  if (!row) throw notFound('收藏夹不存在或不可见')

  const items = Array.isArray(row.items) ? row.items : []
  const next = row.next_cursor
  return {
    items: items.map(toItem),
    nextCursor:
      next && typeof next.p === 'number' && typeof next.a === 'string' && typeof next.i === 'string'
        ? encodeItemsCursor({ p: next.p, a: next.a, i: next.i })
        : null,
  }
}
