import pg from 'pg'
import { hashPassword } from './lib/password.js'

const { Client } = pg

const OWNER_ID = 'a1000000-0000-0000-0000-000000000001'
const OTHER_ID = 'b2000000-0000-0000-0000-000000000002'
const EDITOR_ID = 'd4000000-0000-0000-0000-000000000005'
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
       ($2,'api-other@test.local',$3,'{"display_name":"API Other"}'),
       ($4,'api-editor@test.local',$3,'{"display_name":"API Editor"}')`,
    [OWNER_ID, OTHER_ID, passwordHash, EDITOR_ID],
  )
  await client.query(
    `update public.profiles set username='api_owner', display_name='API Owner' where id=$1`,
    [OWNER_ID],
  )
  await client.query(
    `update public.profiles set username='api_other', display_name='API Other' where id=$1`,
    [OTHER_ID],
  )
  // 8.4d 主题旅程需要一个编辑账号：handle_new_user 触发器已按 email 前缀建好 profile，
  // 这里把它提升为 editor（审核台与主题 Tab 的入口都按 role 判定）。
  await client.query(
    `update public.profiles set username='api_editor', display_name='API Editor', role='editor' where id=$1`,
    [EDITOR_ID],
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

  // 8.4d 主题旅程的起点：一期已在进行中的主题（api-e2e-weekly），
  // 由编辑账号创建、窗口跨过现在，作者可直接投稿、编辑可直接精选。
  await client.query(
    `insert into public.photo_themes
       (slug, title, description, rules, status, starts_at, ends_at, created_by)
     values
       ('api-e2e-weekly', 'API 每周主题', '真实 API 模式的每周主题旅程',
        '一人最多 3 件，需为本人原创。', 'active',
        clock_timestamp() - interval '1 day', clock_timestamp() + interval '7 days', $1)`,
    [EDITOR_ID],
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
    editor: 'api_editor',
    password: PASSWORD,
    photoId: PHOTO_ID,
    withdrawPhotoId: WITHDRAW_PHOTO_ID,
    themeSlug: 'api-e2e-weekly',
  }),
)
