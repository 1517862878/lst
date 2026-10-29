/**
 * 服务端草稿 + 收藏架集成测试（0028）——跑在真实 PostgreSQL 上。
 *
 * 覆盖冻结契约 §2 要求的全部用例：
 *   1) 草稿存取与删除（含「无草稿 = 200 + null」的语义）、形状/大小护栏、跨用户隔离；
 *   2) 私密夹对他人不可见（列表与详情两条路都挡住）；
 *   3) unlisted 凭 id 可读（含匿名）；
 *   4) 重复加入/移出幂等；
 *   5) 非本人改删 403、匿名写 401；
 *   6) 私密（未发布）作品不可收藏；
 *   7) 条目游标分页不重不漏；
 *   8) 第 31 个夹 422（配额上限）。
 *
 * 运行（与其它 integration 测试一致，库必须已迁移到 0028）：
 *   PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=gongke_verify_83b PGUSER=app_user \
 *   PGPASSWORD=*** PGADMIN_USER=postgres PGADMIN_PASSWORD=*** \
 *   node --import tsx --test server/src/routes/collections.integration.ts
 *
 * 一次性库请用 .tmp/verify-83b.sh（会先全量应用 supabase/migrations）。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { after, before } from 'node:test'
import pg from 'pg'

const { Client } = pg

const ORIGIN = 'http://127.0.0.1:5173'
const CSRF = 'csrf-token-for-collections-integration'

const ALICE_ID = 'c1000000-0000-0000-0000-000000000001'
const BOB_ID = 'c2000000-0000-0000-0000-000000000002'
/** 只用来撞 30 个夹的配额，互不干扰其它断言。 */
const MAX_ID = 'c3000000-0000-0000-0000-000000000003'

const PUB_IDS = [
  'ca000000-0000-0000-0000-000000000001',
  'ca000000-0000-0000-0000-000000000002',
  'ca000000-0000-0000-0000-000000000003',
  'ca000000-0000-0000-0000-000000000004',
  'ca000000-0000-0000-0000-000000000005',
] as const
const DRAFT_PHOTO_ID = 'ca000000-0000-0000-0000-000000000006'
const REMOVED_PHOTO_ID = 'ca000000-0000-0000-0000-000000000007'

const ALICE_SECRET = 'collections-alice-session-secret-00000001'
const BOB_SECRET = 'collections-bob-session-secret-000000002'
const MAX_SECRET = 'collections-max-session-secret-000000003'

type App = Awaited<ReturnType<(typeof import('../index.js'))['buildApp']>>
type Who = 'alice' | 'bob' | 'max'

let app: App
let admin: pg.Client
const session: Record<Who, string> = { alice: '', bob: '', max: '' }
const SECRETS: Record<Who, string> = { alice: ALICE_SECRET, bob: BOB_SECRET, max: MAX_SECRET }

/** 跨用例传递的夹 id（用例按声明顺序串行执行）。 */
const ids: { public: string; unlisted: string; private: string; paged: string } = {
  public: '',
  unlisted: '',
  private: '',
  paged: '',
}

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

async function seedPhoto(id: string, status: 'published' | 'draft' | 'removed'): Promise<void> {
  await admin.query(
    `insert into public.photos
       (id,author_id,title,category_slug,image_key,thumb_key,width,height,status,published_at,deleted_at)
     values ($1,$2,$3,'landscape',$4,$5,1200,800,$6,$7,$8)
     on conflict (id) do update set
       status=excluded.status, published_at=excluded.published_at, deleted_at=excluded.deleted_at`,
    [
      id,
      ALICE_ID,
      `Col Photo ${id.slice(-1)}`,
      `photos/${ALICE_ID}/${id}/display.webp`,
      `photos/${ALICE_ID}/${id}/thumb.webp`,
      status,
      status === 'published' ? new Date(Date.now() - 3_600_000) : null,
      status === 'removed' ? new Date() : null,
    ],
  )
}

