-- Read-only post-upgrade checks. Does not read messages, passphrases or hashes.
with writers(name, action) as (values
  ('submit_site_comment','comment'), ('toggle_site_like','like'),
  ('submit_private_feedback','feedback'), ('record_site_visit','visit')
), guarded as (
  select w.name, count(p.oid) = 1 as only_current_overload,
    coalesce(bool_and(position('site_private.allow_site_write(' in p.prosrc) > 0), false) as quota_guard
  from writers w left join pg_proc p on p.proname=w.name
    and p.pronamespace='public'::regnamespace group by w.name
), private_helper as (
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='site_private' and p.proname='allow_site_write'
), tables as (
  select c.oid,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind in ('r','p') and
    ((n.nspname='public' and c.relname in ('site_comments','site_likes','site_feedback','site_visits','site_admin_keys','site_feedback_rate_limits','site_visit_rate_limits'))
      or (n.nspname='site_private' and c.relname='write_events'))
)
select 'writer:'||name as check_name, only_current_overload and quota_guard as passed from guarded
union all select 'internal_helper_exists_and_is_private', count(*)=1 and coalesce(bool_and(
  not has_function_privilege('anon',oid,'execute') and not has_function_privilege('authenticated',oid,'execute')),false) from private_helper
union all select 'table:'||relname, relrowsecurity and
  not has_table_privilege('anon',oid,'select,insert,update,delete') and
  not has_table_privilege('authenticated',oid,'select,insert,update,delete') from tables
union all select 'all_private_tables_exist', count(*)=8 from tables
union all select 'report_has_no_sleep', coalesce(bool_and(position('pg_sleep' in prosrc)=0),false)
  from pg_proc where pronamespace='public'::regnamespace and proname='get_site_visit_report';
