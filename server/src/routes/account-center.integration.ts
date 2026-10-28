import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { after, before } from 'node:test'
import pg from 'pg'
import { hashPassword, verifyPassword } from '../lib/password.js'

const { Client } = pg
const ORIGIN = 'http://127.0.0.1:5173'
const OWNER_ID = 'd4000000-0000-0000-0000-000000000004'
const OTHER_ID = 'e5000000-0000-0000-0000-000000000005'
const DELETE_ID = 'f6000000-0000-0000-0000-000000000006'
const OWNER_SECRET = 'account-owner-session-secret-long-enough-0004'
const OTHER_SECRET = 'account-other-session-secret-long-enough-0005'
const DELETE_SECRET = 'account-delete-session-secret-long-enough-0006'
const CSRF = 'csrf-token-for-account-center-integration'
const OLD_PASSWORD = 'OldPassword!123'

let app: Awaited<ReturnType<(typeof import('../index.js'))['buildApp']>>
let admin: pg.Client
let appDb: pg.Client
let ownerSessionId = ''
let otherSessionId = ''
let deleteSessionId = ''

function tokenHash(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

function headers(sessionId: string, secret: string) {
  return {
    origin: ORIGIN,
    cookie: `gk_session=${sessionId}.${secret}; gy_csrf=${CSRF}`,
    'x-csrf-token': CSRF,
  }
}

async function seedSession(userId: string, secret: string): Promise<string> {
  const result = await admin.query<{ session_id: string }>(
    `select session_id from public.api_create_session($1,$2,now() + interval '1 hour',$3,$4)`,
    [userId, tokenHash(secret), 'account-center-integration', 'integration-ip'],
  )
  return result.rows[0]!.session_id
}

before(async () => {
  process.env.STORAGE_CLEANUP_ENABLED = 'false'
  admin = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGADMIN_USER ?? 'postgres',
    password: process.env.PGADMIN_PASSWORD,
  })
  appDb = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  })
  await admin.connect()
  await appDb.connect()
  const passwordHash = await hashPassword(OLD_PASSWORD)
  await admin.query(
    `insert into auth.users (id,email,phone,password_hash,raw_user_meta_data) values
      ($1,'account-owner@test.local','13800000004',$4,'{"display_name":"Account Owner"}'),
      ($2,'account-other@test.local','13800000005',$4,'{"display_name":"Account Other"}'),
      ($3,'account-delete@test.local','13800000006',$4,'{"display_name":"Account Delete"}')
     on conflict (id) do update set password_hash=excluded.password_hash, phone=excluded.phone,
       email=excluded.email`,

    [OWNER_ID, OTHER_ID, DELETE_ID, passwordHash],
  )
  await admin.query(
    `insert into public.profiles
       (id,username,display_name,visibility,discoverable,show_likes,show_favorites) values
       ($1,'account_owner','Account Owner','public',false,true,false),
       ($2,'account_other','Account Other','private',true,false,true),
       ($3,'account_delete','Account Delete','public',true,true,true)
     on conflict (id) do update set username=excluded.username,display_name=excluded.display_name,
       visibility=excluded.visibility,discoverable=excluded.discoverable,deleted_at=null`,
    [OWNER_ID, OTHER_ID, DELETE_ID],
  )
  ownerSessionId = await seedSession(OWNER_ID, OWNER_SECRET)
  otherSessionId = await seedSession(OTHER_ID, OTHER_SECRET)
  deleteSessionId = await seedSession(DELETE_ID, DELETE_SECRET)
  const { buildApp } = await import('../index.js')
  app = await buildApp()
})

after(async () => {
  await app?.close()
  await appDb?.end()
  await admin?.end()
})

test('legacy arbitrary-user password API is not executable by app_user', async () => {
  const privilege = await admin.query<{ allowed: boolean }>(
    `select has_function_privilege('app_user','public.api_set_password(uuid,text)','EXECUTE') allowed`,
  )
  assert.equal(privilege.rows[0]?.allowed, false)
  await assert.rejects(
    appDb.query('select public.api_set_password($1,$2)', [OTHER_ID, 'forbidden-hash']),
    /permission denied|权限不够|没有权限/,
  )
})

