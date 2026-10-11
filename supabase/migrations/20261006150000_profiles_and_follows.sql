-- DJ profiles and following.
--
-- Every DJ gets a page: who they are (now with a short bio), what they have
-- shared, who follows them and whom they follow. Following is the `follows`
-- table from the first migration; this adds what the pages and the feed read:
--
--   profile_cards   — one DJ as their page shows them, with counts and whether
--                     the viewer follows them (and is followed back)
--   feed_posts      — gains `author_followed`, so the feed can show only the
--                     posts of DJs the viewer follows
--   my_notifications — gains a 'follow' entry: someone started following you

alter table public.profiles
  add column bio text check (bio is null or char_length(bio) <= 280);
grant update (bio) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- The feed: `author_followed` for a "Following" view.
-- (create or replace may only append columns, so it is last.)
-- ---------------------------------------------------------------------------
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
  ) as author_followed
from public.posts p
join public.profiles a on a.id = p.author_id;

-- ---------------------------------------------------------------------------
-- A DJ's page. security_invoker: the post counts obey the posts' own rules
-- (a blocked DJ's posts are not readable, so they are not counted either).
-- ---------------------------------------------------------------------------
create view public.profile_cards
with (security_invoker = true)
as
select
  pr.id,
  pr.handle,
  pr.display_name,
  pr.city,
  pr.bio,
  pr.created_at,
  (select count(*) from public.posts p where p.author_id = pr.id and p.kind = 'tanda') as tanda_count,
  (select count(*) from public.posts p where p.author_id = pr.id) as post_count,
  (select count(*) from public.follows f where f.followee_id = pr.id) as follower_count,
  (select count(*) from public.follows f where f.follower_id = pr.id) as following_count,
  exists (
    select 1 from public.follows f
    where f.follower_id = (select auth.uid()) and f.followee_id = pr.id
  ) as viewer_follows,
  exists (
    select 1 from public.follows f
    where f.follower_id = pr.id and f.followee_id = (select auth.uid())
  ) as follows_viewer
from public.profiles pr;

revoke all on public.profile_cards from anon, authenticated;
grant select on public.profile_cards to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications: "X started following you". The view keeps its columns; this
-- adds one more branch (and restates the others unchanged).
-- ---------------------------------------------------------------------------
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
  'follow',
  f.created_at,
  f.follower_id,
  a.display_name,
  null::uuid,
  null::public.post_kind,
  null::text,
  null::uuid,
  null::text
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
  null::text
from public.profiles pr
where pr.id = (select auth.uid());
