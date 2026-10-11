-- Notifications: what other DJs did with your posts and comments.
--
-- Nothing new is recorded when someone likes or comments — those rows already
-- exist. A notification is just a way of reading them back: every like on your
-- post, comment on your post, and reply to your comment, made by someone else.
-- The only thing stored is when you last looked, so the app can count what is
-- new since then.

-- When each DJ last opened their notifications. Private to its owner.
create table public.notification_state (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  seen_at timestamptz not null
);

alter table public.notification_state enable row level security;

create policy notification_state_select on public.notification_state
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.notification_state from anon, authenticated;
grant select on public.notification_state to authenticated;

-- The signed-in DJ's notifications, newest first when ordered by created_at.
-- security_invoker keeps the usual visibility rules: a blocked DJ's comments
-- don't appear, and their likes are left out here explicitly.
create view public.my_notifications
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
  and p.author_id <> (select auth.uid());

revoke all on public.my_notifications from anon, authenticated;
grant select on public.my_notifications to authenticated;

-- How many notifications are newer than the last look (all of them, the first time).
create function public.unread_notifications()
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.my_notifications n
  where n.created_at > coalesce(
    (select s.seen_at from public.notification_state s where s.user_id = (select auth.uid())),
    '-infinity'::timestamptz
  );
$$;

-- "I have looked": everything up to now is seen. Returns the new mark.
create function public.mark_notifications_seen()
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  insert into public.notification_state (user_id, seen_at)
  values ((select auth.uid()), now())
  on conflict (user_id) do update set seen_at = excluded.seen_at
  returning seen_at;
$$;

revoke execute on function public.unread_notifications(), public.mark_notifications_seen() from public, anon;
grant execute on function public.unread_notifications(), public.mark_notifications_seen() to authenticated;