/** 让每个用例从确定状态出发：清掉这三个用户此前的夹与草稿。 */
async function resetOwnData(): Promise<void> {
  await admin.query('delete from public.collections where owner_id = any($1)', [
    [ALICE_ID, BOB_ID, MAX_ID],
  ])
  await admin.query('delete from public.publish_drafts where user_id = any($1)', [
    [ALICE_ID, BOB_ID, MAX_ID],
  ])
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
       ($1,'col-alice@test.local','{"display_name":"Col Alice"}'),
       ($2,'col-bob@test.local','{"display_name":"Col Bob"}'),
       ($3,'col-max@test.local','{"display_name":"Col Max"}')
     on conflict (id) do nothing`,
    [ALICE_ID, BOB_ID, MAX_ID],
  )
  await admin.query(
    `insert into public.profiles (id,username,display_name,visibility,discoverable) values
       ($1,'col_alice','Col Alice','public',true),
       ($2,'col_bob','Col Bob','public',true),
       ($3,'col_max','Col Max','public',true)
     on conflict (id) do update set
       username=excluded.username, display_name=excluded.display_name,
       visibility=excluded.visibility, discoverable=excluded.discoverable, deleted_at=null`,
    [ALICE_ID, BOB_ID, MAX_ID],
  )

  for (const id of PUB_IDS) await seedPhoto(id, 'published')
  await seedPhoto(DRAFT_PHOTO_ID, 'draft')
  await seedPhoto(REMOVED_PHOTO_ID, 'removed')

  await resetOwnData()

  session.alice = await seedSession(ALICE_ID, ALICE_SECRET, 'collections-integration-alice')
  session.bob = await seedSession(BOB_ID, BOB_SECRET, 'collections-integration-bob')
  session.max = await seedSession(MAX_ID, MAX_SECRET, 'collections-integration-max')

  const { buildApp } = await import('../index.js')
  app = await buildApp()
  const who = await app.inject({ method: 'GET', url: '/api/auth/session', headers: readHeaders('alice') })
  assert.equal(who.statusCode, 200, who.body)
  assert.equal(who.json().userId, ALICE_ID)
})

after(async () => {
  await resetOwnData()
  await admin.query('delete from public.photos where id = any($1)', [
    [[...PUB_IDS, DRAFT_PHOTO_ID, REMOVED_PHOTO_ID]],
  ])
  await admin.query('delete from auth.users where id = any($1)', [[ALICE_ID, BOB_ID, MAX_ID]])
  await app?.close()
  await admin?.end()
})

// ============================================================================
// 1. 服务端草稿
// ============================================================================
test('draft: 无草稿返回 null，保存后读回，删除后回到 null', async () => {
  const empty = await app.inject({
    method: 'GET',
    url: '/api/me/publish-draft',
    headers: readHeaders('alice'),
  })
  assert.equal(empty.statusCode, 200, empty.body)
  assert.deepEqual(empty.json(), { payload: null, updatedAt: null })

  const saved = await app.inject({
    method: 'PUT',
    url: '/api/me/publish-draft',
    headers: authHeaders('alice'),
    payload: { payload: { title: '未发布的标题', tags: ['山', '雾'] } },
  })
  assert.equal(saved.statusCode, 200, saved.body)
  assert.ok(saved.json().updatedAt, saved.body)

  const read = await app.inject({
    method: 'GET',
    url: '/api/me/publish-draft',
    headers: readHeaders('alice'),
  })
  assert.equal(read.statusCode, 200, read.body)
  const draft = read.json() as { payload: { title: string; tags: string[] }; updatedAt: string }
  assert.equal(draft.payload.title, '未发布的标题')
  assert.deepEqual(draft.payload.tags, ['山', '雾'])
  assert.ok(Date.parse(draft.updatedAt) > 0)

  // 后写覆盖前写（草稿是「当前状态」而不是历史）。
  const overwritten = await app.inject({
    method: 'PUT',
    url: '/api/me/publish-draft',
    headers: authHeaders('alice'),
    payload: { payload: { title: '改过的标题' } },
  })
  assert.equal(overwritten.statusCode, 200, overwritten.body)
  const after = await app.inject({
    method: 'GET',
    url: '/api/me/publish-draft',
    headers: readHeaders('alice'),
  })
  assert.equal((after.json() as { payload: { title: string } }).payload.title, '改过的标题')

  const cleared = await app.inject({
    method: 'DELETE',
    url: '/api/me/publish-draft',
    headers: authHeaders('alice'),
  })
  assert.equal(cleared.statusCode, 204, cleared.body)
  assert.equal(cleared.body, '')

  const clearedAgain = await app.inject({
    method: 'DELETE',
    url: '/api/me/publish-draft',
    headers: authHeaders('alice'),
  })
  assert.equal(clearedAgain.statusCode, 204, clearedAgain.body)

  const final = await app.inject({
    method: 'GET',
    url: '/api/me/publish-draft',
    headers: readHeaders('alice'),
  })
  assert.deepEqual(final.json(), { payload: null, updatedAt: null })
})

test('draft: 形状与 64KB 护栏、跨用户隔离、匿名 401', async () => {
  const arrayPayload = await app.inject({
    method: 'PUT',
    url: '/api/me/publish-draft',
    headers: authHeaders('alice'),
    payload: { payload: [{ title: '数组不是对象' }] },
  })
  assert.equal(arrayPayload.statusCode, 400, arrayPayload.body)
  assert.equal(arrayPayload.json().code, 'VALIDATION')

  const unknownField = await app.inject({
    method: 'PUT',
    url: '/api/me/publish-draft',
    headers: authHeaders('alice'),
    payload: { payload: { title: 'x' }, extra: 1 },
  })
  assert.equal(unknownField.statusCode, 400, unknownField.body)

  const huge = await app.inject({
    method: 'PUT',
    url: '/api/me/publish-draft',
    headers: authHeaders('alice'),
    payload: { payload: { title: 'x'.repeat(70 * 1024) } },
  })
  assert.equal(huge.statusCode, 400, huge.body)
  assert.match(huge.json().message, /64KB/)

  // 我是 alice，写自己的草稿；bob 读不到（草稿按 auth.uid() 绑定）。
  await app.inject({
    method: 'PUT',
    url: '/api/me/publish-draft',
    headers: authHeaders('alice'),
    payload: { payload: { title: 'alice 的私密草稿' } },
  })
  const bobRead = await app.inject({
    method: 'GET',
    url: '/api/me/publish-draft',
    headers: readHeaders('bob'),
  })
  assert.equal(bobRead.statusCode, 200, bobRead.body)
  assert.deepEqual(bobRead.json(), { payload: null, updatedAt: null })

  const anonymousRead = await app.inject({ method: 'GET', url: '/api/me/publish-draft' })
  assert.equal(anonymousRead.statusCode, 401, anonymousRead.body)
  assert.equal(anonymousRead.json().code, 'UNAUTHORIZED')

  const anonymousWrite = await app.inject({
    method: 'PUT',
    url: '/api/me/publish-draft',
    headers: { origin: ORIGIN, 'x-csrf-token': CSRF },
    payload: { payload: { title: '匿名写' } },
  })
  assert.equal(anonymousWrite.statusCode, 401, anonymousWrite.body)

  // 没有 Origin 的写请求在请求安全层就被挡（403），与草稿逻辑无关但同属交付边界。
  const noOrigin = await app.inject({
    method: 'PUT',
    url: '/api/me/publish-draft',
    headers: { cookie: cookieOf('alice'), 'x-csrf-token': CSRF },
    payload: { payload: { title: '无 origin' } },
  })
  assert.equal(noOrigin.statusCode, 403, noOrigin.body)
})

// ============================================================================
// 2. 收藏夹：创建 / 修改 / 删除
// ============================================================================
test('collections: 建夹默认 private，改标题与可见性生效，删除后 404', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/collections',
    headers: authHeaders('alice'),
    payload: { title: '  我的第一个夹  ' },
  })
  assert.equal(created.statusCode, 200, created.body)
  const collection = created.json() as {
    id: string
    title: string
    description: string
    visibility: string
    ownerUsername: string
    ownerDisplayName: string
  }
  assert.equal(collection.title, '我的第一个夹')
  assert.equal(collection.description, '')
  assert.equal(collection.visibility, 'private')
  assert.equal(collection.ownerUsername, 'col_alice')
  assert.equal(collection.ownerDisplayName, 'Col Alice')

  const patched = await app.inject({
    method: 'PATCH',
    url: `/api/collections/${collection.id}`,
    headers: authHeaders('alice'),
    payload: { title: '改名了', visibility: 'public' },
  })
  assert.equal(patched.statusCode, 200, patched.body)
  const patchedBody = patched.json() as { title: string; visibility: string; description: string }
  assert.equal(patchedBody.title, '改名了')
  assert.equal(patchedBody.visibility, 'public')
  assert.equal(patchedBody.description, '')

  // PATCH 是局部更新：只传 visibility 时标题不能被清空。
  const visibilityOnly = await app.inject({
    method: 'PATCH',
    url: `/api/collections/${collection.id}`,
    headers: authHeaders('alice'),
    payload: { visibility: 'unlisted' },
  })
  assert.equal(visibilityOnly.statusCode, 200, visibilityOnly.body)
  assert.equal((visibilityOnly.json() as { title: string }).title, '改名了')

  const emptyPatch = await app.inject({
    method: 'PATCH',
    url: `/api/collections/${collection.id}`,
    headers: authHeaders('alice'),
    payload: {},
  })
  assert.equal(emptyPatch.statusCode, 400, emptyPatch.body)

  const badVisibility = await app.inject({
    method: 'PATCH',
    url: `/api/collections/${collection.id}`,
    headers: authHeaders('alice'),
    payload: { visibility: 'secret' },
  })
  assert.equal(badVisibility.statusCode, 400, badVisibility.body)

  const longTitle = await app.inject({
    method: 'POST',
    url: '/api/collections',
    headers: authHeaders('alice'),
    payload: { title: 'x'.repeat(41) },
  })
  assert.equal(longTitle.statusCode, 400, longTitle.body)

  const emptyTitle = await app.inject({
    method: 'POST',
    url: '/api/collections',
    headers: authHeaders('alice'),
    payload: { title: '   ' },
  })
  assert.equal(emptyTitle.statusCode, 400, emptyTitle.body)

  const deleted = await app.inject({
    method: 'DELETE',
    url: `/api/collections/${collection.id}`,
    headers: authHeaders('alice'),
  })
  assert.equal(deleted.statusCode, 204, deleted.body)

  const afterDelete = await app.inject({ method: 'GET', url: `/api/collections/${collection.id}` })
  assert.equal(afterDelete.statusCode, 404, afterDelete.body)
  assert.equal(afterDelete.json().code, 'NOT_FOUND')

  // 软删后 id 不再存在：第二次 DELETE 返回 404（资源已不存在），
  // 而「已删除的夹不可读」这一条在详情/列表里各自验证过。
  const secondDelete = await app.inject({
    method: 'DELETE',
    url: `/api/collections/${collection.id}`,
    headers: authHeaders('alice'),
  })
  assert.equal(secondDelete.statusCode, 404, secondDelete.body)
  assert.equal(secondDelete.json().code, 'NOT_FOUND')
})

test('collections: 匿名建夹 401，非本人改删 403', async () => {
  const anonymous = await app.inject({
    method: 'POST',
    url: '/api/collections',
    headers: { origin: ORIGIN, 'x-csrf-token': CSRF },
    payload: { title: '匿名夹' },
  })
  assert.equal(anonymous.statusCode, 401, anonymous.body)
  assert.equal(anonymous.json().code, 'UNAUTHORIZED')

  const created = await app.inject({
    method: 'POST',
    url: '/api/collections',
    headers: authHeaders('alice'),
    payload: { title: 'alice 的夹', visibility: 'private' },
  })
  assert.equal(created.statusCode, 200, created.body)
  ids.private = (created.json() as { id: string }).id

  const bobPatch = await app.inject({
    method: 'PATCH',
    url: `/api/collections/${ids.private}`,
    headers: authHeaders('bob'),
    payload: { title: '偷改' },
  })
  assert.equal(bobPatch.statusCode, 403, bobPatch.body)
  assert.equal(bobPatch.json().code, 'FORBIDDEN')

  const bobDelete = await app.inject({
    method: 'DELETE',
    url: `/api/collections/${ids.private}`,
    headers: authHeaders('bob'),
  })
  assert.equal(bobDelete.statusCode, 403, bobDelete.body)
  assert.equal(bobDelete.json().code, 'FORBIDDEN')

  // 越权失败后原样未变
  const stillMine = await app.inject({
    method: 'GET',
    url: `/api/collections/${ids.private}`,
    headers: readHeaders('alice'),
  })
  assert.equal(stillMine.statusCode, 200, stillMine.body)
  assert.equal((stillMine.json() as { collection: { title: string } }).collection.title, 'alice 的夹')
})

// ============================================================================
// 3. 可见性：private 仅本人 / unlisted 凭 id / 列表过滤
// ============================================================================
test('visibility: private 对他人 404，unlisted 凭 id 可读，列表只给 public', async () => {
  const madePublic = await app.inject({
    method: 'POST',
    url: '/api/collections',
    headers: authHeaders('alice'),
    payload: { title: '公开夹', visibility: 'public' },
  })
  assert.equal(madePublic.statusCode, 200, madePublic.body)
  ids.public = (madePublic.json() as { id: string }).id

  const madeUnlisted = await app.inject({
    method: 'POST',
    url: '/api/collections',
    headers: authHeaders('alice'),
    payload: { title: '隐藏夹', visibility: 'unlisted' },
  })
  assert.equal(madeUnlisted.statusCode, 200, madeUnlisted.body)
  ids.unlisted = (madeUnlisted.json() as { id: string }).id

  // 本人列表：含 private / unlisted / public 三个
  const mine = await app.inject({
    method: 'GET',
    url: '/api/me/collections',
    headers: readHeaders('alice'),
  })
  assert.equal(mine.statusCode, 200, mine.body)
  const mineTitles = (mine.json() as { items: Array<{ title: string }> }).items.map((c) => c.title)
  assert.ok(mineTitles.includes('alice 的夹'), JSON.stringify(mineTitles))
  assert.ok(mineTitles.includes('隐藏夹'), JSON.stringify(mineTitles))
  assert.ok(mineTitles.includes('公开夹'), JSON.stringify(mineTitles))

  // 他人看 alice 的资料页：只有 public（unlisted 不列出，private 更不列）
  const bobView = await app.inject({
    method: 'GET',
    url: '/api/u/col_alice/collections',
    headers: readHeaders('bob'),
  })
  assert.equal(bobView.statusCode, 200, bobView.body)
  const bobTitles = (bobView.json() as { items: Array<{ title: string }> }).items.map((c) => c.title)
  assert.deepEqual(bobTitles, ['公开夹'])

  // 匿名同理
  const anonymousView = await app.inject({ method: 'GET', url: '/api/u/col_alice/collections' })
  assert.equal(anonymousView.statusCode, 200, anonymousView.body)
  assert.deepEqual(
    (anonymousView.json() as { items: Array<{ title: string }> }).items.map((c) => c.title),
    ['公开夹'],
  )

  // 本人看自己的资料页：p_include_private 生效（含 unlisted/private）
  const selfView = await app.inject({
    method: 'GET',
    url: '/api/u/col_alice/collections',
    headers: readHeaders('alice'),
  })
  assert.equal(selfView.statusCode, 200, selfView.body)
  const selfTitles = (selfView.json() as { items: Array<{ title: string }> }).items.map((c) => c.title)
  assert.ok(selfTitles.includes('隐藏夹'), JSON.stringify(selfTitles))

  // private 夹：他人 404（列表拿不到，凭 id 也拿不到）
  for (const who of ['bob'] as const) {
    const detail = await app.inject({
      method: 'GET',
      url: `/api/collections/${ids.private}`,
      headers: readHeaders(who),
    })
    assert.equal(detail.statusCode, 404, detail.body)
    const items = await app.inject({
      method: 'GET',
      url: `/api/collections/${ids.private}/items`,
      headers: readHeaders(who),
    })
    assert.equal(items.statusCode, 404, items.body)
  }
  const anonymousPrivate = await app.inject({ method: 'GET', url: `/api/collections/${ids.private}` })
  assert.equal(anonymousPrivate.statusCode, 404, anonymousPrivate.body)

  // unlisted 夹：凭 id 任何人都能读（登录与匿名都一样）
  for (const headers of [readHeaders('bob'), undefined]) {
    const detail = await app.inject({
      method: 'GET',
      url: `/api/collections/${ids.unlisted}`,
      headers,
    })
    assert.equal(detail.statusCode, 200, detail.body)
    assert.equal(
      (detail.json() as { collection: { visibility: string } }).collection.visibility,
      'unlisted',
    )
  }

  // 不存在的 uuid 与格式非法的 id 分别是 404 / 400
  const missing = await app.inject({
    method: 'GET',
    url: '/api/collections/00000000-0000-0000-0000-000000000000',
  })
  assert.equal(missing.statusCode, 404, missing.body)
  const malformed = await app.inject({ method: 'GET', url: '/api/collections/not-a-uuid' })
  assert.equal(malformed.statusCode, 400, malformed.body)
})

// ============================================================================
// 4. 夹内作品：加入 / 移出 / 私密作品拒绝 / 幂等
// ============================================================================
test('items: 加入与移出幂等，未发布作品不可收藏，非本人 403', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/collections',
    headers: authHeaders('alice'),
    payload: { title: '分页夹', visibility: 'public' },
  })
  assert.equal(created.statusCode, 200, created.body)
  ids.paged = (created.json() as { id: string }).id

  const first = await app.inject({
    method: 'POST',
    url: `/api/collections/${ids.paged}/items`,
    headers: authHeaders('alice'),
    payload: { photoId: PUB_IDS[0] },
  })
  assert.equal(first.statusCode, 200, first.body)
  assert.equal(first.json().itemCount, 1)

  // 重复加入：不报错，数量不变（幂等）
  const again = await app.inject({
    method: 'POST',
    url: `/api/collections/${ids.paged}/items`,
    headers: authHeaders('alice'),
    payload: { photoId: PUB_IDS[0] },
  })
  assert.equal(again.statusCode, 200, again.body)
  assert.equal(again.json().itemCount, 1)

  // 草稿作品：只能收藏已发布作品（400 + 中文文案）
  const draftPhoto = await app.inject({
    method: 'POST',
    url: `/api/collections/${ids.paged}/items`,
    headers: authHeaders('alice'),
    payload: { photoId: DRAFT_PHOTO_ID },
  })
  assert.equal(draftPhoto.statusCode, 400, draftPhoto.body)
  assert.match(draftPhoto.json().message, /只能收藏已发布作品/)

  // 已撤回作品同样拒绝
  const removedPhoto = await app.inject({
    method: 'POST',
    url: `/api/collections/${ids.paged}/items`,
    headers: authHeaders('alice'),
    payload: { photoId: REMOVED_PHOTO_ID },
  })
  assert.equal(removedPhoto.statusCode, 400, removedPhoto.body)

  // 不存在的作品 → 404（作品行不存在）
  const missingPhoto = await app.inject({
    method: 'POST',
    url: `/api/collections/${ids.paged}/items`,
    headers: authHeaders('alice'),
    payload: { photoId: '00000000-0000-0000-0000-0000000000ff' },
  })
  assert.equal(missingPhoto.statusCode, 404, missingPhoto.body)

  // 非本人往别人夹里塞作品 → 403
  const bobAdd = await app.inject({
    method: 'POST',
    url: `/api/collections/${ids.paged}/items`,
    headers: authHeaders('bob'),
    payload: { photoId: PUB_IDS[1] },
  })
  assert.equal(bobAdd.statusCode, 403, bobAdd.body)

  // 移出：幂等（第二次还是 0）
  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/collections/${ids.paged}/items/${PUB_IDS[0]}`,
    headers: authHeaders('alice'),
  })
  assert.equal(removed.statusCode, 200, removed.body)
  assert.equal(removed.json().itemCount, 0)

  const removedAgain = await app.inject({
    method: 'DELETE',
    url: `/api/collections/${ids.paged}/items/${PUB_IDS[0]}`,
    headers: authHeaders('alice'),
  })
  assert.equal(removedAgain.statusCode, 200, removedAgain.body)
  assert.equal(removedAgain.json().itemCount, 0)

  const bobRemove = await app.inject({
    method: 'DELETE',
    url: `/api/collections/${ids.paged}/items/${PUB_IDS[0]}`,
    headers: authHeaders('bob'),
  })
  assert.equal(bobRemove.statusCode, 403, bobRemove.body)
})

