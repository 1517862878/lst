import pg from 'pg'
import { hashPassword } from './lib/password.js'

const { Client } = pg

const OWNER_ID = 'a1000000-0000-0000-0000-000000000001'
const OTHER_ID = 'b2000000-0000-0000-0000-000000000002'
const PHOTO_ID = 'c3000000-0000-0000-0000-000000000003'
const PASSWORD = 'ApiE2e-pass-2026'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`API E2E 缺少环境变量 ${name}`)
  return value
}

const client = new Client({
  host: required('PGHOST'),
  port: Number(process.env.PGPORT ?? 5432),
  database: required('PGDATABASE'),
  user: required('PGADMIN_USER'),
  password: required('PGADMIN_PASSWORD'),
})

await client.connect()
try {
  const passwordHash = await hashPassword(PASSWORD)
  await client.query('begin')
  await client.query(
    `insert into auth.users (id,email,password_hash,raw_user_meta_data) values
       ($1,'api-owner@test.local',$3,'{"display_name":"API Owner"}'),
       ($2,'api-other@test.local',$3,'{"display_name":"API Other"}')`,
    [OWNER_ID, OTHER_ID, passwordHash],
  )
  await client.query(
    `update public.profiles set username='api_owner', display_name='API Owner' where id=$1`,
    [OWNER_ID],
  )
  await client.query(
    `update public.profiles set username='api_other', display_name='API Other' where id=$1`,
    [OTHER_ID],
  )
  await client.query(
    `insert into public.photos
       (id,author_id,title,description,category_slug,tags,location_name,image_key,thumb_key,
        width,height,status,published_at)
     values ($1,$2,'API 原标题','真实 API 浏览器旅程','landscape',array['api-e2e'],
       '测试地点',$3,$4,1200,800,'published',clock_timestamp())`,
    [
      PHOTO_ID,
      OWNER_ID,
      `api-e2e/${OWNER_ID}/${PHOTO_ID}/display.webp`,
      `api-e2e/${OWNER_ID}/${PHOTO_ID}/thumb.webp`,
    ],
  )
  await client.query('commit')
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  await client.end()
}

console.log(JSON.stringify({ owner: 'api_owner', other: 'api_other', password: PASSWORD, photoId: PHOTO_ID }))
