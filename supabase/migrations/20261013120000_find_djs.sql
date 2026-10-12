-- Finding a DJ.
--
-- A DJ's page could only be reached from somewhere their name already showed
-- (a post, a comment, a notification, a list of followers). `search_profiles`
-- finds DJs by what one remembers of them: part of their name, @handle or
-- city, in any order ("marta krakow"), with or without accents ("lucia" finds
-- Lucía). Every word typed must match one of the three.
--
-- Best first: the handle exactly, then DJs a word of whose name or handle
-- starts with the first word typed, then the rest; the most followed first
-- within each. DJs the searcher has blocked are left out.
--
-- No index: the community is small enough to read every profile per search.
-- If it ever isn't, a trigram index on the folded text is the next step.

create extension if not exists unaccent with schema extensions;

-- Text as search compares it: lowercase, without accents. The dictionary is
-- named in full because the functions below run with an empty search_path.
create function public.search_fold(t text)
returns text
language sql
stable
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, '')));
$$;

create function public.search_profiles(query text, row_limit integer default 30, row_offset integer default 0)
returns setof public.profile_cards
language sql
stable
set search_path = ''
as $$
  with terms as (
    select coalesce(array_agg(w), '{}') as ws
    from regexp_split_to_table(public.search_fold(left(query, 80)), '[[:space:]@,;·]+') as w
    where w <> ''
  )
  select c.*
  from public.profile_cards c
  cross join terms
  cross join lateral (
    select public.search_fold(c.display_name) as name, public.search_fold(c.city) as city
  ) f
  where cardinality(terms.ws) > 0
    and not exists (
      select 1 from unnest(terms.ws) as w
      where strpos(f.name || ' ' || c.handle || ' ' || f.city, w) = 0
    )
    and not exists (
      select 1 from public.blocks b
      where b.blocker_id = (select auth.uid()) and b.blocked_id = c.id
    )
  order by
    (cardinality(terms.ws) = 1 and c.handle = terms.ws[1]) desc,
    (starts_with(f.name, terms.ws[1]) or strpos(f.name, ' ' || terms.ws[1]) > 0
      or starts_with(c.handle, terms.ws[1]) or strpos(c.handle, '_' || terms.ws[1]) > 0) desc,
    c.follower_count desc,
    c.display_name,
    c.id
  limit least(greatest(coalesce(row_limit, 30), 1), 100)
  offset greatest(coalesce(row_offset, 0), 0);
$$;

revoke execute on function public.search_fold(text), public.search_profiles(text, integer, integer) from public, anon;
grant execute on function public.search_fold(text), public.search_profiles(text, integer, integer) to authenticated;
