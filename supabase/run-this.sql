-- PawFile: everything to run after schema.sql, in one go. Safe to re-run.
-- Supabase dashboard -> SQL Editor -> New query -> paste all -> Run.

-- ======== upgrade-01-photos-realtime ========
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

-- ======== upgrade-02-clinical ========
-- PawFile upgrade 02: audit log, vet verification, amendable visits, medications, weight history,
-- documents, appointments, co-owners, lost-pet mode, consent, data export and account deletion.
-- Run once in Supabase -> SQL Editor, AFTER schema.sql and upgrade-01-photos-realtime.sql.
-- Safe to re-run. Nothing here is applied automatically.

-- ───────────────────────── 1) audit log (append-only) ─────────────────────────
create table if not exists public.access_log (
  id          uuid primary key default gen_random_uuid(),
  pet_id      uuid not null references public.pets on delete cascade,
  actor_id    uuid not null,
  actor_name  text,
  clinic_id   uuid references public.clinics,
  clinic_name text,
  action      text not null check (action in ('view_record','add_visit','amend_visit','add_medication',
                                              'add_weight','add_document','export_passport','book_appointment')),
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists access_log_pet_idx on public.access_log (pet_id, created_at desc);
alter table public.access_log enable row level security;
drop policy if exists log_read on public.access_log;
create policy log_read on public.access_log for select to authenticated
  using (public.is_pet_owner(pet_id) or actor_id = auth.uid());
-- no insert/update/delete policies: rows are written only by log_access() below, never edited.
revoke insert, update, delete on public.access_log from authenticated;

create or replace function public.log_access(p_pet uuid, p_action text, p_detail text default null)
returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles; cname text;
begin
  if public.access_level(p_pet) is null then return; end if;
  select * into me from public.profiles where id = auth.uid();
  select name into cname from public.clinics where id = me.clinic_id;
  insert into public.access_log (pet_id, actor_id, actor_name, clinic_id, clinic_name, action, detail)
  values (p_pet, auth.uid(), coalesce(me.full_name, me.email), me.clinic_id, cname, p_action, p_detail);
end $$;

-- ───────────────────────── 2) vet verification ─────────────────────────
create table if not exists public.vet_credentials (
  user_id      uuid primary key references auth.users on delete cascade,
  license_no   text not null check (char_length(license_no) between 3 and 40),
  issuer       text,
  status       text not null default 'pending' check (status in ('pending','verified','rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at  timestamptz,
  review_note  text
);
alter table public.vet_credentials enable row level security;
drop policy if exists cred_read on public.vet_credentials;
create policy cred_read on public.vet_credentials for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.vet_credentials from authenticated;

create or replace function public.submit_vet_credential(p_license text, p_issuer text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'vet' then raise exception 'NOT_VET'; end if;
  insert into public.vet_credentials (user_id, license_no, issuer)
  values (auth.uid(), trim(p_license), nullif(trim(coalesce(p_issuer, '')), ''))
  on conflict (user_id) do update
    set license_no = excluded.license_no, issuer = excluded.issuer,
        status = case when public.vet_credentials.status = 'verified' then 'verified' else 'pending' end,
        submitted_at = now();
end $$;

create or replace function public.is_verified_vet() returns boolean language sql stable security definer
set search_path = public as $$
  select exists (select 1 from public.vet_credentials where user_id = auth.uid() and status = 'verified')
     and coalesce((select verified from public.clinics where id = public.my_clinic()), false) $$;
-- A person becomes a verified vet only when an admin runs, in the SQL editor:
--   update public.vet_credentials set status = 'verified', reviewed_at = now() where user_id = '<uuid>';
--   update public.clinics set verified = true where id = '<clinic uuid>';

-- ───────────────────────── 3) amendable visits ─────────────────────────
alter table public.visits add column if not exists amended_at timestamptz;
create table if not exists public.visit_amendments (
  id           uuid primary key default gen_random_uuid(),
  visit_id     uuid not null references public.visits on delete cascade,
  pet_id       uuid not null references public.pets on delete cascade,
  amended_by   uuid not null,
  amended_name text,
  reason       text not null check (char_length(trim(reason)) >= 5),
  old_values   jsonb not null,
  new_values   jsonb not null,
  created_at   timestamptz not null default now()
);
alter table public.visit_amendments enable row level security;
drop policy if exists amend_read on public.visit_amendments;
create policy amend_read on public.visit_amendments for select to authenticated
  using (public.access_level(pet_id) = 'full');
revoke insert, update, delete on public.visit_amendments from authenticated;

create or replace function public.amend_visit(p_visit uuid, p_diagnosis text, p_treatment text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.visits; me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  select * into v from public.visits where id = p_visit;
  if v.id is null or me.role is distinct from 'vet' or v.clinic_id is distinct from me.clinic_id then
    raise exception 'NO_ACCESS';
  end if;
  if not public.is_verified_vet() then raise exception 'NOT_VERIFIED'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if char_length(trim(coalesce(p_diagnosis, ''))) = 0 then raise exception 'DIAGNOSIS_REQUIRED'; end if;
  insert into public.visit_amendments (visit_id, pet_id, amended_by, amended_name, reason, old_values, new_values)
  values (v.id, v.pet_id, me.id, coalesce(me.full_name, me.email), trim(p_reason),
          jsonb_build_object('diagnosis', v.diagnosis, 'treatment', v.treatment),
          jsonb_build_object('diagnosis', trim(p_diagnosis), 'treatment', nullif(trim(coalesce(p_treatment, '')), '')));
  update public.visits set diagnosis = trim(p_diagnosis),
         treatment = nullif(trim(coalesce(p_treatment, '')), ''), amended_at = now()
   where id = v.id;
  perform public.log_access(v.pet_id, 'amend_visit', trim(p_reason));
end $$;

-- add_visit now requires a verified vet and writes the audit log (same signature as before).
create or replace function public.add_visit(p_pet uuid, p_reason text, p_diagnosis text, p_treatment text,
                                            p_vaccine text, p_batch text, p_next_due date, p_override text)
returns uuid language plpgsql security definer set search_path = public as $$
declare me public.profiles; clinic_name text; vid uuid; conflict text;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role is distinct from 'vet' or me.clinic_id is null then raise exception 'NOT_VET'; end if;
  if not public.is_verified_vet() then raise exception 'NOT_VERIFIED'; end if;
  if public.access_level(p_pet) is null then raise exception 'NO_ACCESS'; end if;
  if char_length(trim(coalesce(p_diagnosis, ''))) = 0 then raise exception 'DIAGNOSIS_REQUIRED'; end if;
  if p_vaccine is not null and char_length(trim(p_vaccine)) > 0 and char_length(trim(coalesce(p_batch, ''))) = 0 then
    raise exception 'BATCH_REQUIRED';
  end if;
  conflict := public.check_allergy(p_pet, p_treatment);
  if conflict is not null and char_length(trim(coalesce(p_override, ''))) < 5 then
    raise exception 'ALLERGY_CONFLICT:%', conflict;
  end if;
  select name into clinic_name from public.clinics where id = me.clinic_id;
  insert into public.visits (pet_id, clinic_id, vet_id, clinic_name, reason, diagnosis, treatment, allergy_override_reason)
  values (p_pet, me.clinic_id, me.id, clinic_name, p_reason, p_diagnosis, p_treatment,
          case when conflict is not null then trim(p_override) end)
  returning id into vid;
  if p_vaccine is not null and char_length(trim(p_vaccine)) > 0 then
    insert into public.vaccinations (pet_id, name, given_on, valid_until, batch, clinic_name)
    values (p_pet, trim(p_vaccine), current_date, p_next_due, trim(p_batch), clinic_name);
  end if;
  perform public.log_access(p_pet, 'add_visit', p_diagnosis);
  return vid;
end $$;

-- ───────────────────────── 4) medications, weight history, documents ─────────────────────────
create table if not exists public.medications (
  id          uuid primary key default gen_random_uuid(),
  pet_id      uuid not null references public.pets on delete cascade,
  name        text not null check (char_length(trim(name)) > 0),
  dose        text,
  frequency   text,
  start_on    date not null default current_date,
  end_on      date,
  prescribed_by text,
  created_at  timestamptz not null default now()
);
create table if not exists public.weight_logs (
  id          uuid primary key default gen_random_uuid(),
  pet_id      uuid not null references public.pets on delete cascade,
  weight_kg   numeric(5,1) not null check (weight_kg > 0 and weight_kg < 500),
  measured_on date not null default current_date,
  source      text,
  created_at  timestamptz not null default now()
);
create index if not exists weight_logs_pet_idx on public.weight_logs (pet_id, measured_on);
create table if not exists public.pet_documents (
  id          uuid primary key default gen_random_uuid(),
  pet_id      uuid not null references public.pets on delete cascade,
  visit_id    uuid references public.visits on delete set null,
  kind        text not null default 'lab' check (kind in ('lab','imaging','certificate','other')),
  title       text not null check (char_length(trim(title)) > 0),
  path        text not null,
  uploaded_by text,
  created_at  timestamptz not null default now()
);
alter table public.medications  enable row level security;
alter table public.weight_logs  enable row level security;
alter table public.pet_documents enable row level security;
drop policy if exists meds_read on public.medications;
drop policy if exists weight_read on public.weight_logs;
drop policy if exists docs_read on public.pet_documents;
create policy meds_read   on public.medications   for select to authenticated using (public.access_level(pet_id) = 'full');
create policy weight_read on public.weight_logs   for select to authenticated using (public.access_level(pet_id) = 'full');
create policy docs_read   on public.pet_documents for select to authenticated using (public.access_level(pet_id) = 'full');
revoke insert, update, delete on public.medications, public.weight_logs, public.pet_documents from authenticated;

-- One writer function per table: the owner may always write; a vet only when verified and holding full access.
create or replace function public._may_write(p_pet uuid) returns boolean language sql stable security definer
set search_path = public as $$
  select public.is_pet_owner(p_pet)
      or (public.my_role() = 'vet' and public.is_verified_vet() and public.access_level(p_pet) = 'full') $$;

create or replace function public._actor() returns text language sql stable security definer
set search_path = public as $$
  select coalesce(p.full_name, p.email) || coalesce(' · ' || c.name, '')
    from public.profiles p left join public.clinics c on c.id = p.clinic_id where p.id = auth.uid() $$;

create or replace function public.add_medication(p_pet uuid, p_name text, p_dose text, p_freq text, p_end date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public._may_write(p_pet) then raise exception 'NO_ACCESS'; end if;
  insert into public.medications (pet_id, name, dose, frequency, end_on, prescribed_by)
  values (p_pet, trim(p_name), nullif(trim(coalesce(p_dose, '')), ''), nullif(trim(coalesce(p_freq, '')), ''), p_end, public._actor());
  perform public.log_access(p_pet, 'add_medication', p_name);
end $$;

create or replace function public.add_weight(p_pet uuid, p_kg numeric, p_on date default current_date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public._may_write(p_pet) then raise exception 'NO_ACCESS'; end if;
  insert into public.weight_logs (pet_id, weight_kg, measured_on, source) values (p_pet, p_kg, coalesce(p_on, current_date), public._actor());
  update public.pets set weight_kg = p_kg
   where id = p_pet and not exists (select 1 from public.weight_logs w where w.pet_id = p_pet and w.measured_on > coalesce(p_on, current_date));
  perform public.log_access(p_pet, 'add_weight', p_kg::text);
end $$;

create or replace function public.add_document(p_pet uuid, p_kind text, p_title text, p_path text, p_visit uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public._may_write(p_pet) then raise exception 'NO_ACCESS'; end if;
  if split_part(p_path, '/', 1) <> p_pet::text then raise exception 'BAD_PATH'; end if;
  insert into public.pet_documents (pet_id, visit_id, kind, title, path, uploaded_by)
  values (p_pet, p_visit, p_kind, trim(p_title), p_path, public._actor());
  if p_visit is not null then update public.visits set lab_missing = false where id = p_visit and pet_id = p_pet; end if;
  perform public.log_access(p_pet, 'add_document', p_title);
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pet-docs', 'pet-docs', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp'];
drop policy if exists pet_docs_read   on storage.objects;
drop policy if exists pet_docs_insert on storage.objects;
create policy pet_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'pet-docs' and public.access_level(((storage.foldername(name))[1])::uuid) = 'full');
create policy pet_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pet-docs' and public._may_write(((storage.foldername(name))[1])::uuid));

-- ───────────────────────── 5) appointments ─────────────────────────
create table if not exists public.appointments (
  id         uuid primary key default gen_random_uuid(),
  pet_id     uuid not null references public.pets on delete cascade,
  clinic_id  uuid not null references public.clinics,
  starts_at  timestamptz not null,
  reason     text,
  status     text not null default 'booked' check (status in ('booked','done','cancelled')),
  booked_by  text,
  created_at timestamptz not null default now()
);
create index if not exists appt_clinic_idx on public.appointments (clinic_id, starts_at);
alter table public.appointments enable row level security;
drop policy if exists appt_read on public.appointments;
create policy appt_read on public.appointments for select to authenticated
  using (public.is_pet_owner(pet_id) or clinic_id = public.my_clinic());
revoke insert, update, delete on public.appointments from authenticated;

create or replace function public.book_appointment(p_pet uuid, p_clinic uuid, p_at timestamptz, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare aid uuid;
begin
  if p_at < now() - interval '5 minutes' then raise exception 'IN_THE_PAST'; end if;
  if not (public.is_pet_owner(p_pet) or (public.my_role() = 'vet' and p_clinic = public.my_clinic() and public.access_level(p_pet) is not null)) then
    raise exception 'NO_ACCESS';
  end if;
  insert into public.appointments (pet_id, clinic_id, starts_at, reason, booked_by)
  values (p_pet, p_clinic, p_at, nullif(trim(coalesce(p_reason, '')), ''), public._actor()) returning id into aid;
  return aid;
end $$;

create or replace function public.set_appointment_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_id;
  if a.id is null or p_status not in ('done','cancelled') then raise exception 'BAD_CHOICE'; end if;
  if not (public.is_pet_owner(a.pet_id) or a.clinic_id = public.my_clinic()) then raise exception 'NO_ACCESS'; end if;
  update public.appointments set status = p_status where id = p_id;
end $$;

-- ───────────────────────── 6) co-owners, transfer, lost-pet mode ─────────────────────────
create table if not exists public.pet_owners (
  pet_id   uuid not null references public.pets on delete cascade,
  user_id  uuid not null references auth.users on delete cascade,
  added_at timestamptz not null default now(),
  primary key (pet_id, user_id)
);
alter table public.pet_owners enable row level security;
drop policy if exists pet_owners_read on public.pet_owners;
create policy pet_owners_read on public.pet_owners for select to authenticated
  using (user_id = auth.uid() or public.is_pet_owner(pet_id));
revoke insert, update, delete on public.pet_owners from authenticated;

-- Co-owners count as owners everywhere is_pet_owner() is used.
create or replace function public.is_pet_owner(p_pet uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pets where id = p_pet and owner_id = auth.uid())
      or exists (select 1 from public.pet_owners where pet_id = p_pet and user_id = auth.uid()) $$;

create or replace function public.add_coowner(p_pet uuid, p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not exists (select 1 from public.pets where id = p_pet and owner_id = auth.uid()) then raise exception 'NO_ACCESS'; end if;
  select id into uid from public.profiles where lower(email) = lower(trim(p_email)) and role = 'owner';
  if uid is null then return 'NOT_FOUND'; end if;
  if uid = auth.uid() then return 'SELF'; end if;
  insert into public.pet_owners (pet_id, user_id) values (p_pet, uid) on conflict do nothing;
  return 'ok';
end $$;

create or replace function public.remove_coowner(p_pet uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.pets where id = p_pet and owner_id = auth.uid()) then raise exception 'NO_ACCESS'; end if;
  delete from public.pet_owners where pet_id = p_pet and user_id = p_user;
end $$;

create or replace function public.transfer_pet(p_pet uuid, p_email text, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid; st text;
begin
  if not exists (select 1 from public.pets where id = p_pet and owner_id = auth.uid()) then raise exception 'NO_ACCESS'; end if;
  st := public._check_pin(auth.uid(), p_pin);
  if st <> 'ok' then return st; end if;
  select id into uid from public.profiles where lower(email) = lower(trim(p_email)) and role = 'owner';
  if uid is null then return 'NOT_FOUND'; end if;
  update public.pets set owner_id = uid where id = p_pet;
  delete from public.pet_owners where pet_id = p_pet;
  -- every open grant ends: the new owner decides who sees the record
  update public.access_requests set status = 'revoked', decided_at = now()
   where pet_id = p_pet and status in ('approved', 'pending');
  return 'ok';
end $$;

alter table public.pets add column if not exists is_lost boolean not null default false;
alter table public.pets add column if not exists lost_since timestamptz;
alter table public.pets add column if not exists lost_note text;
create or replace function public.set_lost(p_pet uuid, p_lost boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_pet_owner(p_pet) then raise exception 'NO_ACCESS'; end if;
  update public.pets set is_lost = p_lost, lost_since = case when p_lost then now() end,
         lost_note = case when p_lost then nullif(trim(coalesce(p_note, '')), '') end where id = p_pet;
end $$;

-- ───────────────────────── 7) consent, data export, account deletion ─────────────────────────
create table if not exists public.consents (
  user_id     uuid not null references auth.users on delete cascade,
  kind        text not null check (kind in ('terms','privacy')),
  version     text not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, kind, version)
);
alter table public.consents enable row level security;
drop policy if exists consents_read on public.consents;
create policy consents_read on public.consents for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.consents from authenticated;
create or replace function public.accept_terms(p_version text) returns void language plpgsql security definer
set search_path = public as $$
begin
  insert into public.consents (user_id, kind, version) values (auth.uid(), 'terms', p_version), (auth.uid(), 'privacy', p_version)
  on conflict do nothing;
end $$;

create or replace function public.export_my_data() returns jsonb language plpgsql stable security definer
set search_path = public as $$
begin
  return jsonb_build_object(
    'exported_at', now(),
    'profile',  (select to_jsonb(p) - 'id' from public.profiles p where p.id = auth.uid()),
    'pets',     coalesce((select jsonb_agg(jsonb_build_object(
                  'pet', to_jsonb(p),
                  'alerts',      (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.pet_alerts a where a.pet_id = p.id),
                  'vaccinations',(select coalesce(jsonb_agg(to_jsonb(v)), '[]') from public.vaccinations v where v.pet_id = p.id),
                  'visits',      (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.visits x where x.pet_id = p.id),
                  'medications', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.medications m where m.pet_id = p.id),
                  'weights',     (select coalesce(jsonb_agg(to_jsonb(w)), '[]') from public.weight_logs w where w.pet_id = p.id),
                  'access_log',  (select coalesce(jsonb_agg(to_jsonb(l)), '[]') from public.access_log l where l.pet_id = p.id)))
                from public.pets p where p.owner_id = auth.uid()), '[]'),
    'consents', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.consents c where c.user_id = auth.uid()));
end $$;

-- Deletes the person, their PIN, and every pet they own. Vets: the clinic's visit notes stay (medical records
-- are kept by the clinic); only the vet's login and personal fields go.
create or replace function public.delete_my_account(p_confirm text) returns void language plpgsql security definer
set search_path = public, auth as $$
begin
  if p_confirm is distinct from 'DELETE' then raise exception 'CONFIRM_REQUIRED'; end if;
  delete from public.pets where owner_id = auth.uid();
  update public.visits set vet_id = null where vet_id = auth.uid();
  delete from auth.users where id = auth.uid();
