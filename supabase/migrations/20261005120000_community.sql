-- Compás Community — schema, row-level security and counters.
--
-- What lives here: profiles, shared posts (a tanda snapshot or a question),
-- likes, comments (one level of replies), saves, follows, blocks and reports.
-- What never lives here: audio, file paths, or anything about a DJ's library.
-- A shared tanda is song details only; every client matches those details
-- against its own library locally.
--
-- Access model: signed-in users only (the `anon` role gets nothing). Clients
-- may write just the columns granted below — ownership columns default to
-- auth.uid() and counters are maintained by triggers, so neither can be forged.

-- ---------------------------------------------------------------------------
-- Profiles — one per auth user, created by trigger on sign-up.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  handle       text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  city         text check (city is null or char_length(city) <= 60),
  created_at   timestamptz not null default now()
);

-- The display name comes from the identity provider (Google) when there is one.
-- It deliberately never falls back to the email address: profiles are visible
-- to every signed-in user.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, handle, display_name)
  values (
    new.id,
    'dj_' || substr(replace(new.id::text, '-', ''), 1, 10),
    left(coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      'New DJ'
    ), 60)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Posts — a shared tanda (immutable snapshot in `tanda`) or a question.
-- ---------------------------------------------------------------------------
create type public.post_kind as enum ('tanda', 'question');

