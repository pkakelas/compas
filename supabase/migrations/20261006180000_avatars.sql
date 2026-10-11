-- Profile pictures.
--
-- `profiles.avatar_url` is either an https URL (the DJ's Google photo, copied
-- at sign-up, or a photo they uploaded) or `preset:<n>`, one of the pictures
-- the app draws itself. Null means the app picks one of those from the DJ's id.
--
-- Uploads go to the public `avatars` storage bucket as `<user id>.jpg`: the
-- app resizes the photo to 256×256 JPEG first, and a DJ may only write their
-- own file. Anyone can read the bucket — the pictures are shown to every
-- signed-in DJ, and public read is what lets an <img> load them.

alter table public.profiles
  add column avatar_url text check (
    avatar_url is null
    or (char_length(avatar_url) <= 2000 and (avatar_url like 'https://%' or avatar_url like 'preset:%'))
  );
grant update (avatar_url) on public.profiles to authenticated;

-- Sign-up: take the picture Google gives, when there is one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  picture text := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'picture'), '')
  );
begin
  insert into public.profiles (id, handle, display_name, avatar_url)
  values (
    new.id,
    'dj_' || substr(replace(new.id::text, '-', ''), 1, 10),
    left(coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      'New DJ'
    ), 60),
    case when picture like 'https://%' then left(picture, 2000) end
  );
  return new;
end;
$$;

-- DJs who signed up with Google before this: their picture is in auth.users.
update public.profiles pr
set avatar_url = left(coalesce(
  nullif(btrim(u.raw_user_meta_data ->> 'avatar_url'), ''),
  nullif(btrim(u.raw_user_meta_data ->> 'picture'), '')
), 2000)
from auth.users u
where u.id = pr.id
  and pr.avatar_url is null
  and coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'picture'), '')
  ) like 'https://%';

-- ---------------------------------------------------------------------------
-- The bucket, and who may write what in it.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

create policy avatars_read on storage.objects
  for select to public using (bucket_id = 'avatars');
create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '.jpg');
create policy avatars_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and name = (select auth.uid())::text || '.jpg')
  with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '.jpg');
create policy avatars_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and name = (select auth.uid())::text || '.jpg');

-- ---------------------------------------------------------------------------
-- The views: each gains the picture of the person it shows, appended.
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
  ) as author_followed,
  a.avatar_url as author_avatar
from public.posts p
join public.profiles a on a.id = p.author_id;

create or replace view public.profile_cards
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
  ) as follows_viewer,
  pr.avatar_url
from public.profiles pr;

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