end $$;

-- ───────────────────────── 8) realtime + grants ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['medications','weight_logs','pet_documents','appointments','access_log','visit_amendments'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'log_access(uuid,text,text)','submit_vet_credential(text,text)','is_verified_vet()','amend_visit(uuid,text,text,text)',
    'add_visit(uuid,text,text,text,text,text,date,text)','_may_write(uuid)','_actor()',
    'add_medication(uuid,text,text,text,date)','add_weight(uuid,numeric,date)','add_document(uuid,text,text,text,uuid)',
    'book_appointment(uuid,uuid,timestamptz,text)','set_appointment_status(uuid,text)','add_coowner(uuid,text)',
    'remove_coowner(uuid,uuid)','transfer_pet(uuid,text,text)','set_lost(uuid,boolean,text)','accept_terms(text)',
    'export_my_data()','delete_my_account(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ======== upgrade-03-avatars ========
-- PawFile upgrade 03: profile photos for owners and vets.
-- Run once in Supabase -> SQL Editor. Safe to re-run. Until it runs, the app shows initials
-- (or your Google photo) and the Change photo button reports that it could not save.

-- people may now update their own avatar_url (the earlier grant only covered four columns)
grant update (avatar_url) on public.profiles to authenticated;

-- private bucket, one folder per user: avatars/<user id>/<file>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists avatars_read on storage.objects;
drop policy if exists avatars_insert on storage.objects;
drop policy if exists avatars_update on storage.objects;
drop policy if exists avatars_delete on storage.objects;

create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ======== upgrade-04-chat ========
-- PawFile upgrade 04: secure messages between a pet owner and the vet who has (or had) access to the pet.
-- Run once in Supabase -> SQL Editor, after schema.sql and the earlier upgrades. Safe to re-run.

create table if not exists public.chat_threads (
  id          uuid primary key default gen_random_uuid(),
  pet_id      uuid not null references public.pets on delete cascade,
  owner_id    uuid not null references public.profiles on delete cascade,
  vet_id      uuid not null references public.profiles on delete cascade,
  pet_name    text,
  owner_name  text,
  vet_name    text,
  clinic_name text,
  last_body   text,
  last_at     timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (pet_id, vet_id, owner_id)
);

create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.chat_threads on delete cascade,
  sender_id   uuid not null references public.profiles on delete cascade,
  sender_name text,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, created_at);

