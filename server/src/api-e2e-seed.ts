import pg from 'pg'
import { hashPassword } from './lib/password.js'

const { Client } = pg

const OWNER_ID = 'a1000000-0000-0000-0000-000000000001'
const OTHER_ID = 'b2000000-0000-0000-0000-000000000002'
const PHOTO_ID = 'c3000000-0000-0000-0000-000000000003'
// 第二个作品专供「撤回」这条破坏性流程使用。photo-owner.spec 会把它撤回到 removed，
// 而 social.spec 需要确保动态流里有一件*始终已发布*的作品（Playwright 按文件名顺序跑，
// photo-owner 先跑）。两件作品分开，两个套件才能在同一次运行里都对。
const WITHDRAW_PHOTO_ID = 'c3000000-0000-0000-0000-000000000004'
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
  await client.query(
    `insert into public.photos
       (id,author_id,title,description,category_slug,tags,location_name,image_key,thumb_key,
        width,height,status,published_at)
     values ($1,$2,'API 待撤回作品','供撤回流程使用','landscape',array['api-e2e'],
       '测试地点',$3,$4,1200,800,'published',clock_timestamp())`,
    [
      WITHDRAW_PHOTO_ID,
      OWNER_ID,
      `api-e2e/${OWNER_ID}/${WITHDRAW_PHOTO_ID}/display.webp`,
      `api-e2e/${OWNER_ID}/${WITHDRAW_PHOTO_ID}/thumb.webp`,
    ],
  )
  // 8.3c 发现增强：把主作品设为编辑精选，并造 3 条同词搜索日志，
  // 让「编辑精选」区块与「热门搜索」在真实 API 模式下有确定数据可断言。
  await client.query('update public.photos set featured_at = clock_timestamp() where id = $1', [
    PHOTO_ID,
  ])
  await client.query(
    `insert into public.search_logs (term, term_key, ip_hash, created_at) values
       ('山','山','seed-ip-1', clock_timestamp() - interval '2 hours'),
       ('山','山','seed-ip-2', clock_timestamp() - interval '1 hour'),
       ('山','山','seed-ip-3', clock_timestamp() - interval '10 minutes')`,
  )

  await client.query('commit')
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  await client.end()
}

console.log(
  JSON.stringify({
    owner: 'api_owner',
    other: 'api_other',
    password: PASSWORD,
    photoId: PHOTO_ID,
    withdrawPhotoId: WITHDRAW_PHOTO_ID,
  }),
)
