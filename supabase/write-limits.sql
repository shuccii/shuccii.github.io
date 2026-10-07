-- comments.sql / private-feedback.sql / visits.sql より先に適用する。
-- 匿名利用者が変更できない、サイト全体の書き込み予算。
begin;
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
commit;
