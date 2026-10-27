import type { PoolClient } from 'pg'
import { mapComment, type CommentRow } from '../lib/mappers.js'

function encodeCursor(row: { created_at: unknown; id: string }): string {
  const date = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
  return Buffer.from(JSON.stringify([date, row.id]), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): [string, string] | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    return Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'string')
      ? [value[0] as string, value[1] as string]
      : null
  } catch {
    return null
  }
}

export async function listComments(
  client: PoolClient,
  input: { photoId: string; cursor?: string; limit?: number },
) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100)
  const cursor = input.cursor ? decodeCursor(input.cursor) : null
  const params: unknown[] = [input.photoId, limit + 1]
  let cursorSql = ''
  if (input.cursor && !cursor) throw new Error('无效的评论游标')
  if (cursor) {
    params.push(cursor[0], cursor[1])
    cursorSql = 'and (created_at, id) < ($3::timestamptz, $4::uuid)'
  }
  const { rows } = await client.query<CommentRow>(
    `select * from public.comments
      where photo_id = $1::uuid ${cursorSql}
      order by created_at desc, id desc limit $2::integer`,
    params,
  )
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const { rows: countRows } = await client.query<{ count: string }>(
    'select count(*)::text as count from public.comments where photo_id = $1::uuid',
    [input.photoId],
  )
  return {
    items: pageRows.map(mapComment),
    nextCursor: hasMore && pageRows.length ? encodeCursor(pageRows[pageRows.length - 1]!) : null,
    total: Number(countRows[0]?.count ?? 0),
  }
}