-- Shape check for a shared tanda:
--   { "name": string|null,
--     "tags":  [{ "cat": type|age|orquesta|mood|custom, "label": string }],
--     "songs": [{ "title", "orq", "singer"|null, "year"|null, "genre"|null }] }
-- Other clients render this, so it is validated here rather than trusted.
create function public.is_valid_tanda(t jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  s jsonb;
  g jsonb;
begin
  if t is null or jsonb_typeof(t) <> 'object' then return false; end if;
  if octet_length(t::text) > 8000 then return false; end if;

  if coalesce(jsonb_typeof(t -> 'name'), 'null') not in ('string', 'null') then return false; end if;
  if char_length(coalesce(t ->> 'name', '')) > 120 then return false; end if;

  if jsonb_typeof(t -> 'songs') is distinct from 'array' then return false; end if;
  if jsonb_array_length(t -> 'songs') not between 1 and 8 then return false; end if;
  for s in select * from jsonb_array_elements(t -> 'songs') loop
    if jsonb_typeof(s) <> 'object' then return false; end if;
    if jsonb_typeof(s -> 'title') is distinct from 'string'
      or char_length(btrim(s ->> 'title')) not between 1 and 200 then return false; end if;
    -- The orchestra is required: it is half of the key clients match on.
    if jsonb_typeof(s -> 'orq') is distinct from 'string'
      or char_length(btrim(s ->> 'orq')) not between 1 and 120 then return false; end if;
    if coalesce(jsonb_typeof(s -> 'singer'), 'null') not in ('string', 'null')
      or char_length(coalesce(s ->> 'singer', '')) > 120 then return false; end if;
    if coalesce(jsonb_typeof(s -> 'genre'), 'null') not in ('string', 'null')
      or char_length(coalesce(s ->> 'genre', '')) > 40 then return false; end if;
    if coalesce(jsonb_typeof(s -> 'year'), 'null') not in ('number', 'null') then return false; end if;
    if jsonb_typeof(s -> 'year') = 'number' and (
      (s ->> 'year')::numeric % 1 <> 0 or (s ->> 'year')::numeric not between 1890 and 2100
    ) then return false; end if;
  end loop;

  if coalesce(jsonb_typeof(t -> 'tags'), 'null') not in ('array', 'null') then return false; end if;
  if jsonb_typeof(t -> 'tags') = 'array' then
    if jsonb_array_length(t -> 'tags') > 12 then return false; end if;
    for g in select * from jsonb_array_elements(t -> 'tags') loop
      if jsonb_typeof(g) <> 'object' then return false; end if;
      if coalesce(g ->> 'cat', '') not in ('type', 'age', 'orquesta', 'mood', 'custom') then return false; end if;
      if jsonb_typeof(g -> 'label') is distinct from 'string'
        or char_length(btrim(g ->> 'label')) not between 1 and 40 then return false; end if;
    end loop;
  end if;

  return true;
end;
$$;

create table public.posts (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind          public.post_kind not null,
  note          text not null default '' check (char_length(note) <= 500),
  tanda         jsonb,
  like_count    integer not null default 0,
  comment_count integer not null default 0,
  created_at    timestamptz not null default now(),
  constraint posts_kind_shape check (
    (kind = 'tanda' and public.is_valid_tanda(tanda))
    or (kind = 'question' and tanda is null and char_length(btrim(note)) > 0)
  )
);

create index posts_feed_idx on public.posts (created_at desc, id);
create index posts_author_idx on public.posts (author_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Likes, comments, saves, follows, blocks, reports.
-- ---------------------------------------------------------------------------
create table public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_likes_user_idx on public.post_likes (user_id);

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  author_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- A reply points at a top-level comment on the same post (enforced by trigger).
  parent_id  uuid references public.comments (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 1000),
  like_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index comments_post_idx on public.comments (post_id, created_at);
create index comments_parent_idx on public.comments (parent_id);
create index comments_author_idx on public.comments (author_id);

create table public.comment_likes (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index comment_likes_user_idx on public.comment_likes (user_id);

create table public.saves (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index saves_post_idx on public.saves (post_id);

create table public.follows (
  follower_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id);

create table public.blocks (
  blocker_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

-- Reports are write-only for clients; review them in the dashboard.
create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  post_id     uuid references public.posts (id) on delete cascade,
  comment_id  uuid references public.comments (id) on delete cascade,
  reason      text not null check (char_length(btrim(reason)) between 1 and 500),
  created_at  timestamptz not null default now(),
  check (num_nonnulls(post_id, comment_id) = 1)
);

-- ---------------------------------------------------------------------------
-- Triggers: reply rules, counters, and simple per-user rate limits.
-- ---------------------------------------------------------------------------
create function public.check_comment_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent public.comments%rowtype;
begin
  if new.parent_id is not null then
    select * into parent from public.comments where id = new.parent_id;
    if not found or parent.post_id <> new.post_id or parent.parent_id is not null then
      raise exception 'A reply must answer a top-level comment on the same post';
    end if;
  end if;
  return new;
end;
$$;

create trigger comments_check_parent
  before insert on public.comments
  for each row execute function public.check_comment_parent();

create function public.bump_post_like_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id;
  else
    update public.posts set like_count = like_count - 1 where id = old.post_id;
  end if;
  return null;
end;
$$;

create trigger post_likes_count
  after insert or delete on public.post_likes
  for each row execute function public.bump_post_like_count();

create function public.bump_post_comment_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id;
  else
    update public.posts set comment_count = comment_count - 1 where id = old.post_id;
  end if;
  return null;
end;
$$;

create trigger comments_count
  after insert or delete on public.comments
  for each row execute function public.bump_post_comment_count();

create function public.bump_comment_like_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.comments set like_count = like_count + 1 where id = new.comment_id;
  else
    update public.comments set like_count = like_count - 1 where id = old.comment_id;
  end if;
  return null;
end;
$$;

create trigger comment_likes_count
  after insert or delete on public.comment_likes
  for each row execute function public.bump_comment_like_count();

-- Spam brakes: 20 posts a day, 60 comments an hour, per user.
create function public.limit_post_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.posts
      where author_id = new.author_id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Daily post limit reached — try again tomorrow';
  end if;
  return new;
end;
$$;

create trigger posts_rate_limit
  before insert on public.posts
  for each row execute function public.limit_post_rate();

create function public.limit_comment_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.comments
      where author_id = new.author_id and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many comments — slow down a little';
  end if;
  return new;
end;
$$;

create trigger comments_rate_limit
  before insert on public.comments
  for each row execute function public.limit_comment_rate();

-- ---------------------------------------------------------------------------
-- Account deletion — removes the auth user; everything above cascades from it.
-- ---------------------------------------------------------------------------
create function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Row-level security.
-- ---------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.posts         enable row level security;
alter table public.post_likes    enable row level security;
alter table public.comments      enable row level security;
alter table public.comment_likes enable row level security;
alter table public.saves         enable row level security;
alter table public.follows       enable row level security;
alter table public.blocks        enable row level security;
alter table public.reports       enable row level security;

-- profiles: everyone signed in can read; you edit only your own.
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- posts: readable unless you blocked the author; you write only your own.
create policy posts_select on public.posts
  for select to authenticated
  using (not exists (
    select 1 from public.blocks b
    where b.blocker_id = (select auth.uid()) and b.blocked_id = posts.author_id
  ));
create policy posts_insert on public.posts
  for insert to authenticated with check (author_id = (select auth.uid()));
create policy posts_update on public.posts
  for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy posts_delete on public.posts
  for delete to authenticated using (author_id = (select auth.uid()));

-- post_likes: who liked what is public to members; you add/remove only yours.
create policy post_likes_select on public.post_likes
  for select to authenticated using (true);
create policy post_likes_insert on public.post_likes
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy post_likes_delete on public.post_likes
  for delete to authenticated using (user_id = (select auth.uid()));

-- comments: same visibility rule as posts; delete your own.
create policy comments_select on public.comments
  for select to authenticated
  using (not exists (
    select 1 from public.blocks b
    where b.blocker_id = (select auth.uid()) and b.blocked_id = comments.author_id
  ));
create policy comments_insert on public.comments
  for insert to authenticated with check (author_id = (select auth.uid()));
create policy comments_delete on public.comments
  for delete to authenticated using (author_id = (select auth.uid()));

create policy comment_likes_select on public.comment_likes
  for select to authenticated using (true);
create policy comment_likes_insert on public.comment_likes
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy comment_likes_delete on public.comment_likes
  for delete to authenticated using (user_id = (select auth.uid()));

-- saves and blocks are private to their owner.
create policy saves_select on public.saves
  for select to authenticated using (user_id = (select auth.uid()));
create policy saves_insert on public.saves
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy saves_delete on public.saves
  for delete to authenticated using (user_id = (select auth.uid()));

create policy blocks_select on public.blocks
  for select to authenticated using (blocker_id = (select auth.uid()));
create policy blocks_insert on public.blocks
  for insert to authenticated with check (blocker_id = (select auth.uid()));
create policy blocks_delete on public.blocks
  for delete to authenticated using (blocker_id = (select auth.uid()));

create policy follows_select on public.follows
  for select to authenticated using (true);
create policy follows_insert on public.follows
  for insert to authenticated with check (follower_id = (select auth.uid()));
create policy follows_delete on public.follows
  for delete to authenticated using (follower_id = (select auth.uid()));

-- reports: insert only.
create policy reports_insert on public.reports
  for insert to authenticated with check (reporter_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Feed view — a post with its author and the viewer's own like/save state.
-- security_invoker keeps the policies above in force for whoever queries it.
-- ---------------------------------------------------------------------------
create view public.feed_posts
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
  ) as viewer_saved
from public.posts p
join public.profiles a on a.id = p.author_id;

-- ---------------------------------------------------------------------------
-- Grants. Supabase grants everything on new public tables to anon and
-- authenticated by default; take that back and hand out exactly what clients
-- need. Column-level INSERT/UPDATE grants are what keep owner ids and counters
-- out of client hands.
-- ---------------------------------------------------------------------------
revoke all on
  public.profiles, public.posts, public.post_likes, public.comments,
  public.comment_likes, public.saves, public.follows, public.blocks,
  public.reports, public.feed_posts
from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (handle, display_name, city) on public.profiles to authenticated;

grant select, delete on public.posts to authenticated;
grant insert (kind, note, tanda) on public.posts to authenticated;
grant update (note) on public.posts to authenticated;

grant select, delete on public.post_likes to authenticated;
grant insert (post_id) on public.post_likes to authenticated;

grant select, delete on public.comments to authenticated;
grant insert (post_id, parent_id, body) on public.comments to authenticated;

grant select, delete on public.comment_likes to authenticated;
grant insert (comment_id) on public.comment_likes to authenticated;

grant select, delete on public.saves to authenticated;
grant insert (post_id) on public.saves to authenticated;

grant select, delete on public.follows to authenticated;
grant insert (followee_id) on public.follows to authenticated;

grant select, delete on public.blocks to authenticated;
grant insert (blocked_id) on public.blocks to authenticated;

grant insert (post_id, comment_id, reason) on public.reports to authenticated;

grant select on public.feed_posts to authenticated;

-- Functions are executable by everyone by default; only account deletion is
-- meant to be called by clients, and only when signed in.
revoke execute on function
  public.handle_new_user(), public.check_comment_parent(),
  public.bump_post_like_count(), public.bump_post_comment_count(),
  public.bump_comment_like_count(), public.limit_post_rate(),
  public.limit_comment_rate(), public.delete_my_account()
from public, anon, authenticated;

grant execute on function public.delete_my_account() to authenticated;
