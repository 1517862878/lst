import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { after, before } from 'node:test'
import pg from 'pg'

const { Client } = pg
const ORIGIN = 'http://127.0.0.1:5173'
const OWNER_ID = 'a1000000-0000-0000-0000-000000000001'
const OTHER_ID = 'b2000000-0000-0000-0000-000000000002'
const PHOTO_ID = 'c3000000-0000-0000-0000-000000000003'
const OWNER_SECRET = 'owner-session-secret-that-is-long-enough-0001'
const OTHER_SECRET = 'other-session-secret-that-is-long-enough-0002'
const CSRF = 'csrf-token-for-photo-owner-integration'

let app: Awaited<ReturnType<(typeof import('../index.js'))['buildApp']>>
let admin: pg.Client
let ownerSessionId = ''
let otherSessionId = ''

function tokenHash(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

function authHeaders(sessionId: string, secret: string, csrf = CSRF) {
  return {
    origin: ORIGIN,
    cookie: `gk_session=${sessionId}.${secret}; gy_csrf=${CSRF}`,
    'x-csrf-token': csrf,
  }
}

async function seedSession(userId: string, secret: string): Promise<string> {
  const result = await admin.query<{ session_id: string }>(
    `select session_id from public.api_create_session($1,$2,now() + interval '1 hour',$3,$4)`,
    [userId, tokenHash(secret), 'photo-owner-integration', 'integration-ip'],
  )
  return result.rows[0]!.session_id
}

before(async () => {
  admin = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGADMIN_USER ?? 'postgres',
    password: process.env.PGADMIN_PASSWORD,
  })
  await admin.connect()
  await admin.query(
    `insert into auth.users (id,email,raw_user_meta_data) values
      ($1,'p0-owner@test.local','{"display_name":"P0 Owner"}'),
      ($2,'p0-other@test.local','{"display_name":"P0 Other"}')
     on conflict (id) do nothing`,
    [OWNER_ID, OTHER_ID],
  )
  await admin.query(
    `insert into public.profiles (id,username,display_name) values
      ($1,'p0_owner','P0 Owner'),($2,'p0_other','P0 Other')
     on conflict (id) do nothing`,
    [OWNER_ID, OTHER_ID],
  )
  await admin.query(
    `insert into public.photos
      (id,author_id,title,category_slug,image_key,thumb_key,width,height,status,published_at)
     values ($1,$2,'API 原标题','landscape',$3,$4,1200,800,'published',clock_timestamp())
     on conflict (id) do update set author_id=excluded.author_id,title=excluded.title,
       status='published',published_at=excluded.published_at,deleted_at=null`,
    [PHOTO_ID, OWNER_ID, `photos/${OWNER_ID}/${PHOTO_ID}/display.webp`, `photos/${OWNER_ID}/${PHOTO_ID}/thumb.webp`],
  )
  ownerSessionId = await seedSession(OWNER_ID, OWNER_SECRET)
  otherSessionId = await seedSession(OTHER_ID, OTHER_SECRET)
  const appDb = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  })
  await appDb.connect()
  try {
    const stored = await appDb.query('select * from public.api_get_session_for_auth($1)', [ownerSessionId])
    assert.equal(stored.rows[0]?.user_id, OWNER_ID)
    const active = await appDb.query('select public.api_session_is_active($1,$2) active', [ownerSessionId, OWNER_ID])
    assert.equal(active.rows[0]?.active, true)
    await appDb.query('begin')
    await appDb.query("select set_config('app.user_id',$1,true)", [OWNER_ID])
    const profile = await appDb.query('select id from public.profiles where id=$1', [OWNER_ID])
    assert.equal(profile.rows[0]?.id, OWNER_ID)
    await appDb.query('rollback')
  } finally {
    await appDb.end()
  }
  const { buildApp } = await import('../index.js')
  app = await buildApp()
  const who = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: `gk_session=${ownerSessionId}.${OWNER_SECRET}` } })
  assert.equal(who.statusCode, 200, who.body)
  assert.equal(who.json().userId, OWNER_ID)
})

after(async () => {
  await app?.close()
  await admin?.end()
})