test('items: 游标分页不重不漏，卡片带作者字段与 addedAt', async () => {
  for (const photoId of PUB_IDS) {
    const added = await app.inject({
      method: 'POST',
      url: `/api/collections/${ids.paged}/items`,
      headers: authHeaders('alice'),
      payload: { photoId },
    })
    assert.equal(added.statusCode, 200, added.body)
  }

  const seen: string[] = []
  let cursor: string | null = null
  let pages = 0
  for (;;) {
    const url: string = cursor
      ? `/api/collections/${ids.paged}/items?limit=2&cursor=${encodeURIComponent(cursor)}`
      : `/api/collections/${ids.paged}/items?limit=2`
    const page = await app.inject({ method: 'GET', url, headers: readHeaders('alice') })
    assert.equal(page.statusCode, 200, page.body)
    const body = page.json() as {
      items: Array<{
        id: string
        title: string
        authorUsername: string | null
        authorDisplayName: string | null
        addedAt: string | null
        position: number
      }>
      nextCursor: string | null
    }
    pages += 1
    assert.ok(body.items.length <= 2, `limit 失效：${body.items.length}`)
    for (const item of body.items) {
      assert.ok(!seen.includes(item.id), `游标翻页出现重复：${item.id}`)
      assert.equal(item.authorUsername, 'col_alice')
      assert.equal(item.authorDisplayName, 'Col Alice')
      assert.ok(item.addedAt && Date.parse(item.addedAt) > 0, `addedAt 缺失：${item.id}`)
      assert.equal(typeof item.position, 'number')
      seen.push(item.id)
    }
    if (!body.nextCursor) break
    cursor = body.nextCursor
    assert.ok(pages < 10, '翻页没有终止（游标可疑）')
  }
  assert.deepEqual([...seen].sort(), [...PUB_IDS].sort())
  assert.equal(pages, 3) // 5 条 / 每页 2 条

  // 详情首屏与列表页一致：GET /api/collections/:id 带第一页 items 与计数。
  const detail = await app.inject({
    method: 'GET',
    url: `/api/collections/${ids.paged}`,
    headers: readHeaders('alice'),
  })
  assert.equal(detail.statusCode, 200, detail.body)
  const detailBody = detail.json() as {
    collection: { id: string; title: string }
    items: Array<{ id: string }>
    nextCursor: string | null
  }
  assert.equal(detailBody.collection.title, '分页夹')
  assert.equal(detailBody.items.length, 5)
  assert.equal(detailBody.nextCursor, null)

  // 列表里的计数与封面来自同一份可见作品集合
  const listed = await app.inject({
    method: 'GET',
    url: '/api/u/col_alice/collections',
    headers: readHeaders('alice'),
  })
  const mine = (listed.json() as {
    items: Array<{ id: string; itemCount: number; coverPhotoId: string | null }>
  }).items.find((c) => c.id === ids.paged)
  assert.ok(mine, '列表里找不到分页夹')
  assert.equal(mine.itemCount, 5)
  assert.ok(mine.coverPhotoId && PUB_IDS.includes(mine.coverPhotoId as (typeof PUB_IDS)[number]))

  // 坏游标必须 400，而不是静默从头开始
  const badCursor = await app.inject({
    method: 'GET',
    url: `/api/collections/${ids.paged}/items?cursor=%E4%B8%8D%E6%98%AF%E6%B8%B8%E6%A0%87`,
    headers: readHeaders('alice'),
  })
  assert.equal(badCursor.statusCode, 400, badCursor.body)
  assert.equal(badCursor.json().code, 'VALIDATION')
})

