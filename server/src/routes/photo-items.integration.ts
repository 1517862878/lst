/**
 * 组照（多图作品）集成测试（0033）——跑在真实 PostgreSQL 上。
 *
 * 覆盖：
 *   1) 作者整组替换：条目落库、封面同步到 photos 的 image_key/thumb_key/宽高；
 *   2) 顺序由数组顺序决定，重排后封面跟着换（position 由服务端重写，不认客户端）；
 *   3) 收回成单图：1 条 = 组照只剩封面；空数组不改封面（幂等）；
 *   4) 权限边界：匿名 401、他人作品 403、他人目录的键 403；
 *   5) 形状护栏：>9 条、caption 超 200 字、宽高非正整数、display/thumb 槽位不匹配、items 非数组 → 400；
 *   6) 被替换掉的旧图片键进入清理队列（photo_storage_cleanup_jobs）；
 *   7) 已撤回（removed）的作品不能再改组照 → 404。
 *
 * 运行（与其它 integration 测试一致，库必须已迁移到 0033）：
 *   PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=gongke_verify_items PGUSER=app_user \
 *   PGPASSWORD=*** PGADMIN_USER=postgres PGADMIN_PASSWORD=*** \
 *   node --import tsx --test server/src/routes/photo-items.integration.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { after, before } from 'node:test'
import pg from 'pg'

const { Client } = pg

const ORIGIN = 'http://127.0.0.1:5173'
const CSRF = 'csrf-token-for-photo-items-integration'

const ALICE_ID = 'e1000000-0000-0000-0000-000000000001'
const BOB_ID = 'e2000000-0000-0000-0000-000000000002'

const PHOTO_ALICE = 'ea000000-0000-0000-0000-000000000001'
const PHOTO_ALICE_REMOVED = 'ea000000-0000-0000-0000-000000000002'
const PHOTO_BOB = 'ea000000-0000-0000-0000-000000000003'

const ALICE_SECRET = 'photo-items-alice-session-secret-0001'
const BOB_SECRET = 'photo-items-bob-session-secret-000002'

type App = Awaited<ReturnType<(typeof import('../index.js'))['buildApp']>>
type Who = 'alice' | 'bob'

let app: App
let admin: pg.Client
const session: Record<Who, string> = { alice: '', bob: '' }
const SECRETS: Record<Who, string> = { alice: ALICE_SECRET, bob: BOB_SECRET }

function tokenHash(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

function cookieOf(who: Who): string {
  // gy_csrf 是双提交 cookie：请求安全中间件要求它与 x-csrf-token 头一致。
  return `gk_session=${session[who]}.${SECRETS[who]}; gy_csrf=${CSRF}`
}

function authHeaders(who: Who) {
  return { origin: ORIGIN, cookie: cookieOf(who), 'x-csrf-token': CSRF }
}

function readHeaders(who: Who) {
  return { cookie: cookieOf(who) }
}

async function seedSession(userId: string, secret: string, label: string): Promise<string> {
  const result = await admin.query<{ session_id: string }>(
    `select session_id from public.api_create_session($1,$2,now() + interval '1 hour',$3,$4)`,
    [userId, tokenHash(secret), label, 'integration-ip'],
  )
  return result.rows[0]!.session_id
}

/** 作品 ID 决定目录前缀：键必须落在 photos/<uid>/<photoId>/ 内。 */
function slotKey(ownerId: string, photoId: string, slot: number | 'cover', kind: 'display' | 'thumb'): string {
  const base = `photos/${ownerId}/${photoId}`
  return slot === 'cover' ? `${base}/${kind}.webp` : `${base}/items/${slot}/${kind}.webp`
}

function item(ownerId: string, photoId: string, slot: number | 'cover', extra: Record<string, unknown> = {}) {
  return {
    imageKey: slotKey(ownerId, photoId, slot, 'display'),
    thumbKey: slotKey(ownerId, photoId, slot, 'thumb'),
    width: 1200,
    height: 800,
    blurhash: null,
    caption: '',
    ...extra,
  }
}

interface PhotoItemsResponse {
  photoId: string
  itemCount: number
}

interface PhotoDetail {
  id: string
  imageKey: string
  thumbKey: string
  width: number
  height: number
  itemCount: number
  items: Array<{ imageKey: string; thumbKey: string; caption: string; position: number }>
}

