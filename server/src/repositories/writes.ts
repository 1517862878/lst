import type { PoolClient } from 'pg'
import { notFound } from '../lib/errors.js'
import { mapComment, mapPhoto, type CommentRow, type PhotoRow } from '../lib/mappers.js'

export interface CreatePhotoInput {
  id: string
  title: string
  description: string
  categorySlug: string
  tags: string[]
  locationName: string
  locationLat: number | null
  locationLng: number | null
  locationPrecision: string
  shotAt: string | null
  exif: Record<string, unknown> | null
  imageKey: string
  thumbKey: string
  width: number
  height: number
  blurhash: string | null
  license: string
  credit: string | null
}

export async function createPhoto(client: PoolClient, input: CreatePhotoInput) {
  const { rows } = await client.query<PhotoRow>(
    `select p.* from public.api_create_photo(
       $1::uuid,$2::text,$3::text,$4::text,$5::text[],$6::text,
       $7::numeric,$8::numeric,$9::text,$10::timestamptz,$11::jsonb,
       $12::text,$13::text,$14::integer,$15::integer,$16::text,$17::text,$18::text
     ) as p`,
    [
      input.id, input.title, input.description, input.categorySlug, input.tags,
      input.locationName, input.locationLat, input.locationLng, input.locationPrecision,
      input.shotAt, input.exif, input.imageKey, input.thumbKey, input.width, input.height,
      input.blurhash, input.license, input.credit,
    ],
  )
  return mapPhoto(rows[0]!)
}

export async function publishPhoto(client: PoolClient, photoId: string) {
  const { rows } = await client.query<PhotoRow>(
    'select p.* from public.api_publish_photo($1::uuid) as p',
    [photoId],
  )
  return mapPhoto(rows[0]!)
}

export interface PhotoUpdateInput {
  title?: string
  description?: string
  categorySlug?: string
  tags?: string[]
  locationName?: string
  license?: string
  status?: string
  /** 0031：逐张隐藏拍摄参数（不影响账户级 exif_visibility 设置）。 */
  exifHidden?: boolean
}

export async function updatePhoto(client: PoolClient, photoId: string, patch: PhotoUpdateInput) {
  const { rows } = await client.query<PhotoRow>(
    'select p.* from public.api_update_photo($1::uuid, $2::jsonb) as p',
    [photoId, JSON.stringify(patch)],
  )
  const row = rows[0]
  if (!row) throw notFound('作品不存在或无法修改')
  return mapPhoto(row)
}

export async function removePhoto(client: PoolClient, photoId: string): Promise<boolean> {
  const { rows } = await client.query<{ removed: boolean }>(
    'select public.api_remove_photo($1::uuid) as removed',
    [photoId],
  )
  return rows[0]?.removed === true
}

export async function setLike(client: PoolClient, photoId: string, liked: boolean) {
  const { rows } = await client.query<{ api_set_like: boolean }>(
    'select public.api_set_like($1::uuid, $2::boolean)',
    [photoId, liked],
  )
  return rows[0]!.api_set_like
}

export async function setFavorite(client: PoolClient, photoId: string, favorited: boolean) {
  const { rows } = await client.query<{ api_set_favorite: boolean }>(
    'select public.api_set_favorite($1::uuid, $2::boolean)',
    [photoId, favorited],
  )
  return rows[0]!.api_set_favorite
}

export async function createComment(
  client: PoolClient,
  input: { photoId: string; parentId: string | null; body: string },
) {
  const { rows } = await client.query<CommentRow>(
    'select c.* from public.api_create_comment($1::uuid, $2::uuid, $3::text) as c',
    [input.photoId, input.parentId, input.body],
  )
  return mapComment(rows[0]!)
}

export async function removeComment(client: PoolClient, commentId: string, actorId: string) {
  // 0032：从 api_remove_comment（仅评论作者）换成 api_delete_comment
  // （评论作者**或**作品作者）。权限判据在数据库函数里，路由层不重复实现，
  // 否则 SQL 直调与管理端点会得到两套不同的越权结论。
  const { rows } = await client.query<{ comment_id: string; deleted_at: string | null }>(
    'select * from public.api_delete_comment($1::uuid, $2::uuid)',
    [commentId, actorId],
  )
  const row = rows[0]
  if (!row) throw notFound('评论不存在或无法删除')
  return row
}

/**
 * 0032：作者开关某件作品的评论。
 *
 * p_actor_id 只用于与 auth.uid() 交叉校验（二者不一致即 42501），
 * 真正的授权判据是会话身份，不能让调用方自称是作者。
 */
export async function setCommentsLocked(
  client: PoolClient,
  photoId: string,
  actorId: string,
  locked: boolean,
) {
  const { rows } = await client.query<{ photo_id: string; comments_locked: boolean }>(
    'select * from public.api_set_comments_locked($1::uuid, $2::uuid, $3::boolean)',
    [photoId, actorId, locked],
  )
  const row = rows[0]
  if (!row) throw notFound('作品不存在或已删除')
  return { photoId: row.photo_id, commentsLocked: row.comments_locked }
}