test('profile UUID route is closed and public username response does not leak id', async () => {
  const bypass = await app.inject({ method: 'GET', url: `/api/profiles/${OWNER_ID}` })
  assert.equal(bypass.statusCode, 404, bypass.body)

  const publicProfile = await app.inject({ method: 'GET', url: '/api/profiles/by-username/account_owner' })
  assert.equal(publicProfile.statusCode, 200, publicProfile.body)
  assert.equal(Object.hasOwn(publicProfile.json(), 'id'), false)
  assert.equal(publicProfile.json().discoverable, false)
  assert.equal(publicProfile.json().showLikes, true)
  assert.equal(publicProfile.json().showFavorites, false)

  const hidden = await app.inject({ method: 'GET', url: '/api/profiles/by-username/account_other' })
  assert.equal(hidden.statusCode, 404, hidden.body)
  const ownerView = await app.inject({
    method: 'GET', url: '/api/profiles/by-username/account_other',
    headers: { cookie: `gk_session=${otherSessionId}.${OTHER_SECRET}` },
  })
  assert.equal(ownerView.statusCode, 200, ownerView.body)
  assert.equal(ownerView.json().isOwner, true)
})

test('profile and preferences use strict full PUT schemas', async () => {
  const auth = headers(ownerSessionId, OWNER_SECRET)
  const incomplete = await app.inject({
    method: 'PUT', url: '/api/me/profile', headers: auth,
    payload: { displayName: 'Changed' },
  })
  assert.equal(incomplete.statusCode, 400, incomplete.body)

  for (const links of [
    [{ label: 'Site', url: 'http://example.com' }],
    [{ label: 'Site', url: 'https://user:pass@example.com' }],
    [{ label: 'Site', url: 'https://example.com', extra: true }],
  ]) {
    const response = await app.inject({
      method: 'PUT', url: '/api/me/profile', headers: auth,
      payload: { displayName: 'Account Owner', bio: '', links, licensePreference: 'cc_by', avatarKey: null },
    })
    assert.equal(response.statusCode, 400, response.body)
  }

  const wrongAvatar = await app.inject({
    method: 'PUT', url: '/api/me/profile', headers: auth,
    payload: { displayName: 'Account Owner', bio: '', links: [], licensePreference: 'cc_by', avatarKey: `avatars/${OTHER_ID}/avatar.webp` },
  })
  assert.equal(wrongAvatar.statusCode, 400, wrongAvatar.body)

  const updated = await app.inject({
    method: 'PUT', url: '/api/me/profile', headers: auth,
    payload: {
      displayName: 'Account Owner Updated', bio: 'strict schema',
      links: [{ label: 'Site', url: 'https://example.com/profile' }],
      licensePreference: 'cc_by', avatarKey: `avatars/${OWNER_ID}/avatar.webp`,
    },
  })
  assert.equal(updated.statusCode, 200, updated.body)

  const badPreferences = await app.inject({
    method: 'PUT', url: '/api/me/preferences', headers: auth,
    payload: {
      visibility: 'public', showLikes: true, showFavorites: false, discoverable: true,
      notificationPreferences: { accountSecurity: true },
    },
  })
  assert.equal(badPreferences.statusCode, 400, badPreferences.body)

  const preferences = await app.inject({
    method: 'PUT', url: '/api/me/preferences', headers: auth,
    payload: {
      visibility: 'private', showLikes: false, showFavorites: true, discoverable: false,
      notificationPreferences: { accountSecurity: true, productUpdates: false },
    },
  })
  assert.equal(preferences.statusCode, 200, preferences.body)
  assert.equal(preferences.json().visibility, 'private')
  assert.deepEqual(preferences.json().notificationPreferences, { accountSecurity: true, productUpdates: false })
})