// ============================================================================
// 5. 配额：第 31 个夹 422
// ============================================================================
test('quota: 单用户最多 30 个未删除收藏夹，第 31 个 422', async () => {
  for (let index = 1; index <= 30; index += 1) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: authHeaders('max'),
      payload: { title: `配额夹 ${index}` },
    })
    assert.equal(created.statusCode, 200, `第 ${index} 个：${created.body}`)
  }

  const overflow = await app.inject({
    method: 'POST',
    url: '/api/collections',
    headers: authHeaders('max'),
    payload: { title: '配额夹 31' },
  })
  assert.equal(overflow.statusCode, 422, overflow.body)
  assert.equal(overflow.json().code, 'LIMIT_EXCEEDED')
  assert.match(overflow.json().message, /收藏夹数量已达上限/)

  // 删掉一个之后又能建（配额按「未删除」计）
  const listed = await app.inject({
    method: 'GET',
    url: '/api/me/collections',
    headers: readHeaders('max'),
  })
  assert.equal(listed.statusCode, 200, listed.body)
  const all = (listed.json() as { items: Array<{ id: string }> }).items
  assert.equal(all.length, 30)

  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/collections/${all[0]!.id}`,
    headers: authHeaders('max'),
  })
  assert.equal(removed.statusCode, 204, removed.body)

  const reopened = await app.inject({
    method: 'POST',
    url: '/api/collections',
    headers: authHeaders('max'),
    payload: { title: '删一个后新建' },
  })
  assert.equal(reopened.statusCode, 200, reopened.body)
})

test('collections: 未知用户的资料页 404，匿名读 /api/me/collections 401', async () => {
  const unknown = await app.inject({ method: 'GET', url: '/api/u/nobody_here_xyz/collections' })
  assert.equal(unknown.statusCode, 404, unknown.body)
  assert.equal(unknown.json().code, 'NOT_FOUND')

  const anonymous = await app.inject({ method: 'GET', url: '/api/me/collections' })
  assert.equal(anonymous.statusCode, 401, anonymous.body)
  assert.equal(anonymous.json().code, 'UNAUTHORIZED')
})