alter table public.chat_threads  enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists chat_threads_read on public.chat_threads;
create policy chat_threads_read on public.chat_threads for select to authenticated
  using (owner_id = auth.uid() or vet_id = auth.uid());

drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages for select to authenticated
  using (exists (select 1 from public.chat_threads t
                 where t.id = thread_id and (t.owner_id = auth.uid() or t.vet_id = auth.uid())));

revoke insert, update, delete on public.chat_threads  from authenticated, anon;
revoke insert, update, delete on public.chat_messages from authenticated, anon;

-- Start (or reopen) a conversation about one pet.
--   vet:   needs access to the pet right now.
--   owner: p_vet must be a vet who has been given access to this pet.
create or replace function public.start_thread(p_pet uuid, p_vet uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_vet uuid; v_id uuid; v_pet text; v_oname text; v_vname text; v_clinic text;
begin
  select owner_id, name into v_owner, v_pet from public.pets where id = p_pet;
  if v_owner is null then raise exception 'NOT_FOUND'; end if;

  if public.my_role() = 'vet' then
    v_vet := auth.uid();
    if public.access_level(p_pet) is null then raise exception 'NO_ACCESS'; end if;
  elsif public.is_pet_owner(p_pet) then
    v_vet := p_vet; v_owner := auth.uid();
    if v_vet is null or not exists (
      select 1 from public.access_requests
      where pet_id = p_pet and requested_by = v_vet and status in ('approved', 'revoked')
    ) then raise exception 'NO_ACCESS'; end if;
  else
    raise exception 'NO_ACCESS';
  end if;

  select full_name into v_oname from public.profiles where id = v_owner;
  select p.full_name, c.name into v_vname, v_clinic
    from public.profiles p left join public.clinics c on c.id = p.clinic_id where p.id = v_vet;

  insert into public.chat_threads (pet_id, owner_id, vet_id, pet_name, owner_name, vet_name, clinic_name)
  values (p_pet, v_owner, v_vet, v_pet, v_oname, v_vname, v_clinic)
  on conflict (pet_id, vet_id, owner_id) do update set pet_name = excluded.pet_name
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.send_chat(p_thread uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.chat_threads; v_id uuid; v_name text; v_body text := btrim(coalesce(p_body, ''));
begin
  select * into t from public.chat_threads where id = p_thread;
  if t.id is null or auth.uid() not in (t.owner_id, t.vet_id) then raise exception 'NO_ACCESS'; end if;
  if char_length(v_body) = 0 then raise exception 'EMPTY_MESSAGE'; end if;
  -- a vet can only write while the owner still shares the record
  if auth.uid() = t.vet_id and public.access_level(t.pet_id) is null then raise exception 'NO_ACCESS'; end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.chat_messages (thread_id, sender_id, sender_name, body)
  values (p_thread, auth.uid(), v_name, left(v_body, 2000)) returning id into v_id;
  update public.chat_threads set last_body = left(v_body, 120), last_at = now() where id = p_thread;
  return v_id;
end $$;

create or replace function public.mark_chat_read(p_thread uuid) returns void
language sql security definer set search_path = public as $$
  update public.chat_messages m set read_at = now()
  where m.thread_id = p_thread and m.sender_id <> auth.uid() and m.read_at is null
    and exists (select 1 from public.chat_threads t where t.id = p_thread and auth.uid() in (t.owner_id, t.vet_id));
$$;

do $$ begin
  perform 1;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_messages') then
      alter publication supabase_realtime add table public.chat_messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_threads') then
      alter publication supabase_realtime add table public.chat_threads;
    end if;
  end if;
end $$;

do $$ declare f text; begin
  foreach f in array array['start_thread(uuid,uuid)', 'send_chat(uuid,text)', 'mark_chat_read(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ======== profile backfill ========
-- Sign-up now also reads Google's "picture" field for the photo.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
          coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'))
  on conflict (id) do nothing;
  return new;
end $$;

-- Create a profile for everyone who already signed in but has none, with their Google photo.
insert into public.profiles (id, email, full_name, avatar_url)
select u.id, u.email,
       coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
       coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
from auth.users u
on conflict (id) do nothing;

-- Fill in a missing photo for existing profiles.
update public.profiles p
set avatar_url = coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
from auth.users u
where u.id = p.id and p.avatar_url is null
  and coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture') is not null;

select count(*) as profiles_now from public.profiles;
