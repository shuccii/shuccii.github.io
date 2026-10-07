-- 3件のセキュリティ修正。管理者SQL Editorで全文を一度に実行する。
-- 元ファイル変更時は同じ順序で再生成し、test:securityで一致を検証する。
begin;
-- Source: write-limits.sql
-- comments.sql / private-feedback.sql / visits.sql より先に適用する。
-- 匿名利用者が変更できない、サイト全体の書き込み予算。
create schema if not exists site_private;
revoke all on schema site_private from public, anon, authenticated;

create table if not exists site_private.write_events (
  action text not null check (action in ('comment', 'like', 'feedback', 'visit')),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists write_events_action_created_idx
  on site_private.write_events (action, created_at);
alter table site_private.write_events enable row level security;
revoke all on site_private.write_events from public, anon, authenticated;

-- RPCの所有者だけが、固定action名で呼ぶ。ブラウザ識別子は使わない。
-- ロックは成功したINSERTまで同じトランザクションで保持する。
create or replace function site_private.allow_site_write(p_action text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  minute_limit integer;
  day_limit integer;
  row_limit integer;
  stored_rows bigint;
  v_now timestamptz := clock_timestamp();
begin
  case p_action
    when 'comment' then minute_limit := 10; day_limit := 100; row_limit := 20000;
    when 'like' then minute_limit := 60; day_limit := 1000; row_limit := 100000;
    when 'feedback' then minute_limit := 5; day_limit := 50; row_limit := 10000;
    when 'visit' then minute_limit := 120; day_limit := 5000; row_limit := 250000;
    else raise exception 'unknown write action';
  end case;

  -- 同時呼び出しは待機せず拒否する。UUID・page_idを変えても同じロック。
  if not pg_catalog.pg_try_advisory_xact_lock(178314, pg_catalog.hashtext(p_action)) then
    return false;
  end if;
  delete from site_private.write_events
  where action = p_action and created_at < v_now - interval '24 hours';
  if (select count(*) from site_private.write_events
      where action = p_action and created_at >= v_now - interval '1 minute') >= minute_limit
    or (select count(*) from site_private.write_events where action = p_action) >= day_limit then
    return false;
  end if;

  -- 長期間続けても保存件数が無制限に増えない。既存データは削除しない。
  case p_action
    when 'comment' then select count(*) into stored_rows from public.site_comments;
    -- GOOD解除は満杯でも許可する。追加側だけtoggle関数内で同じロック下に検査。
    when 'like' then stored_rows := 0;
    when 'feedback' then select count(*) into stored_rows from public.site_feedback;
    when 'visit' then select count(*) into stored_rows from public.site_visits;
  end case;
  if stored_rows >= row_limit then return false; end if;

  insert into site_private.write_events (action, created_at) values (p_action, v_now);
  return true;
end;
$$;
revoke all on function site_private.allow_site_write(text) from public, anon, authenticated;

-- Source: comments.sql
-- 先に write-limits.sql を適用してください。
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
  order by c.created_at asc, c.id
  limit 500;
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

  if not site_private.allow_site_write('comment') then
    raise exception '投稿が混み合っています。時間を置いてからお試しください';
  end if;

  if (select count(*) from public.site_comments where page_id = p_page_id) >= 500 then
    raise exception 'この記事のコメント受付は上限に達しました';
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

  if p_voter_key is null then raise exception 'GOODの識別子が正しくありません'; end if;
  if not site_private.allow_site_write('like') then
    raise exception 'GOODが混み合っています。時間を置いてからお試しください';
  end if;

  delete from public.site_likes
  where page_id = p_page_id and voter_key = p_voter_key;

  if found then
    is_liked := false;
  else
    if (select count(*) from public.site_likes) >= 100000 then
      raise exception 'GOODの受付が混み合っています。時間を置いてからお試しください';
    end if;
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

-- Source: private-feedback.sql
-- 先に write-limits.sql を適用してください。
-- 管理者だけが読める非公開の意見ボックス
-- Supabase Dashboard > SQL Editor で comments.sql の後に実行してください。

create extension if not exists pgcrypto;

create table if not exists public.site_feedback (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'other'
    check (category in ('improvement', 'topic', 'impression', 'other')),
  author_name text not null default '匿名',
  body text not null,
  status text not null default 'new'
    check (status in ('new', 'read', 'archived')),
  created_at timestamptz not null default now()
);

create index if not exists site_feedback_status_created_idx
  on public.site_feedback (status, created_at desc);

create table if not exists public.site_feedback_rate_limits (
  id bigint generated always as identity primary key,
  client_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists site_feedback_rate_limits_client_created_idx
  on public.site_feedback_rate_limits (client_hash, created_at desc);

alter table public.site_feedback enable row level security;
alter table public.site_feedback_rate_limits enable row level security;
revoke all on public.site_feedback from anon, authenticated;
revoke all on public.site_feedback_rate_limits from anon, authenticated;

drop function if exists public.submit_private_feedback(text, text, text);

create or replace function public.submit_private_feedback(
  p_category text,
  p_author_name text,
  p_body text,
  p_client_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  clean_author text := coalesce(nullif(trim(p_author_name), ''), '匿名');
  normalized_body text := lower(normalize(trim(p_body), NFKC));
  v_client_hash text := encode(extensions.digest(p_client_key::text, 'sha256'), 'hex');
  blocked_terms text[] := array['死ね', '殺す', '消えろ', '個人情報晒し', '住所特定'];
  blocked_term text;
begin
  if p_client_key is null then raise exception '送信識別子が正しくありません'; end if;
  -- 全体予算が主制御。以下のUUID上限は通常ブラウザ向けの補助制御。
  if not site_private.allow_site_write('feedback') then
    raise exception '意見の受付が混み合っています。時間を置いてからお試しください';
  end if;

  -- 同じブラウザからの同時送信を直列化し、1時間5件までに制限する。
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_client_hash, 0));
  delete from public.site_feedback_rate_limits
  where created_at < now() - interval '24 hours';
  if (
    select count(*)
    from public.site_feedback_rate_limits
    where client_hash = v_client_hash
      and created_at >= now() - interval '1 hour'
  ) >= 5 then
    raise exception '送信回数が多すぎます。時間を置いてからお試しください';
  end if;

  if p_category not in ('improvement', 'topic', 'impression', 'other') then
    raise exception '意見の種類が正しくありません';
  end if;
  if char_length(clean_author) > 40 then
    raise exception '名前は40文字以内で入力してください';
  end if;
  if char_length(trim(p_body)) not between 1 and 2000 then
    raise exception '意見は1〜2000文字で入力してください';
  end if;
  if (select count(*) from regexp_matches(p_body, 'https?://', 'gi')) > 3 then
    raise exception '意見に含められるURLは3件までです';
  end if;
  foreach blocked_term in array blocked_terms loop
    if position(lower(normalize(blocked_term, NFKC)) in normalized_body) > 0 then
      raise exception '送信できない表現が含まれています';
    end if;
  end loop;
  if p_body ~ '(.)\1{19,}' then
    raise exception '同じ文字を過度に繰り返す内容は送信できません';
  end if;

  insert into public.site_feedback (category, author_name, body)
  values (p_category, clean_author, trim(p_body))
  returning id into new_id;

  insert into public.site_feedback_rate_limits (client_hash)
  values (v_client_hash);

  return new_id;
end;
$$;

revoke execute on function public.submit_private_feedback(text, text, text, uuid) from public;
grant execute on function public.submit_private_feedback(text, text, text, uuid)
  to anon, authenticated;

-- Source: visits.sql
-- 先に write-limits.sql を適用してください。
-- 地域別アクセスログ(国 / 都道府県 / 市区町村)
-- Supabase Dashboard > SQL Editor で comments.sql・private-feedback.sql の後に実行してください。
--
-- 記録するのはページのパスと、IP から引いた粗い地域(国・都道府県・市区町村)だけです。
-- IP アドレス、User-Agent、リファラ、個人を追跡する識別子は保存しません。

create extension if not exists pgcrypto;

create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  page_path text not null,
  country text,
  country_code text,
  -- region は API が返す英字表記(例: Nara)。region_code は ISO 3166-2 の
  -- 都道府県番号(例: 29)で、日本語の県名へ変換するときに使う。
  region text,
  region_code text,
  city text,
  created_at timestamptz not null default now()
);

create index if not exists site_visits_created_idx
  on public.site_visits (created_at desc);

create index if not exists site_visits_region_idx
  on public.site_visits (country_code, region_code);

-- 同じブラウザからの連投でテーブルが膨らまないようにするための記録
create table if not exists public.site_visit_rate_limits (
  id bigint generated always as identity primary key,
  client_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists site_visit_rate_limits_client_created_idx
  on public.site_visit_rate_limits (client_hash, created_at desc);

-- 管理ページの合言葉(SHA-256 ハッシュだけを置く)
create table if not exists public.site_admin_keys (
  name text primary key,
  key_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.site_visits enable row level security;
alter table public.site_visit_rate_limits enable row level security;
alter table public.site_admin_keys enable row level security;

revoke all on public.site_visits from anon, authenticated;
revoke all on public.site_visit_rate_limits from anon, authenticated;
revoke all on public.site_admin_keys from anon, authenticated;

-- 合言葉の登録(必ず自分のものへ書き換えて実行してください)
-- insert into public.site_admin_keys (name, key_hash)
-- values ('visits', encode(extensions.digest('ここに長い合言葉', 'sha256'), 'hex'))
-- on conflict (name) do update set key_hash = excluded.key_hash;

-- 閲覧の記録。ブラウザの公開キーから呼べるのはこの関数だけで、読み出しはできない。
create or replace function public.record_site_visit(
  p_page_path text,
  p_country text,
  p_country_code text,
  p_region text,
  p_region_code text,
  p_city text,
  p_client_key uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_hash text := encode(extensions.digest(p_client_key::text, 'sha256'), 'hex');
  v_path text := trim(p_page_path);
begin
  -- サイト内のパスだけを受け付ける(URL や長大な文字列を弾く)
  if v_path !~ '^/[[:alnum:]ぁ-んァ-ヶ一-龠々ー%._~/-]*$' or char_length(v_path) > 200 then
    return;
  end if;

  if p_client_key is null then return; end if;
  if not site_private.allow_site_write('visit') then return; end if;

  -- ブラウザUUIDによる補助制御。全体予算は上で別途検査する。
  -- 1時間あたり120件まで。連投・いたずらでテーブルが膨らむのを防ぐ。
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_client_hash, 1));
  delete from public.site_visit_rate_limits
  where created_at < now() - interval '24 hours';
  if (
    select count(*)
    from public.site_visit_rate_limits
    where client_hash = v_client_hash
      and created_at >= now() - interval '1 hour'
  ) >= 120 then
    return;
  end if;

  insert into public.site_visits (
    page_path, country, country_code, region, region_code, city
  )
  values (
    v_path,
    nullif(left(trim(coalesce(p_country, '')), 80), ''),
    nullif(upper(left(trim(coalesce(p_country_code, '')), 2)), ''),
    nullif(left(trim(coalesce(p_region, '')), 80), ''),
    nullif(left(trim(coalesce(p_region_code, '')), 8), ''),
    nullif(left(trim(coalesce(p_city, '')), 80), '')
  );

  insert into public.site_visit_rate_limits (client_hash) values (v_client_hash);

  -- たまに古い記録を掃除する(2年より前は残さない)
  if random() < 0.005 then
    delete from public.site_visits where created_at < now() - interval '2 years';
  end if;
end;
$$;

-- 集計の読み出し。合言葉が一致したときだけ結果を返す。
create or replace function public.get_site_visit_report(
  p_admin_key text,
  p_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := encode(extensions.digest(coalesce(p_admin_key, ''), 'sha256'), 'hex');
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 730);
  v_since timestamptz;
  v_result jsonb;
begin
  if not exists (
    select 1 from public.site_admin_keys
    where name = 'visits' and key_hash = v_hash
  ) then
    -- DB接続を占有する待機は行わない。長い管理用合言葉を使う。
    raise exception '合言葉が違います';
  end if;

  v_since := now() - make_interval(days => v_days);

  select jsonb_build_object(
    'days', v_days,
    'total', (
      select count(*) from public.site_visits where created_at >= v_since
    ),
    'countries', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.visits desc), '[]'::jsonb) from (
        select
          coalesce(country, '不明') as country,
          country_code,
          count(*) as visits
        from public.site_visits
        where created_at >= v_since
        group by 1, 2
        order by count(*) desc
        limit 30
      ) t
    ),
    'regions', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.visits desc), '[]'::jsonb) from (
        select
          country_code,
          region,
          region_code,
          count(*) as visits,
          max(created_at) as last_seen
        from public.site_visits
        where created_at >= v_since
          and region is not null
        group by 1, 2, 3
        order by count(*) desc
        limit 60
      ) t
    ),
    'cities', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.visits desc), '[]'::jsonb) from (
        select
          country_code,
          region,
          region_code,
          city,
          count(*) as visits,
          max(created_at) as last_seen
        from public.site_visits
        where created_at >= v_since
          and city is not null
        group by 1, 2, 3, 4
        order by count(*) desc
        limit 60
      ) t
    ),
    'pages', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.visits desc), '[]'::jsonb) from (
        select page_path, count(*) as visits
        from public.site_visits
        where created_at >= v_since
        group by 1
        order by count(*) desc
        limit 30
      ) t
    ),
    'recent', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) from (
        select page_path, country, country_code, region, region_code, city, created_at
        from public.site_visits
        where created_at >= v_since
        order by created_at desc
        limit 50
      ) t
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.record_site_visit(text, text, text, text, text, text, uuid) from public;
revoke execute on function public.get_site_visit_report(text, integer) from public;

grant execute on function public.record_site_visit(text, text, text, text, text, text, uuid)
  to anon, authenticated;
grant execute on function public.get_site_visit_report(text, integer)
  to anon, authenticated;

commit;
