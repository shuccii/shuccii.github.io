-- 先に write-limits.sql を適用してください。
-- アクセスログ(地域 / 参照元 / 端末 / 回線 / 再訪 / 滞在時間)
-- Supabase Dashboard > SQL Editor で comments.sql・private-feedback.sql の後に実行してください。
-- 既存のデータベースに何度実行しても安全です(列は足りないものだけ追加します)。
--
-- 記録するのは、ページのパス、IP から引いた粗い地域と回線の提供元、参照元のドメイン、
-- 端末・ブラウザ・OS の種類、言語、再訪かどうか、滞在秒数です。
-- IP アドレス、User-Agent の原文、参照元の URL 全体、個人を追跡する識別子は保存しません。

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

-- 追加の項目(既存テーブルにも足す)
alter table public.site_visits add column if not exists referrer_host text;
alter table public.site_visits add column if not exists device text;
alter table public.site_visits add column if not exists browser text;
alter table public.site_visits add column if not exists os text;
alter table public.site_visits add column if not exists language text;
alter table public.site_visits add column if not exists network text;
alter table public.site_visits add column if not exists asn bigint;
-- is_landing: そのセッションで最初に開いたページ。訪問数・参照元・再訪はこの行で数える。
-- is_returning: このブラウザが以前の別セッションでも来ていたか(ブラウザ内の記録だけで判定)。
alter table public.site_visits add column if not exists is_landing boolean;
alter table public.site_visits add column if not exists is_returning boolean;
alter table public.site_visits add column if not exists duration_seconds integer;
-- 滞在秒数を後から書き足すための使い捨ての値。閲覧したブラウザだけが知っている。
alter table public.site_visits add column if not exists visit_token uuid;

create unique index if not exists site_visits_token_idx
  on public.site_visits (visit_token);

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

-- 閲覧の記録。ブラウザの公開キーから呼べるのは記録用の関数だけで、読み出しはできない。
-- 引数が増えたため古い版を消してから作り直す(古い7引数の呼び出しも既定値で動く)。
drop function if exists public.record_site_visit(text, text, text, text, text, text, uuid);

