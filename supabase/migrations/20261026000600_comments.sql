-- ============================================================================
-- 工科影展 · 0006 comments：评论（仅一级回复）
-- 依据：docs/DATA-MODEL.md §3.4
-- 要点：
--   1) parent_id 只允许指向顶层评论（不做盖楼），用触发器强制
--   2) 软删保留占位（status='removed' + deleted_at），前端显示"该评论已删除"
--   3) comment_count 由触发器重算（只算 visible）
-- ============================================================================

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  photo_id   uuid not null references public.photos (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  parent_id  uuid references public.comments (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  status     text not null default 'visible'
               check (status in ('visible', 'hidden', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.comments is '评论；仅一级回复（parent_id 只能指向顶层评论）；软删保留占位';

create index if not exists idx_comments_photo  on public.comments (photo_id, created_at);
create index if not exists idx_comments_author on public.comments (author_id);
create index if not exists idx_comments_parent on public.comments (parent_id);

-- ---- updated_at ----
drop trigger if exists trg_comments_updated_at on public.comments;
create trigger trg_comments_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 禁止盖楼：parent_id 必须指向"同一作品下的顶层评论"
-- 为什么放数据库层：前端已有约束，但直接调 API 可绕过；这是数据完整性红线
-- ----------------------------------------------------------------------------
create or replace function public.enforce_single_level_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_parent uuid;
  parent_photo  uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select c.parent_id, c.photo_id
    into parent_parent, parent_photo
    from public.comments c
   where c.id = new.parent_id;

  if not found then
    raise exception 'parent_id % 对应的评论不存在', new.parent_id
      using errcode = 'foreign_key_violation';
  end if;

  if parent_parent is not null then
    raise exception '不支持多级回复：parent_id 必须指向顶层评论'
      using errcode = 'check_violation';
  end if;

  if parent_photo <> new.photo_id then
    raise exception '父评论不属于同一作品（父作品 %，当前 %）', parent_photo, new.photo_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_single_level_reply() is '强制一级回复：parent 必须是同作品的顶层评论';

drop trigger if exists trg_comments_single_level on public.comments;
create trigger trg_comments_single_level
  before insert or update of parent_id on public.comments
  for each row execute function public.enforce_single_level_reply();

-- ----------------------------------------------------------------------------
-- 软删规范化：status='removed' 时自动补 deleted_at
-- ----------------------------------------------------------------------------
create or replace function public.set_comment_deleted_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'removed' and new.deleted_at is null then
    new.deleted_at := now();
  end if;
  if new.status <> 'removed' then
    new.deleted_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_comments_soft_delete on public.comments;
create trigger trg_comments_soft_delete
  before insert or update of status on public.comments
  for each row execute function public.set_comment_deleted_at();

-- ----------------------------------------------------------------------------
-- comment_count 重算（只统计 visible）
-- ----------------------------------------------------------------------------
create or replace function public.recount_photo_comments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_photo uuid;
begin
  target_photo := coalesce(new.photo_id, old.photo_id);

  update public.photos p
     set comment_count = (
           select count(*) from public.comments
            where photo_id = target_photo
              and status = 'visible'
              and deleted_at is null
         )
   where p.id = target_photo;

  return null;
end;
$$;

comment on function public.recount_photo_comments() is '评论变动后重算 photos.comment_count（只算 visible 且未删）';

drop trigger if exists trg_comments_recount on public.comments;
create trigger trg_comments_recount
  after insert or delete or update of status on public.comments
  for each row execute function public.recount_photo_comments();
