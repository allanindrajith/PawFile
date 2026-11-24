-- PawFile upgrade 01: pet photos, weight, and live updates.
-- Run once in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- Safe to re-run. The app still works without it; photos, weight and instant updates just stay off.

-- 1) Extra pet fields ---------------------------------------------------------
alter table public.pets add column if not exists photo_path text;
alter table public.pets add column if not exists weight_kg  numeric(5,1) check (weight_kg is null or (weight_kg > 0 and weight_kg < 500));

-- 2) Private photo bucket ------------------------------------------------------
-- Files live at <pet_id>/<timestamp>.jpg. The same rule that protects the health record
-- protects the photo: owners manage it, and a vet can see it only while they have access.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pet-photos', 'pet-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists pet_photos_read   on storage.objects;
drop policy if exists pet_photos_insert on storage.objects;
drop policy if exists pet_photos_update on storage.objects;
drop policy if exists pet_photos_delete on storage.objects;

create policy pet_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'pet-photos' and public.access_level(((storage.foldername(name))[1])::uuid) is not null);
create policy pet_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pet-photos' and public.is_pet_owner(((storage.foldername(name))[1])::uuid));
create policy pet_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'pet-photos' and public.is_pet_owner(((storage.foldername(name))[1])::uuid));
create policy pet_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'pet-photos' and public.is_pet_owner(((storage.foldername(name))[1])::uuid));

-- 3) Live updates --------------------------------------------------------------
-- Realtime respects Row Level Security, so each person only receives rows they may already read.
do $$
declare t text;
begin
  foreach t in array array['access_requests', 'share_codes', 'visits', 'vaccinations', 'pet_alerts', 'pets'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
