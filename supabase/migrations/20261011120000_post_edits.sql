-- Editing a post.
--
-- A DJ may change the words of their own post (the UPDATE grant on `note` and
-- the posts_update policy have been there from the first migration). When the
-- words change, the database records when, so the feed can say a post was
-- edited — the comments under it may answer what it said before. Clients
-- can't set `edited_at` themselves: it isn't granted, and the trigger owns it.

alter table public.posts add column edited_at timestamptz;

create function public.mark_post_edited()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.note is distinct from old.note then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create trigger posts_mark_edited
  before update of note on public.posts
  for each row execute function public.mark_post_edited();

revoke execute on function public.mark_post_edited() from public, anon, authenticated;

-- The feed: `edited_at` appended (create or replace may only add columns at the end).
create or replace view public.feed_posts
with (security_invoker = true)
as
select
  p.id,
  p.author_id,
  p.kind,
  p.note,
  p.tanda,
  p.like_count,
  p.comment_count,
  p.created_at,
  a.handle       as author_handle,
  a.display_name as author_name,
  a.city         as author_city,
  exists (
    select 1 from public.post_likes l
    where l.post_id = p.id and l.user_id = (select auth.uid())
  ) as viewer_liked,
  exists (
    select 1 from public.saves s
    where s.post_id = p.id and s.user_id = (select auth.uid())
  ) as viewer_saved,
  (p.like_count + 2 * p.comment_count + 1)
    / power(greatest(extract(epoch from (now() - p.created_at)) / 86400.0, 0) + 1, 1.2) as popularity,
  p.orq_keys,
  exists (
    select 1 from public.follows f
    where f.follower_id = (select auth.uid()) and f.followee_id = p.author_id
  ) as author_followed,
  a.avatar_url as author_avatar,
  p.edited_at
from public.posts p
join public.profiles a on a.id = p.author_id;
