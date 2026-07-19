-- 既に comments.sql を適用済みのSupabaseプロジェクト向け更新。
-- Dashboard > SQL Editor で一度だけ実行してください。

alter table public.site_comments
  alter column status set default 'approved';

-- 旧設定で承認待ちになっているコメントも公開する。
update public.site_comments
set status = 'approved'
where status = 'pending';

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

revoke execute on function public.submit_site_comment(text, text, text, uuid) from public;
grant execute on function public.submit_site_comment(text, text, text, uuid)
  to anon, authenticated;
