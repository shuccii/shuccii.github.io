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