async function seedPhoto(id: string, authorId: string, status: 'published' | 'removed'): Promise<void> {
  await admin.query(
    `insert into public.photos
       (id,author_id,title,category_slug,image_key,thumb_key,width,height,status,published_at,deleted_at)
     values ($1,$2,$3,'landscape',$4,$5,1200,800,$6,$7,$8)
     on conflict (id) do update set
       status=excluded.status, published_at=excluded.published_at, deleted_at=excluded.deleted_at`,
    [
      id,
      authorId,
      status === 'removed' ? '已撤回的作品' : '组照测试作品',
      slotKey(authorId, id, 'cover', 'display'),
      slotKey(authorId, id, 'cover', 'thumb'),
      status,
      status === 'published' ? '2026-10-01T10:00:00Z' : null,
      status === 'removed' ? '2026-10-02T10:00:00Z' : null,
    ],
  )
}

before(async () => {
  admin = new Client({
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGADMIN_USER ?? 'postgres',
    password: process.env.PGADMIN_PASSWORD,
  })
  await admin.connect()

  // profiles.id 外键指向 auth.users，所以先建 auth.users，触发器会顺手建 profile。
  await admin.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
       ($1, 'items-a@test.local', '{"display_name":"组照甲"}'::jsonb),
       ($2, 'items-b@test.local', '{"display_name":"组照乙"}'::jsonb)
     on conflict (id) do nothing`,
    [ALICE_ID, BOB_ID],
  )
  for (const [id, username] of [
    [ALICE_ID, 'items_alice'],
    [BOB_ID, 'items_bob'],
  ] as const) {
    await admin.query(`update public.profiles set username = $2 where id = $1`, [id, username])
  }

  await admin.query(
    `insert into public.categories (slug, name, sort_order) values ('landscape', '风光', 1)
     on conflict (slug) do nothing`,
  )

  await seedPhoto(PHOTO_ALICE, ALICE_ID, 'published')
  await seedPhoto(PHOTO_ALICE_REMOVED, ALICE_ID, 'removed')
  await seedPhoto(PHOTO_BOB, BOB_ID, 'published')

  session.alice = await seedSession(ALICE_ID, ALICE_SECRET, 'photo-items-alice')
  session.bob = await seedSession(BOB_ID, BOB_SECRET, 'photo-items-bob')

  const { buildApp } = await import('../index.js')
  app = await buildApp()
})

after(async () => {
  await app?.close()
  if (admin) {
    await admin.query(`delete from public.photo_storage_cleanup_jobs where photo_id = any($1::uuid[])`, [
      [PHOTO_ALICE, PHOTO_ALICE_REMOVED, PHOTO_BOB],
    ])
    await admin.query(`delete from public.photos where id = any($1::uuid[])`, [
      [PHOTO_ALICE, PHOTO_ALICE_REMOVED, PHOTO_BOB],
    ])
    await admin.query(`delete from public.profiles where id = any($1::uuid[])`, [[ALICE_ID, BOB_ID]])
    await admin.query(`delete from auth.users where id = any($1::uuid[])`, [[ALICE_ID, BOB_ID]])
    await admin.end()
  }
})

test('组照写入：整组替换、封面同步、顺序决定 position', async () => {
  const replaced = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ALICE}/items`,
    headers: authHeaders('alice'),
    payload: {
      items: [
        item(ALICE_ID, PHOTO_ALICE, 2, { caption: '第二槽当封面' }),
        item(ALICE_ID, PHOTO_ALICE, 0, { caption: '  空白会 trim  ' }),
        item(ALICE_ID, PHOTO_ALICE, 1, { caption: '' }),
      ],
      // 客户端乱传 position/id 必须被忽略（契约 §2）
      position: 7,
      id: 'should-be-ignored',
    },
  })
  assert.equal(replaced.statusCode, 200, replaced.body)
  const body = replaced.json() as PhotoItemsResponse
  assert.equal(body.itemCount, 3, replaced.body)

  const detail = await app.inject({
    method: 'GET',
    url: `/api/photos/${PHOTO_ALICE}`,
    headers: readHeaders('alice'),
  })
  assert.equal(detail.statusCode, 200, detail.body)
  const photo = detail.json() as PhotoDetail
  assert.equal(photo.itemCount, 3)
  assert.equal(photo.items.length, 3)
  // 封面 = position 0 的条目
  assert.equal(photo.imageKey, slotKey(ALICE_ID, PHOTO_ALICE, 2, 'display'))
  assert.equal(photo.thumbKey, slotKey(ALICE_ID, PHOTO_ALICE, 2, 'thumb'))
  assert.deepEqual(
    photo.items.map((entry) => entry.position),
    [0, 1, 2],
  )
  assert.deepEqual(
    photo.items.map((entry) => entry.caption),
    ['第二槽当封面', '空白会 trim', ''],
  )

  // 重排：把槽位 1 提到最前，封面必须跟着换
  const reordered = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ALICE}/items`,
    headers: authHeaders('alice'),
    payload: {
      items: [
        item(ALICE_ID, PHOTO_ALICE, 1),
        item(ALICE_ID, PHOTO_ALICE, 2),
        item(ALICE_ID, PHOTO_ALICE, 0),
      ],
    },
  })
  assert.equal(reordered.statusCode, 200, reordered.body)
  const afterReorder = await app.inject({
    method: 'GET',
    url: `/api/photos/${PHOTO_ALICE}`,
    headers: readHeaders('alice'),
  })
  assert.equal(
    (afterReorder.json() as PhotoDetail).imageKey,
    slotKey(ALICE_ID, PHOTO_ALICE, 1, 'display'),
  )
})

test('组照收回单图：1 条只剩封面，空数组不改封面', async () => {
  const single = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ALICE}/items`,
    headers: authHeaders('alice'),
    payload: { items: [item(ALICE_ID, PHOTO_ALICE, 'cover')] },
  })
  assert.equal(single.statusCode, 200, single.body)
  assert.equal((single.json() as PhotoItemsResponse).itemCount, 1)

  const emptied = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ALICE}/items`,
    headers: authHeaders('alice'),
    payload: { items: [] },
  })
  assert.equal(emptied.statusCode, 200, emptied.body)
  assert.equal((emptied.json() as PhotoItemsResponse).itemCount, 0)

  const detail = await app.inject({
    method: 'GET',
    url: `/api/photos/${PHOTO_ALICE}`,
    headers: readHeaders('alice'),
  })
  const photo = detail.json() as PhotoDetail
  assert.equal(photo.items.length, 0)
  // 空数组是幂等的：封面仍是那张单图，不会变成空串
  assert.equal(photo.imageKey, slotKey(ALICE_ID, PHOTO_ALICE, 'cover', 'display'))
})

test('组照权限边界：匿名 401、他人作品 403、他人目录的键 403', async () => {
  // 来源校验在最前面：没有可信 Origin/CSRF 的写请求是 403，轮不到登录判定
  const untrustedOrigin = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ALICE}/items`,
    payload: { items: [item(ALICE_ID, PHOTO_ALICE, 0)] },
  })
  assert.equal(untrustedOrigin.statusCode, 403, untrustedOrigin.body)

  // 带了可信来源但没有会话 → 401
  const anonymous = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ALICE}/items`,
    headers: { origin: ORIGIN, 'x-csrf-token': CSRF },
    payload: { items: [item(ALICE_ID, PHOTO_ALICE, 0)] },
  })
  assert.equal(anonymous.statusCode, 401, anonymous.body)

  const otherAuthor = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ALICE}/items`,
    headers: authHeaders('bob'),
    payload: { items: [item(ALICE_ID, PHOTO_ALICE, 0)] },
  })
  assert.equal(otherAuthor.statusCode, 403, otherAuthor.body)

  // 别人的目录：形状合法但目录不属于本人 + 本作品
  const foreignKey = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ALICE}/items`,
    headers: authHeaders('alice'),
    payload: { items: [item(BOB_ID, PHOTO_BOB, 0)] },
  })
  assert.equal(foreignKey.statusCode, 403, foreignKey.body)
})

test('组照形状护栏：超限、超长说明、槽位不匹配、非法宽高、items 非数组', async () => {
  const tooMany = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ALICE}/items`,
    headers: authHeaders('alice'),
    payload: { items: Array.from({ length: 10 }, (_, index) => item(ALICE_ID, PHOTO_ALICE, index % 9)) },
  })
  assert.equal(tooMany.statusCode, 400, tooMany.body)

  const longCaption = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ALICE}/items`,
    headers: authHeaders('alice'),
    payload: { items: [item(ALICE_ID, PHOTO_ALICE, 0, { caption: '字'.repeat(201) })] },
  })
  assert.equal(longCaption.statusCode, 400, longCaption.body)

  const mismatched = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ALICE}/items`,
    headers: authHeaders('alice'),
    payload: {
      items: [
        {
          imageKey: slotKey(ALICE_ID, PHOTO_ALICE, 0, 'display'),
          thumbKey: slotKey(ALICE_ID, PHOTO_ALICE, 1, 'thumb'),
          width: 1200,
          height: 800,
          blurhash: null,
          caption: '',
        },
      ],
    },
  })
  assert.equal(mismatched.statusCode, 400, mismatched.body)

  const badSize = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ALICE}/items`,
    headers: authHeaders('alice'),
    payload: { items: [item(ALICE_ID, PHOTO_ALICE, 0, { width: 0 })] },
  })
  assert.equal(badSize.statusCode, 400, badSize.body)

  const notArray = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ALICE}/items`,
    headers: authHeaders('alice'),
    payload: { items: { imageKey: 'x' } },
  })
  assert.equal(notArray.statusCode, 400, notArray.body)
})

