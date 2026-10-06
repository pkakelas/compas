-- Profile pictures: only from places the app chose.
--
-- `avatar_url` used to accept any https URL, so a DJ could point theirs at a
-- server of their own (through the API, not the app) and watch every DJ whose
-- client loaded it. It now holds one of:
--
--   preset:<n>                 one of the pictures the app draws
--   upload:<version>           the DJ's own file in the `avatars` bucket; the
--                              app builds the URL from its backend address and
--                              the profile's id, so it can only ever be theirs
--   https://lhN.googleusercontent.com/…   the DJ's Google photo
--
-- Existing values are converted; anything else is dropped (the app then draws
-- a picture from the id).

alter table public.profiles drop constraint if exists profiles_avatar_url_check;

update public.profiles
set avatar_url = case
  when avatar_url ~ ('/storage/v1/object/public/avatars/' || id::text || '\.jpg\?v=[0-9]{1,20}$')
    then 'upload:' || substring(avatar_url from '\?v=([0-9]{1,20})$')
  when avatar_url ~ '^https://lh[0-9]{1,2}\.googleusercontent\.com/[A-Za-z0-9_/=.~-]+$'
    and char_length(avatar_url) <= 2000
    then avatar_url
  when avatar_url ~ '^preset:[0-9]{1,2}$' then avatar_url
end
where avatar_url is not null;

alter table public.profiles add constraint profiles_avatar_url_check check (
  avatar_url is null
  or avatar_url ~ '^preset:[0-9]{1,2}$'
  or avatar_url ~ '^upload:[0-9]{1,20}$'
  or (
    char_length(avatar_url) <= 2000
    and avatar_url ~ '^https://lh[0-9]{1,2}\.googleusercontent\.com/[A-Za-z0-9_/=.~-]+$'
  )
);

-- Sign-up: keep the Google photo only when it is one.
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
    case
      when char_length(picture) <= 2000
        and picture ~ '^https://lh[0-9]{1,2}\.googleusercontent\.com/[A-Za-z0-9_/=.~-]+$'
      then picture
    end
  );
  return new;
end;
$$;
