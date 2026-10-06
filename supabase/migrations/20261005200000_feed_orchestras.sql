-- Feed: filter shared tandas by orchestra.
--
-- A post keeps its songs as one JSON document, with each orchestra spelled the
-- way the sharer's library spells it. To filter on it, every post gets a small
-- array of normalised orchestra keys (`orq_keys`, e.g. {pugliese}) that the
-- database maintains itself, plus a view listing the orchestras that have been
-- shared and how many tandas each has.
--
-- The key is the orchestra's surname, lowercased and without accents — the same
-- thing the app matches libraries on. Newer app versions send it per song as
-- `orq_key` (they know about "Orquesta Típica …" and the like); for songs
-- without one, it is worked out here from the name's last word.

create function public.orq_key(name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(regexp_replace(
    translate(
      lower(regexp_replace(btrim(coalesce(name, '')), '^.*\s', '')),
      'áàäâãåéèëêíìïîóòöôõúùüûñç',
      'aaaaaaeeeeiiiiooooouuuunc'
    ),
    '[^a-z0-9'']', '', 'g'
  ), 40), '');
$$;

-- The key of one shared song: the one the app sent, cleaned, else derived.
create function public.song_orq_key(song jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(left(regexp_replace(lower(coalesce(song ->> 'orq_key', '')), '[^a-z0-9'']', '', 'g'), 40), ''),
    public.orq_key(song ->> 'orq')
  );
$$;

create function public.tanda_orq_keys(t jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct k) filter (where k is not null), '{}')
  from (
    select public.song_orq_key(s) as k
    from jsonb_array_elements(
      case when jsonb_typeof(t -> 'songs') = 'array' then t -> 'songs' else '[]'::jsonb end
    ) s
  ) keys;
$$;

alter table public.posts add column orq_keys text[] not null default '{}';

-- Kept by the database, so a client can neither forget it nor fake it.
create function public.set_post_orq_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.orq_keys := case when new.kind = 'tanda' then public.tanda_orq_keys(new.tanda) else '{}' end;
  return new;
end;
$$;

create trigger posts_orq_keys
  before insert or update of tanda on public.posts
  for each row execute function public.set_post_orq_keys();

update public.posts set orq_keys = public.tanda_orq_keys(tanda) where kind = 'tanda';

create index posts_orq_keys_idx on public.posts using gin (orq_keys);

-- The feed view gains the keys (appended, so older app versions are unaffected).
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
  p.orq_keys
from public.posts p
join public.profiles a on a.id = p.author_id;

-- Every orchestra that appears in a shared tanda, under its most common
-- spelling, with the number of tandas it is in. security_invoker keeps the
-- posts' own visibility rules (sign-in, blocks) in force.
create view public.feed_orchestras
with (security_invoker = true)
as
select
  k.key,
  mode() within group (order by k.name) as name,
  count(distinct p.id)::integer as tandas
from public.posts p
cross join lateral (
  select public.song_orq_key(s) as key, btrim(s ->> 'orq') as name
  from jsonb_array_elements(p.tanda -> 'songs') s
) k
where p.kind = 'tanda' and k.key is not null and k.name <> ''
group by k.key;

revoke all on public.feed_orchestras from anon, authenticated;
grant select on public.feed_orchestras to authenticated;

revoke execute on function public.set_post_orq_keys() from public, anon, authenticated;
