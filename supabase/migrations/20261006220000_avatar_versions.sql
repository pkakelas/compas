-- Uploaded photos: one file per upload, in the DJ's own folder.
--
-- An upload used to overwrite `<user id>.jpg`, so deleting "the old photo"
-- could delete a newer one uploaded at the same moment from another device.
-- Now each upload is `<user id>/<version>.jpg` (the profile says
-- `upload:<version>`): the app deletes exactly the version it moved away from,
-- and sweeps any other leftovers in the folder, so a failed delete is retried
-- later rather than lost.
--
-- Reading a photo needs no policy (the bucket is public; its public URL is
-- served without one). DJs may list, add and delete only in their own folder;
-- nobody can list the bucket as a whole any more. Nothing was uploaded under
-- the old names yet, so there is nothing to move.

drop policy if exists avatars_read on storage.objects;
drop policy if exists avatars_insert on storage.objects;
drop policy if exists avatars_update on storage.objects;
drop policy if exists avatars_delete on storage.objects;

create policy avatars_own_select on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_own_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and name ~ ('^' || (select auth.uid())::text || '/[0-9]{1,20}\.jpg$'));
create policy avatars_own_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
