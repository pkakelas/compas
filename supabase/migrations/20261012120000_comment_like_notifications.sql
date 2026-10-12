-- Notifications: "X liked your comment".
--
-- Comments could always be liked (`comment_likes`, with its counter, is in the
-- first migration); the app now offers it. Like every other notification this
-- one is read back from rows that already exist: each like on one of your
-- comments, by someone else whom you haven't blocked. It names the post the
-- comment is on (so it opens there) and carries the comment's words.
--
-- The view keeps its columns; this adds one more branch to it (and restates
-- the others unchanged).
create or replace view public.my_notifications
with (security_invoker = true)
as
select
  'like'::text as kind,
  l.created_at,
  l.user_id as actor_id,
  a.display_name as actor_name,
  p.id as post_id,
  p.kind as post_kind,
  coalesce(nullif(p.tanda ->> 'name', ''), nullif(left(p.note, 80), '')) as post_title,
  null::uuid as comment_id,
  null::text as body,
  a.avatar_url as actor_avatar
from public.post_likes l
join public.posts p on p.id = l.post_id
join public.profiles a on a.id = l.user_id
where p.author_id = (select auth.uid())
  and l.user_id <> (select auth.uid())
  and not exists (
    select 1 from public.blocks b
    where b.blocker_id = (select auth.uid()) and b.blocked_id = l.user_id
  )
union all
select
  'comment',
  c.created_at,
  c.author_id,
  a.display_name,
  p.id,
  p.kind,
  coalesce(nullif(p.tanda ->> 'name', ''), nullif(left(p.note, 80), '')),
  c.id,
  left(c.body, 140),
  a.avatar_url
from public.comments c
join public.posts p on p.id = c.post_id
join public.profiles a on a.id = c.author_id
where p.author_id = (select auth.uid())
  and c.author_id <> (select auth.uid())
union all
select
  'reply',
  c.created_at,
  c.author_id,
  a.display_name,
  p.id,
  p.kind,
  coalesce(nullif(p.tanda ->> 'name', ''), nullif(left(p.note, 80), '')),
  c.id,
  left(c.body, 140),
  a.avatar_url
from public.comments c
join public.comments parent on parent.id = c.parent_id
join public.posts p on p.id = c.post_id
join public.profiles a on a.id = c.author_id
where parent.author_id = (select auth.uid())
  and c.author_id <> (select auth.uid())
  and p.author_id <> (select auth.uid())
union all
select
  'comment_like',
  cl.created_at,
  cl.user_id,
  a.display_name,
  p.id,
  p.kind,
  coalesce(nullif(p.tanda ->> 'name', ''), nullif(left(p.note, 80), '')),
  c.id,
  left(c.body, 140),
  a.avatar_url
from public.comment_likes cl
join public.comments c on c.id = cl.comment_id
join public.posts p on p.id = c.post_id
join public.profiles a on a.id = cl.user_id
where c.author_id = (select auth.uid())
  and cl.user_id <> (select auth.uid())
  and not exists (
    select 1 from public.blocks b
    where b.blocker_id = (select auth.uid()) and b.blocked_id = cl.user_id
  )
union all
select
  'follow',
  f.created_at,
  f.follower_id,
  a.display_name,
  null::uuid,
  null::public.post_kind,
  null::text,
  null::uuid,
  null::text,
  a.avatar_url
from public.follows f
join public.profiles a on a.id = f.follower_id
where f.followee_id = (select auth.uid())
  and not exists (
    select 1 from public.blocks b
    where b.blocker_id = (select auth.uid()) and b.blocked_id = f.follower_id
  )
union all
select
  'welcome',
  pr.created_at,
  pr.id,
  'Compás',
  null::uuid,
  null::public.post_kind,
  null::text,
  null::uuid,
  null::text,
  null::text
from public.profiles pr
where pr.id = (select auth.uid());
