import type { PoolClient } from 'pg'
import { mapPhoto, type PhotoRow } from '../lib/mappers.js'

export interface InteractionRow {
  user_id: string
  photo_id: string
  created_at: Date | string
}

const photoColumns = `
  p.id, p.author_id, p.title, p.description, p.category_slug, p.tags,
  p.location_name, p.location_lat, p.location_lng, p.location_precision,
  p.shot_at, p.exif, p.image_key, p.thumb_key, p.width, p.height,
  p.blurhash, p.license, p.credit, p.status, p.like_count,
  p.favorite_count, p.comment_count, p.view_count, p.published_at,
  p.created_at, p.updated_at, p.deleted_at`

async function listByUser(client: PoolClient, table: 'likes' | 'favorites', userId: string) {
  const { rows } = await client.query<PhotoRow>(
    `select ${photoColumns}
       from public.${table} i
       join public.photos p on p.id = i.photo_id
      where i.user_id = $1::uuid and p.status = 'published' and p.deleted_at is null
      order by i.created_at desc`,
    [userId],
  )
  return rows.map(mapPhoto)
}

export const listLikesByUser = (client: PoolClient, userId: string) => listByUser(client, 'likes', userId)
export const listFavoritesByUser = (client: PoolClient, userId: string) => listByUser(client, 'favorites', userId)

export async function getInteractionState(
  client: PoolClient,
  table: 'likes' | 'favorites',
  userId: string,
  photoId: string,
) {
  const { rowCount } = await client.query(
    `select 1 from public.${table} where user_id = $1::uuid and photo_id = $2::uuid`,
    [userId, photoId],
  )
  return (rowCount ?? 0) > 0
}

export async function listByPhoto(
  client: PoolClient,
  table: 'likes' | 'favorites',
  photoId: string,
) {
  const { rows } = await client.query<InteractionRow>(
    `select user_id, photo_id, created_at from public.${table} where photo_id = $1::uuid order by created_at desc`,
    [photoId],
  )
  return rows.map((row) => ({
    userId: row.user_id,
    photoId: row.photo_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }))
}