test('authenticated password change targets only auth.uid and revokes sessions', async () => {
  const beforeOther = await admin.query<{ password_hash: string }>('select password_hash from auth.users where id=$1', [OTHER_ID])
  const response = await app.inject({
    method: 'PATCH', url: '/api/me/password', headers: headers(ownerSessionId, OWNER_SECRET),
    payload: { oldPassword: OLD_PASSWORD, newPassword: 'NewPassword!456' },
  })
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json().reloginRequired, true)

  const rows = await admin.query<{ id: string; password_hash: string }>(
    'select id,password_hash from auth.users where id in ($1,$2) order by id', [OWNER_ID, OTHER_ID],
  )
  const owner = rows.rows.find((row) => row.id === OWNER_ID)!
  const other = rows.rows.find((row) => row.id === OTHER_ID)!
  assert.equal(await verifyPassword(owner.password_hash, 'NewPassword!456'), true)
  assert.equal(other.password_hash, beforeOther.rows[0]?.password_hash)
  const session = await admin.query<{ revoked_at: Date | null }>('select revoked_at from public.security_sessions where id=$1', [ownerSessionId])
  assert.ok(session.rows[0]?.revoked_at)
})

test('account deletion anonymizes identity and content boundary while retaining audit event', async () => {
  const photoId = 'a7000000-0000-0000-0000-000000000007'
  await admin.query(
    `insert into public.photos
       (id,author_id,title,description,category_slug,image_key,thumb_key,width,height,status,published_at)
     values ($1,$2,'Delete title','Delete description','landscape',$3,$4,100,100,'published',now())`,
    [photoId, DELETE_ID, `photos/${DELETE_ID}/${photoId}/display.webp`, `photos/${DELETE_ID}/${photoId}/thumb.webp`],
  )
  await admin.query('insert into public.likes(user_id,photo_id) values($1,$2)', [DELETE_ID, photoId])
  await admin.query('insert into public.favorites(user_id,photo_id) values($1,$2)', [DELETE_ID, photoId])

  const response = await app.inject({
    method: 'DELETE', url: '/api/me/account', headers: headers(deleteSessionId, DELETE_SECRET),
    payload: { password: OLD_PASSWORD, confirm: '注销账号', reason: 'integration' },
  })
  assert.equal(response.statusCode, 204, response.body)

  const profile = await admin.query('select username,display_name,phone,visibility,discoverable,deleted_at from public.profiles where id=$1', [DELETE_ID])
  assert.match(profile.rows[0].username, /^del_[0-9a-f]{16}$/)
  assert.equal(profile.rows[0].phone, null)
  assert.equal(profile.rows[0].visibility, 'private')
  assert.equal(profile.rows[0].discoverable, false)
  assert.ok(profile.rows[0].deleted_at)

  const auth = await admin.query('select email,phone,password_hash,raw_user_meta_data from auth.users where id=$1', [DELETE_ID])
  assert.equal(auth.rows[0].email, null)
  assert.equal(auth.rows[0].phone, null)
  assert.equal(auth.rows[0].password_hash, null)
  assert.deepEqual(auth.rows[0].raw_user_meta_data, {})

  const content = await admin.query('select title,description,status,deleted_at from public.photos where id=$1', [photoId])
  assert.equal(content.rows[0].status, 'removed')
  assert.equal(content.rows[0].description, '')
  assert.ok(content.rows[0].deleted_at)
  const interactions = await admin.query(
    'select (select count(*) from public.likes where user_id=$1)::int likes, (select count(*) from public.favorites where user_id=$1)::int favorites',
    [DELETE_ID],
  )
  assert.equal(interactions.rows[0].likes, 0)
  assert.equal(interactions.rows[0].favorites, 0)
  const audit = await admin.query('select username_snapshot,reason from public.account_deletion_events where user_id=$1', [DELETE_ID])
  assert.equal(audit.rows.length, 1)
  assert.equal(audit.rows[0].username_snapshot, 'account_delete')
  assert.equal(audit.rows[0].reason, 'integration')
})
