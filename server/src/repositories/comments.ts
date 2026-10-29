import type { PoolClient } from 'pg'
import { validation } from '../lib/errors.js'
import { mapComment, type CommentRow } from '../lib/mappers.js'

/** 0032：评论排序。前端 `?sort=` 只允许这两个值，数据库函数同名校验。 */
export type CommentSort = 'latest' | 'oldest'

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

/**
 * 评论列表。
 *
 * 0032 起排序下沉到 public.api_list_comments（latest / oldest，游标与排序同向），
 * 这里不再自己拼 order by —— 排序与游标比较方向必须成对出现，两处分头维护
 * 就会出现「首页最新、次页最早」的错位。
 *
 * 函数是 security invoker，可见性仍由 comments 的 RLS 决定；
 * 因此调用方必须已经进入 withRls 上下文（匿名列表传 null）。
 */
export async function listComments(
  client: PoolClient,
  input: { photoId: string; cursor?: string; limit?: number; sort?: CommentSort },
) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100)
  const sort: CommentSort = input.sort === 'oldest' ? 'oldest' : 'latest'
  const cursor = input.cursor ? decodeCursor(input.cursor) : null
  // 坏游标是客户端输入错误（400），不是服务端故障：别让它冒成 500。
  if (input.cursor && !cursor) throw validation('无效的评论游标')

  // 多取一行判断是否还有下一页。注意函数内部把 p_limit 夹到 1..100，
  // 所以 limit=100 时探测会失效（一页到底）；评论一页 100 条已远超实际使用。
  const { rows } = await client.query<CommentRow>(
    `select * from public.api_list_comments(
       $1::uuid, $2::text, $3::integer, $4::timestamptz, $5::uuid
     )`,
    [input.photoId, sort, limit + 1, cursor?.[0] ?? null, cursor?.[1] ?? null],
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
