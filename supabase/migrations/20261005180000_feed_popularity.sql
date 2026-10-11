-- Feed sorting: a "popular" score on the feed view.
--
-- popularity = (likes + 2 × comments + 1) / (age in days + 1) ^ 1.2
--
-- Conversation counts double a like, because talking is what the Community is
-- for. The +1 lets a brand-new post rank on freshness alone; the divisor makes
-- every post sink as it ages, so an old favourite doesn't sit on top forever
-- ("Most liked" sorts by like_count for that). Age is measured in days, not
-- hours: this is a small community, and a post that got people talking
-- yesterday should still sit above one posted a minute ago that nobody has
-- seen. It is computed when read, so nothing has to be kept up to date.
--
-- The column is appended (create or replace view can only add at the end), so
-- app versions that don't know about it are unaffected.
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
    / power(greatest(extract(epoch from (now() - p.created_at)) / 86400.0, 0) + 1, 1.2) as popularity
from public.posts p
join public.profiles a on a.id = p.author_id;

-- "Most liked" sorts on this.
create index posts_liked_idx on public.posts (like_count desc, created_at desc);