create or replace function public.record_site_visit(
  p_page_path text,
  p_country text,
  p_country_code text,
  p_region text,
  p_region_code text,
  p_city text,
  p_client_key uuid,
  p_referrer_host text default null,
  p_device text default null,
  p_browser text default null,
  p_os text default null,
  p_language text default null,
  p_network text default null,
  p_asn bigint default null,
  p_is_landing boolean default null,
  p_is_returning boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_hash text := encode(extensions.digest(p_client_key::text, 'sha256'), 'hex');
  v_path text := trim(p_page_path);
  v_referrer text := lower(trim(coalesce(p_referrer_host, '')));
  v_token uuid := gen_random_uuid();
begin
  -- サイト内のパスだけを受け付ける(URL や長大な文字列を弾く)
  if v_path !~ '^/[[:alnum:]ぁ-んァ-ヶ一-龠々ー%._~/-]*$' or char_length(v_path) > 200 then
    return null;
  end if;

  if p_client_key is null then return null; end if;
  if not site_private.allow_site_write('visit') then return null; end if;

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
    return null;
  end if;

  -- 参照元はドメイン名だけを受け付ける(パスやクエリは保存しない)
  if v_referrer !~ '^[a-z0-9.-]{1,120}$' then
    v_referrer := '';
  end if;

  insert into public.site_visits (
    page_path, country, country_code, region, region_code, city,
    referrer_host, device, browser, os, language, network, asn,
    is_landing, is_returning, visit_token
  )
  values (
    v_path,
    nullif(left(trim(coalesce(p_country, '')), 80), ''),
    nullif(upper(left(trim(coalesce(p_country_code, '')), 2)), ''),
    nullif(left(trim(coalesce(p_region, '')), 80), ''),
    nullif(left(trim(coalesce(p_region_code, '')), 8), ''),
    nullif(left(trim(coalesce(p_city, '')), 80), ''),
    nullif(v_referrer, ''),
    case when p_device in ('mobile', 'tablet', 'desktop') then p_device end,
    nullif(left(trim(coalesce(p_browser, '')), 30), ''),
    nullif(left(trim(coalesce(p_os, '')), 30), ''),
    case when p_language ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$' then lower(p_language) end,
    nullif(left(trim(coalesce(p_network, '')), 120), ''),
    case when p_asn between 1 and 4294967295 then p_asn end,
    p_is_landing,
    p_is_returning,
    v_token
  );

  insert into public.site_visit_rate_limits (client_hash) values (v_client_hash);

  -- たまに古い記録を掃除する(2年より前は残さない)
  if random() < 0.005 then
    delete from public.site_visits where created_at < now() - interval '2 years';
  end if;

  return v_token;
end;
$$;

-- 滞在秒数の書き足し。記録時に受け取った visit_token を知っているブラウザだけが、
-- 記録から6時間以内に限って、その1行の秒数を増やせる(行は増えない)。
create or replace function public.update_site_visit_duration(
  p_visit_token uuid,
  p_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_visit_token is null or p_seconds is null or p_seconds < 0 then return; end if;
  update public.site_visits
  set duration_seconds = greatest(coalesce(duration_seconds, 0), least(p_seconds, 6 * 3600))
  where visit_token = p_visit_token
    and created_at >= now() - interval '6 hours';
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
    -- 訪問(セッション)数と、その中の新規・再訪。項目追加前の行は数えない。
    'sessions', (
      select jsonb_build_object(
        'total', count(*),
        'returning', count(*) filter (where is_returning),
        'new', count(*) filter (where is_returning = false)
      )
      from public.site_visits
      where created_at >= v_since and is_landing
    ),
    'avg_duration', (
      select round(avg(duration_seconds))
      from public.site_visits
      where created_at >= v_since and duration_seconds is not null
    ),
    'referrers', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.visits desc), '[]'::jsonb) from (
        select referrer_host, count(*) as visits
        from public.site_visits
        where created_at >= v_since and is_landing
        group by 1
        order by count(*) desc
        limit 30
      ) t
    ),
    'devices', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.visits desc), '[]'::jsonb) from (
        select device, count(*) as visits
        from public.site_visits
        where created_at >= v_since and device is not null
        group by 1
        order by count(*) desc
      ) t
    ),
    'browsers', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.visits desc), '[]'::jsonb) from (
        select browser, os, count(*) as visits
        from public.site_visits
        where created_at >= v_since and (browser is not null or os is not null)
        group by 1, 2
        order by count(*) desc
        limit 30
      ) t
    ),
    'languages', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.visits desc), '[]'::jsonb) from (
        select language, count(*) as visits
        from public.site_visits
        where created_at >= v_since and language is not null
        group by 1
        order by count(*) desc
        limit 20
      ) t
    ),
    'networks', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.visits desc), '[]'::jsonb) from (
        select network, asn, count(*) as visits, max(created_at) as last_seen
        from public.site_visits
        where created_at >= v_since and network is not null
        group by 1, 2
        order by count(*) desc
        limit 40
      ) t
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
        select
          page_path, country, country_code, region, region_code, city, created_at,
          referrer_host, device, browser, os, network, is_landing, is_returning, duration_seconds
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

revoke execute on function public.record_site_visit(
  text, text, text, text, text, text, uuid, text, text, text, text, text, text, bigint, boolean, boolean
) from public;
revoke execute on function public.update_site_visit_duration(uuid, integer) from public;
revoke execute on function public.get_site_visit_report(text, integer) from public;

grant execute on function public.record_site_visit(
  text, text, text, text, text, text, uuid, text, text, text, text, text, text, bigint, boolean, boolean
) to anon, authenticated;
grant execute on function public.update_site_visit_duration(uuid, integer)
  to anon, authenticated;
grant execute on function public.get_site_visit_report(text, integer)
  to anon, authenticated;
