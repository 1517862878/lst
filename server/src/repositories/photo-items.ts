/**
 * 组照条目（photo_items）的读写仓储。
 *
 * 边界（与 writes.ts / storage-cleanup.ts 保持同一套原则）：
 *   public.photo_items 对 app_user 是【零表权限】的（0033 收回并自检），
 *   所以这里不写任何直接的表 DML，只调用 0033 的两个 security definer 窄函数：
 *     api_list_photo_items(p_photo_id)                    —— 按 position 升序返回条目
 *     api_replace_photo_items(p_photo_id, p_actor, p_items) —— 整组替换（作者本人）
 *   可见性、作者校验、9 张上限、键的归属校验全部在数据库侧，应用层拿不到旁路。
 *
 * 单图作品零回归的关键也在这里：本条目表为空时，作品封面依然来自
 * photos.image_key / thumb_key（api_replace_photo_items 只在 p_items 非空时
 * 才把 position=0 同步进 photos，空数组不碰封面），所以既有的列表/详情查询
 * 一行都不用改，也不会被改成 join。
 */
import type { PoolClient } from 'pg'

/** 写入形状（契约 §2：前端把上传好的键与尺寸交上来，位置由数组顺序决定）。 */
export interface PhotoItemInput {
  imageKey: string
  thumbKey: string
  width: number
  height: number
  blurhash: string | null
  caption: string
}

/** 读取形状（对应前端 PhotoItem）。 */
export interface PhotoItem {
  id: string
  position: number
  imageKey: string
  thumbKey: string
  width: number
  height: number
  blurhash: string | null
  caption: string
}

interface PhotoItemRow {
  id: string
  position: number
  image_key: string
  thumb_key: string
  width: number
  height: number
  blurhash: string | null
  caption: string
}

interface ReplaceRow {
  photo_id: string
  item_count: number
}

export function mapPhotoItem(row: PhotoItemRow): PhotoItem {
  return {
    id: row.id,
    position: Number(row.position),
    imageKey: row.image_key,
    thumbKey: row.thumb_key,
    width: Number(row.width),
    height: Number(row.height),
    blurhash: row.blurhash,
    caption: row.caption,
  }
}

/**
 * 读取一件作品的组照条目。
 *
 * 单图作品（没有任何 photo_items 行）返回 []，调用方直接把它当 items 放进载荷——
 * 前端不需要区分「单图」和「组照」，只看 items.length / itemCount。
 */
export async function listPhotoItems(client: PoolClient, photoId: string): Promise<PhotoItem[]> {
  const { rows } = await client.query<PhotoItemRow>(
    `select id::text,
            "position",
            image_key,
            thumb_key,
            width,
            height,
            blurhash,
            caption
       from public.api_list_photo_items($1::uuid)`,
    [photoId],
  )
  return rows.map(mapPhotoItem)
}

/**
 * 整组替换组照条目（作者本人）。
 *
 * 语义（见 0033 的 api_replace_photo_items）：
 *   - 非空数组：整组替换，position 按数组下标 0..n-1 重排，并把 position=0
 *     同步为 photos 的封面字段（既有查询零改动）；
 *   - 空数组：退回单图作品，item_count=0，**不动** photos.image_key，
 *     也就是封面继续是原来那张。
 *
 * 错误都从数据库抛上来再由 translateDbError 翻译：
 *   42501 → 403（非作者）、P0002 → 404（作品不存在/已撤回）、
 *   23514 → 400（超过 9 张、单张说明超长）、22023 → 400（字段缺失或类型不对）。
 */
export async function replacePhotoItems(
  client: PoolClient,
  photoId: string,
  actorId: string,
  items: PhotoItemInput[],
): Promise<{ photoId: string; itemCount: number }> {
  const { rows } = await client.query<ReplaceRow>(
    `select photo_id::text, item_count
       from public.api_replace_photo_items($1::uuid, $2::uuid, $3::jsonb)`,
    [photoId, actorId, JSON.stringify(items)],
  )
  const row = rows[0]
  // 数据库保证成功时必有一行；真拿不到说明函数被改坏了，按 500 暴露而不是静默返回 0。
  if (!row) throw new Error('api_replace_photo_items 未返回结果')
  return { photoId: row.photo_id, itemCount: Number(row.item_count) }
}