test('组照替换后：被丢掉的旧图片键进入清理队列，已撤回作品拒绝写入', async () => {
  await admin.query(`delete from public.photo_storage_cleanup_jobs where photo_id = $1`, [PHOTO_ALICE])

  // 先摆成两条（槽位 0 当封面 + 槽位 1）
  const two = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ALICE}/items`,
    headers: authHeaders('alice'),
    payload: { items: [item(ALICE_ID, PHOTO_ALICE, 0), item(ALICE_ID, PHOTO_ALICE, 1)] },
  })
  assert.equal(two.statusCode, 200, two.body)
  await admin.query(`delete from public.photo_storage_cleanup_jobs where photo_id = $1`, [PHOTO_ALICE])

  // 再缩回一条：槽位 1 的 display/thumb 从此无人引用，必须入队
  const shrunk = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ALICE}/items`,
    headers: authHeaders('alice'),
    payload: { items: [item(ALICE_ID, PHOTO_ALICE, 0)] },
  })
  assert.equal(shrunk.statusCode, 200, shrunk.body)

  const queued = await admin.query<{ object_key: string }>(
    `select object_key from public.photo_storage_cleanup_jobs where photo_id = $1`,
    [PHOTO_ALICE],
  )
  const keys = queued.rows.map((row) => row.object_key)
  assert.ok(
    keys.includes(slotKey(ALICE_ID, PHOTO_ALICE, 1, 'display')) &&
      keys.includes(slotKey(ALICE_ID, PHOTO_ALICE, 1, 'thumb')),
    `被丢掉的槽位 1 未入清理队列：${JSON.stringify(keys)}`,
  )
  // 仍在用的封面键绝不能被登记（否则会删掉活着的图）
  assert.ok(
    !keys.includes(slotKey(ALICE_ID, PHOTO_ALICE, 0, 'display')),
    `在用的封面键被误登记：${JSON.stringify(keys)}`,
  )

  // 空数组退回单图：封面刻意不变，那一张也不能被登记
  await admin.query(`delete from public.photo_storage_cleanup_jobs where photo_id = $1`, [PHOTO_ALICE])
  const emptied = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ALICE}/items`,
    headers: authHeaders('alice'),
    payload: { items: [] },
  })
  assert.equal(emptied.statusCode, 200, emptied.body)
  const afterEmpty = await admin.query<{ object_key: string }>(
    `select object_key from public.photo_storage_cleanup_jobs where photo_id = $1`,
    [PHOTO_ALICE],
  )
  assert.deepEqual(
    afterEmpty.rows.map((row) => row.object_key),
    [],
    '空数组退回单图时不应登记任何键（封面仍然在用）',
  )

  const removedPhoto = await app.inject({
    method: 'PUT',
    url: `/api/photos/${PHOTO_ALICE_REMOVED}/items`,
    headers: authHeaders('alice'),
    payload: { items: [item(ALICE_ID, PHOTO_ALICE_REMOVED, 0)] },
  })
  assert.equal(removedPhoto.statusCode, 404, removedPhoto.body)
})
