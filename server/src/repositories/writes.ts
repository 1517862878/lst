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

export async function removeComment(client: PoolClient, commentId: string) {
  await client.query('select public.api_remove_comment($1::uuid)', [commentId])
}
