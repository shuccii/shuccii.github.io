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
    -- 総当たりを遅くするための待ち時間
    perform pg_sleep(1);
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
