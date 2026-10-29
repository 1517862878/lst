-- 0034：整组替换后回收孤儿图片对象。
--
-- 0033 只覆盖了「撤回作品」这条路（photos 变 removed 时 enqueue_photo_storage_cleanup
-- 会带上封面与所有条目）。但作者在编辑页反复调整组照、删图或重排后删图时，
-- 被替换掉的 image_key/thumb_key 不会进任何队列 —— 对象存储里会留下永久孤儿。
--
-- 本迁移：
--   1) 新增 helper public.enqueue_orphan_photo_keys(uuid, text[])（不给 app_user 执行权）；
--   2) 原地替换 public.api_replace_photo_items（签名、返回值、授权都不变）：
--      清空 photo_items 前记下旧键 → 新条目与封面同步完成后交给 helper 入队，
--      available_at = 现在 + 30 天（与 0020/0033 同款宽限期）。

-- ============================================================================
-- 0. 孤儿键入队helper
-- ============================================================================
-- 单独做成一个 helper（而不是直接把 insert 写进 api_replace_photo_items）：
-- 后者的 RETURNS TABLE 里有名为 photo_id 的输出列，函数体里任何不带表别名的
-- photo_id 都会被 PL/pgSQL 判成「字段关联 photo_id 是不明确的」。helper 的
-- 返回值是 integer，没有输出参数，列名解析没有歧义。
create or replace function public.enqueue_orphan_photo_keys(
  p_photo_id uuid,
  p_keys text[]
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_count integer := 0;
begin
  if p_keys is null or array_length(p_keys, 1) is null then
    return 0;
  end if;

  -- 旧键里仍被本作品引用的一律不删：留下的条目、封面、缩略图都算「在用」。
  -- (photo_id, object_key) 唯一约束保证重复替换、重复迁移都不会制造重复任务。
  insert into public.photo_storage_cleanup_jobs (photo_id, object_key, available_at)
  select p_photo_id, k, clock_timestamp() + interval '30 days'
    from unnest(p_keys) as k
   where k is not null
     and k <> ''
     and not exists (
       select 1 from public.photo_items i
        where i.photo_id = p_photo_id
          and (i.image_key = k or i.thumb_key = k)
     )
     and not exists (
       select 1 from public.photos p
        where p.id = p_photo_id
          and (p.image_key = k or p.thumb_key = k)
     )
  on conflict (photo_id, object_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 只允许由 api_replace_photo_items（security definer）内部调用
revoke all on function public.enqueue_orphan_photo_keys(uuid, text[]) from public, app_user;

create or replace function public.api_replace_photo_items(
  p_photo_id uuid,
  p_actor_id uuid,
  p_items jsonb
)
returns table(photo_id uuid, item_count integer)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_photo public.photos;
  v_prefix text;
  v_total integer;
  v_index integer;
  v_item jsonb;
  v_image_key text;
  v_thumb_key text;
  v_slot text;
  v_caption text;
  v_count integer;
  v_old_keys text[];
begin
  if v_uid is null then
    raise exception '必须登录后修改组照' using errcode = '42501';
  end if;
  -- p_actor_id 只用于与 auth.uid() 交叉校验；授权判据永远是会话身份，
  -- 不能让调用方自称是作者（与 0032 的 api_set_comments_locked 同款）。
  if p_actor_id is null or p_actor_id <> v_uid then
    raise exception '不能替他人修改作品组照' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items 必须是数组' using errcode = '22023';
  end if;

  select * into v_photo
  from public.photos p
  where p.id = p_photo_id
  for update;
  if not found then
    raise exception '作品不存在' using errcode = 'P0002';
  end if;
  if v_photo.author_id <> v_uid then
    -- 他人的作品一律 42501（与 0020 的 api_remove_photo 同款：不暴露存在性以外的信息，
    -- 但路由层已经把「作品不存在」变成 404，这里只可能是别人的作品）。
    raise exception '无权修改该作品的组照' using errcode = '42501';
  end if;
  if v_photo.deleted_at is not null or v_photo.status = 'removed' then
    raise exception '作品已撤回，不能再修改组照' using errcode = 'P0002';
  end if;

  v_total := jsonb_array_length(p_items);
  if v_total > 9 then
    raise exception '一件作品最多 9 张图' using errcode = '23514';
  end if;

  v_prefix := 'photos/' || v_uid::text || '/' || p_photo_id::text || '/';

  -- 第一轮：全量校验，一行都不写。任何一条不合法都整体失败，
  -- 不允许「改了 3 条再报错」这种半成品状态（整组替换必须是原子的）。
  for v_index in 0 .. v_total - 1 loop
    v_item := p_items -> v_index;
    if v_item is null or jsonb_typeof(v_item) <> 'object' then
      raise exception '第 % 张图的数据格式不正确', v_index + 1 using errcode = '22023';
    end if;
    if jsonb_typeof(v_item -> 'imageKey') is distinct from 'string'
       or jsonb_typeof(v_item -> 'thumbKey') is distinct from 'string'
       or jsonb_typeof(v_item -> 'width') is distinct from 'number'
       or jsonb_typeof(v_item -> 'height') is distinct from 'number' then
      raise exception '第 % 张图缺少 imageKey/thumbKey/width/height', v_index + 1 using errcode = '22023';
    end if;

    v_image_key := btrim(v_item ->> 'imageKey');
    v_thumb_key := btrim(v_item ->> 'thumbKey');

    -- 键必须落在「本人 / 本作品」目录内，且 display 与 thumb 指向同一个槽位。
    -- 槽位 = 旧的封面位置（/display.webp）或组照槽位（/items/{0-8}/display.webp）；
    -- 后者要支持，是因为 0033 之后的感觉流是「先 PUT 到 items 槽位，再创建作品」。
    if v_image_key !~ ('^' || v_prefix || '(items/[0-8]/)?display\.webp$')
       or v_thumb_key !~ ('^' || v_prefix || '(items/[0-8]/)?thumb\.webp$') then
      raise exception '第 % 张图的图片键不属于当前作品的条目槽位', v_index + 1 using errcode = '42501';
    end if;
    v_slot := replace(v_image_key, '/display.webp', '');
    if v_slot <> replace(v_thumb_key, '/thumb.webp', '') then
      raise exception '第 % 张图的封面键与缩略图键不匹配', v_index + 1 using errcode = '22023';
    end if;

    if (v_item ->> 'width')::numeric < 1 or (v_item ->> 'width')::numeric > 40000
       or (v_item ->> 'height')::numeric < 1 or (v_item ->> 'height')::numeric > 40000
       or (v_item ->> 'width')::numeric <> trunc((v_item ->> 'width')::numeric)
       or (v_item ->> 'height')::numeric <> trunc((v_item ->> 'height')::numeric) then
      raise exception '第 % 张图的宽高必须是正整数', v_index + 1 using errcode = '22023';
    end if;

    if v_item -> 'blurhash' is not null
       and jsonb_typeof(v_item -> 'blurhash') <> 'null'
       and jsonb_typeof(v_item -> 'blurhash') <> 'string' then
      raise exception '第 % 张图的 blurhash 必须是字符串或 null', v_index + 1 using errcode = '22023';
    end if;

    if v_item -> 'caption' is not null
       and jsonb_typeof(v_item -> 'caption') <> 'null'
       and jsonb_typeof(v_item -> 'caption') <> 'string' then
      raise exception '第 % 张图的说明必须是字符串', v_index + 1 using errcode = '22023';
    end if;
    v_caption := btrim(coalesce(v_item ->> 'caption', ''));
    if char_length(v_caption) > 200 then
      raise exception '第 % 张图的说明最多 200 字', v_index + 1 using errcode = '23514';
    end if;
  end loop;

  -- 第二轮：清空重建。
  -- 先把旧条目的键记下来：整组替换会把不再被引用的对象变成孤儿。
  select coalesce(array_agg(keys.k), '{}'::text[]) into v_old_keys
    from (
      select i.image_key as k from public.photo_items i where i.photo_id = p_photo_id
      union
      select i.thumb_key as k from public.photo_items i where i.photo_id = p_photo_id
    ) as keys;

  delete from public.photo_items where photo_items.photo_id = p_photo_id;

  for v_index in 0 .. v_total - 1 loop
    v_item := p_items -> v_index;
    insert into public.photo_items (
      photo_id, position, image_key, thumb_key, width, height, blurhash, caption
    ) values (
      p_photo_id,
      v_index,
      btrim(v_item ->> 'imageKey'),
      btrim(v_item ->> 'thumbKey'),
      (v_item ->> 'width')::integer,
      (v_item ->> 'height')::integer,
      nullif(btrim(coalesce(v_item ->> 'blurhash', '')), ''),
      btrim(coalesce(v_item ->> 'caption', ''))
    );
  end loop;

  -- 封面同步：photos.image_key 等继续表示 position 0 那张（所有既有查询零改动）。
  -- 空数组 = 退回单图：刻意不动 image_key —— 上一轮的封面文件还在，仍然有效，
  -- 前端也因此不会出现「图片变空」的瞬间。
  if v_total > 0 then
    update public.photos p
       set image_key = i.image_key,
           thumb_key = i.thumb_key,
           width = i.width,
           height = i.height,
           blurhash = i.blurhash
      from public.photo_items i
     where i.photo_id = p_photo_id
       and i.position = 0
       and p.id = p_photo_id;
  end if;

  -- 封面同步之后再回收：此刻「谁还在用」的判据是最新的
  -- （空数组回退单图时封面刻意不变，那一张必须被保住）。
  perform public.enqueue_orphan_photo_keys(p_photo_id, v_old_keys);

  select count(*)::integer into v_count from public.photo_items i where i.photo_id = p_photo_id;

  return query select p_photo_id, v_count;
end;
$$;

-- 自检：函数仍然是 security definer，app_user 的执行权没变，helper 不对 app_user 开放。
do $$
begin
  if not (select prosecdef from pg_proc where proname = 'api_replace_photo_items') then
    raise exception '0034 自检失败：api_replace_photo_items 不再是 security definer';
  end if;
  if not has_function_privilege('app_user', 'public.api_replace_photo_items(uuid,uuid,jsonb)', 'execute') then
    raise exception '0034 自检失败：app_user 失去了 api_replace_photo_items 的执行权';
  end if;
  if has_function_privilege('app_user', 'public.enqueue_orphan_photo_keys(uuid,text[])', 'execute') then
    raise exception '0034 自检失败：helper 不应对 app_user 开放执行权';
  end if;
  raise notice 'OK: 0034 组照孤儿回收已就位';
end;
$$;