test('request security rejects missing origin, session, and csrf', async () => {
  const noOrigin = await app.inject({ method: 'PATCH', url: `/api/photos/${PHOTO_ID}`, payload: { title: 'x' } })
  assert.equal(noOrigin.statusCode, 403)
  assert.equal(noOrigin.json().code, 'FORBIDDEN')

  const anonymous = await app.inject({ method: 'PATCH', url: `/api/photos/${PHOTO_ID}`, headers: { origin: ORIGIN }, payload: { title: 'x' } })
  assert.equal(anonymous.statusCode, 401)
  assert.equal(anonymous.json().code, 'UNAUTHORIZED')

  const badCsrf = await app.inject({ method: 'PATCH', url: `/api/photos/${PHOTO_ID}`, headers: authHeaders(ownerSessionId, OWNER_SECRET, 'wrong'), payload: { title: 'x' } })
  assert.equal(badCsrf.statusCode, 403)
  assert.equal(badCsrf.json().code, 'FORBIDDEN')
})

test('owner updates mutable fields while invalid and immutable fields are rejected', async () => {
  const updated = await app.inject({
    method: 'PATCH', url: `/api/photos/${PHOTO_ID}`,
    headers: authHeaders(ownerSessionId, OWNER_SECRET),
    payload: { title: 'API 新标题', tags: ['Night', '城市'], license: 'cc_by' },
  })
  assert.equal(updated.statusCode, 200, updated.body)
  assert.equal(updated.json().title, 'API 新标题')

  for (const payload of [{ authorId: OTHER_ID }, { imageKey: 'other.webp' }, { status: 'published' }]) {
    const response = await app.inject({ method: 'PATCH', url: `/api/photos/${PHOTO_ID}`, headers: authHeaders(ownerSessionId, OWNER_SECRET), payload })
    assert.equal(response.statusCode, 400, response.body)
    assert.equal(response.json().code, 'VALIDATION')
  }

  const row = await admin.query('select title,tags,license,author_id,image_key from public.photos where id=$1', [PHOTO_ID])
  assert.equal(row.rows[0].title, 'API 新标题')
  assert.deepEqual(row.rows[0].tags, ['night', '城市'])
  assert.equal(row.rows[0].license, 'cc_by')
  assert.equal(row.rows[0].author_id, OWNER_ID)
})

test('non-owner cannot update or remove and receives non-enumerating 404', async () => {
  const patch = await app.inject({ method: 'PATCH', url: `/api/photos/${PHOTO_ID}`, headers: authHeaders(otherSessionId, OTHER_SECRET), payload: { title: '越权修改' } })
  assert.equal(patch.statusCode, 404, patch.body)
  assert.equal(patch.json().code, 'NOT_FOUND')

  const remove = await app.inject({ method: 'DELETE', url: `/api/photos/${PHOTO_ID}`, headers: authHeaders(otherSessionId, OTHER_SECRET) })
  assert.equal(remove.statusCode, 404, remove.body)
})

test('owner soft-removes idempotently and visibility follows RLS', async () => {
  const headers = authHeaders(ownerSessionId, OWNER_SECRET)
  const first = await app.inject({ method: 'DELETE', url: `/api/photos/${PHOTO_ID}`, headers })
  assert.equal(first.statusCode, 204, first.body)
  const second = await app.inject({ method: 'DELETE', url: `/api/photos/${PHOTO_ID}`, headers })
  assert.equal(second.statusCode, 204, second.body)

  const row = await admin.query('select status,deleted_at,image_key from public.photos where id=$1', [PHOTO_ID])
  assert.equal(row.rows[0].status, 'removed')
  assert.ok(row.rows[0].deleted_at)
  assert.match(row.rows[0].image_key, /display\.webp$/)

  const afterRemovePatch = await app.inject({ method: 'PATCH', url: `/api/photos/${PHOTO_ID}`, headers, payload: { title: '撤回后修改' } })
  assert.equal(afterRemovePatch.statusCode, 404, afterRemovePatch.body)

  const anonymous = await app.inject({ method: 'GET', url: `/api/photos/${PHOTO_ID}` })
  assert.equal(anonymous.statusCode, 404, anonymous.body)
  const other = await app.inject({ method: 'GET', url: `/api/photos/${PHOTO_ID}`, headers: { cookie: `gk_session=${otherSessionId}.${OTHER_SECRET}` } })
  assert.equal(other.statusCode, 404, other.body)
  const owner = await app.inject({ method: 'GET', url: `/api/photos/${PHOTO_ID}`, headers: { cookie: `gk_session=${ownerSessionId}.${OWNER_SECRET}` } })
  assert.equal(owner.statusCode, 200, owner.body)
  assert.equal(owner.json().status, 'removed')
})
