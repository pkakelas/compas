-- A welcome notification for every DJ.
--
-- A brand-new account has nothing in its notifications: nobody has liked or
-- commented on anything yet. So the list starts with one entry from Compás
-- itself, dated when the DJ joined, which makes the bell show "1" the first
-- time they sign in and gives them somewhere to start. It is read back like
-- every other notification (nothing is stored per DJ), and it counts as seen
-- from the first time the list is opened.
--
-- The view keeps its columns; this only adds one more branch to it.
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
  null::text as body
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
  left(c.body, 140)
from public.comments c
join public.posts p on p.id = c.post_id
join public.profiles a on a.id = c.author_id
where p.author_id = (select auth.uid())
  and c.author_id <> (select auth.uid())
union all
-- A reply to your comment on someone else's post (on your own post it is
-- already counted as a comment above).
select
  'reply',
  c.created_at,
  c.author_id,
  a.display_name,
  p.id,
  p.kind,
  coalesce(nullif(p.tanda ->> 'name', ''), nullif(left(p.note, 80), '')),
  c.id,
  left(c.body, 140)
from public.comments c
join public.comments parent on parent.id = c.parent_id
join public.posts p on p.id = c.post_id
join public.profiles a on a.id = c.author_id
where parent.author_id = (select auth.uid())
  and c.author_id <> (select auth.uid())
  and p.author_id <> (select auth.uid())
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
  null::text
from public.profiles pr
where pr.id = (select auth.uid());
