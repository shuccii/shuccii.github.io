-- 匿名コメント・返信・記事ごとのGOOD機能
-- Supabase Dashboard > SQL Editor でこのファイルを一度だけ実行してください。

create extension if not exists pgcrypto;

create table if not exists public.site_comments (
  id uuid primary key default gen_random_uuid(),
  page_id text not null,
  author_name text not null,
  body text not null,
  parent_id uuid references public.site_comments(id) on delete cascade,
  status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists site_comments_page_status_created_idx
  on public.site_comments (page_id, status, created_at);

create table if not exists public.site_likes (
  id bigint generated always as identity primary key,
  page_id text not null,
  voter_key uuid not null,
  created_at timestamptz not null default now(),
  unique (page_id, voter_key)
);

create index if not exists site_likes_page_idx
  on public.site_likes (page_id);

alter table public.site_comments enable row level security;
alter table public.site_likes enable row level security;

revoke all on public.site_comments from anon, authenticated;
revoke all on public.site_likes from anon, authenticated;

create or replace function public.get_site_comments(p_page_id text)
returns table (
  id uuid,
  page_id text,
  author_name text,
  body text,
  parent_id uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.page_id,
    c.author_name,
    c.body,
    c.parent_id,
    c.created_at
  from public.site_comments as c
  where p_page_id ~ '^blog/[[:alnum:]ぁ-んァ-ヶ一-龠々ー%._-]+$'
    and c.page_id = p_page_id
    and c.status = 'approved'
  order by c.created_at asc;
$$;

create or replace function public.submit_site_comment(
  p_page_id text,
  p_author_name text,
  p_body text,
  p_parent_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  normalized_body text := lower(normalize(trim(p_body), NFKC));
  blocked_terms text[] := array[
    '死ね',
    '殺す',
    '消えろ',
    '個人情報晒し',
    '住所特定'
  ];
  blocked_term text;
begin
  if p_page_id !~ '^blog/[[:alnum:]ぁ-んァ-ヶ一-龠々ー%._-]+$' then
    raise exception 'このページには投稿できません';
  end if;

  if char_length(trim(p_author_name)) not between 1 and 40 then
    raise exception '名前は1〜40文字で入力してください';
  end if;

  if char_length(trim(p_body)) not between 1 and 1000 then
    raise exception 'コメントは1〜1000文字で入力してください';
  end if;

  if (select count(*) from regexp_matches(p_body, 'https?://', 'gi')) > 3 then
    raise exception 'コメントに含められるURLは3件までです';
  end if;

  foreach blocked_term in array blocked_terms loop
    if position(lower(normalize(blocked_term, NFKC)) in normalized_body) > 0 then
      raise exception '投稿できない表現が含まれています';
    end if;
  end loop;

  if p_body ~ '(.)\1{19,}' then
    raise exception '同じ文字を過度に繰り返す投稿は送信できません';
  end if;

  if p_parent_id is not null and not exists (
    select 1
    from public.site_comments
    where id = p_parent_id
      and page_id = p_page_id
      and status = 'approved'
  ) then
    raise exception '返信先のコメントが見つかりません';
  end if;

  insert into public.site_comments (
    page_id,
    author_name,
    body,
    parent_id,
    status
  )
  values (
    p_page_id,
    trim(p_author_name),
    trim(p_body),
    p_parent_id,
    'approved'
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.get_site_like_state(
  p_page_id text,
  p_voter_key uuid
)
returns table (like_count bigint, liked boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*)::bigint,
    bool_or(l.voter_key = p_voter_key)
  from public.site_likes as l
  where p_page_id ~ '^blog/[[:alnum:]ぁ-んァ-ヶ一-龠々ー%._-]+$'
    and l.page_id = p_page_id;
$$;

create or replace function public.toggle_site_like(
  p_page_id text,
  p_voter_key uuid
)
returns table (like_count bigint, liked boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_liked boolean;
begin
  if p_page_id !~ '^blog/[[:alnum:]ぁ-んァ-ヶ一-龠々ー%._-]+$' then
    raise exception 'このページにはGOODできません';
  end if;

  delete from public.site_likes
  where page_id = p_page_id and voter_key = p_voter_key;

  if found then
    is_liked := false;
  else
    insert into public.site_likes (page_id, voter_key)
    values (p_page_id, p_voter_key);
    is_liked := true;
  end if;

  return query
  select count(*)::bigint, is_liked
  from public.site_likes
  where page_id = p_page_id;
end;
$$;

revoke execute on function public.get_site_comments(text) from public;
revoke execute on function public.submit_site_comment(text, text, text, uuid) from public;
revoke execute on function public.get_site_like_state(text, uuid) from public;
revoke execute on function public.toggle_site_like(text, uuid) from public;

grant execute on function public.get_site_comments(text) to anon, authenticated;
grant execute on function public.submit_site_comment(text, text, text, uuid) to anon, authenticated;
grant execute on function public.get_site_like_state(text, uuid) to anon, authenticated;
grant execute on function public.toggle_site_like(text, uuid) to anon, authenticated;
