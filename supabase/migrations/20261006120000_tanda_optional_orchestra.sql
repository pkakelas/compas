-- Shared tandas: a song's orchestra becomes optional.
--
-- A DJ whose library was never organised has songs with no orchestra, and until
-- now could not share a tanda made of them. The app asks for the orchestra when
-- sharing, but the DJ may not know it — so a song may now be posted without one
-- (`orq` absent, null or empty). Such a song gets no orchestra key, so the tanda
-- is not filed under any orchestra for it, and readers' libraries are never
-- matched against it.
--
-- Only the orchestra rule changes; everything else is as in the first migration.

create or replace function public.is_valid_tanda(t jsonb)
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
    -- The orchestra is optional: a song without one is simply never matched.
    if coalesce(jsonb_typeof(s -> 'orq'), 'null') not in ('string', 'null')
      or char_length(coalesce(s ->> 'orq', '')) > 120 then return false; end if;
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

-- A song that was sent an orchestra key but no orchestra must not be filed
-- under that key: the key only counts beside a name.
create or replace function public.song_orq_key(song jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when btrim(coalesce(song ->> 'orq', '')) = '' then null else coalesce(
    nullif(left(regexp_replace(lower(coalesce(song ->> 'orq_key', '')), '[^a-z0-9'']', '', 'g'), 40), ''),
    public.orq_key(song ->> 'orq')
  ) end;
$$;
