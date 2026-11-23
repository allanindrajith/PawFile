-- PawFile database schema for Supabase (Postgres).
-- Run this whole file once in: Supabase dashboard -> SQL Editor -> New query -> Run.
-- It is written for a fresh project. To re-run it, delete the public tables and functions first.
--
-- Security model
--   * Every table has Row Level Security (RLS) on.
--   * Vets never read pets directly: they only see a pet through an *active* access grant
--     (an approved, unexpired row in access_requests), enforced by access_level().
--   * All state changes that need judgement (request, approve, revoke, emergency, share code,
--     add visit) go through SECURITY DEFINER functions, so the rules live in the database,
--     not in browser code.

create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────── tables ─────────────────────────

create table public.clinics (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 2 and 120),
  city       text,
  country    text,
  verified   boolean not null default false,   -- set to true manually after you check a clinic
  created_at timestamptz not null default now()
);

create table public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  role       text check (role in ('vet', 'owner')),
  full_name  text,
  email      text,
  avatar_url text,
  phone      text,
  clinic_id  uuid references public.clinics,
  has_pin    boolean not null default false,
  created_at timestamptz not null default now()
);

-- PIN hash and brute-force counters. RLS is on and there are no policies: only the
-- SECURITY DEFINER functions below can touch this table.
create table public.user_security (
  user_id           uuid primary key references public.profiles on delete cascade,
  pin_hash          text,
  pin_fails         int not null default 0,
  pin_locked_until  timestamptz,
  code_fails        int not null default 0,
  code_locked_until timestamptz
);

create table public.pets (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  species    text not null default 'Dog',
  breed      text,
  sex        text,
  birth_date date,
  chip       text unique check (chip is null or chip ~ '^[0-9]{15}$'),
  created_at timestamptz not null default now()
);

create table public.pet_alerts (
  id         uuid primary key default gen_random_uuid(),
  pet_id     uuid not null references public.pets on delete cascade,
  kind       text not null default 'allergy',
  substance  text not null,
  note       text,
  source     text,
  created_at timestamptz not null default now()
);

create table public.vaccinations (
  id          uuid primary key default gen_random_uuid(),
  pet_id      uuid not null references public.pets on delete cascade,
  name        text not null,
  given_on    date,
  valid_until date,
  batch       text,
  clinic_name text,
  created_at  timestamptz not null default now()
);

create table public.visits (
  id                      uuid primary key default gen_random_uuid(),
  pet_id                  uuid not null references public.pets on delete cascade,
  clinic_id               uuid references public.clinics,
  vet_id                  uuid references public.profiles,
  clinic_name             text,
  visit_date              date not null default current_date,
  reason                  text,
  diagnosis               text,
  treatment               text,
  notes                   text,
  allergy_override_reason text,
  lab_missing             boolean not null default false,
  created_at              timestamptz not null default now()
);

create table public.access_requests (
  id                uuid primary key default gen_random_uuid(),
  pet_id            uuid not null references public.pets on delete cascade,
  pet_name          text,
  clinic_id         uuid not null references public.clinics,
  requested_by      uuid references public.profiles,
  requested_by_name text,
  kind              text not null default 'request' check (kind in ('request', 'emergency', 'code')),
  status            text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'revoked', 'reported')),
  scope             text not null default 'full' check (scope in ('full', 'vaccinations')),
  duration          text check (duration in ('today', '30d', 'forever', '4h', '10m')),
  reason            text,
  expires_at        timestamptz,        -- null while pending, or for "until I stop it"
  created_at        timestamptz not null default now(),
  decided_at        timestamptz
);
create index on public.access_requests (pet_id);
create index on public.access_requests (clinic_id);

create table public.share_codes (
  code               text primary key,
  pet_id             uuid not null references public.pets on delete cascade,
  scope              text not null,
  duration           text not null,
  expires_at         timestamptz not null,
  redeemed_clinic_id uuid references public.clinics,
  redeemed_clinic    text,
  redeemed_at        timestamptz,
  created_at         timestamptz not null default now()
);

create table public.data_requests (
  id                uuid primary key default gen_random_uuid(),
  pet_id            uuid not null references public.pets on delete cascade,
  visit_id          uuid references public.visits on delete set null,
  clinic_id         uuid not null references public.clinics,
  requested_by_name text,
  note              text,
  status            text not null default 'open' check (status in ('open', 'done')),
  created_at        timestamptz not null default now()
);

-- ───────────────────────── helpers ─────────────────────────

-- Create the profile row as soon as someone signs up (Google or otherwise).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
          new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role and clinic can be chosen once and never changed afterwards.
create function public.profiles_lock() returns trigger language plpgsql as $$
begin
  if old.role is not null and new.role is distinct from old.role then
    raise exception 'ROLE_LOCKED';
  end if;
  if old.clinic_id is not null and new.clinic_id is distinct from old.clinic_id then
    raise exception 'CLINIC_LOCKED';
  end if;
  if new.role = 'vet' and new.clinic_id is null then
    raise exception 'CLINIC_REQUIRED';
  end if;
  return new;
end $$;
create trigger profiles_lock before update on public.profiles
  for each row execute function public.profiles_lock();

create function public.my_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() $$;

create function public.my_clinic() returns uuid language sql stable security definer set search_path = public as $$
  select clinic_id from public.profiles where id = auth.uid() $$;

create function public.is_pet_owner(p_pet uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pets where id = p_pet and owner_id = auth.uid()) $$;

-- What may the signed-in user see of this pet? 'full' | 'vaccinations' | null.
create function public.access_level(p_pet uuid) returns text language sql stable security definer set search_path = public as $$
  select case
    when public.is_pet_owner(p_pet) then 'full'
    when exists (select 1 from public.access_requests r
                 where r.pet_id = p_pet and r.clinic_id = public.my_clinic() and r.status = 'approved'
                   and r.scope = 'full' and (r.expires_at is null or r.expires_at > now())) then 'full'
    when exists (select 1 from public.access_requests r
                 where r.pet_id = p_pet and r.clinic_id = public.my_clinic() and r.status = 'approved'
                   and r.scope = 'vaccinations' and (r.expires_at is null or r.expires_at > now())) then 'vaccinations'
    else null end $$;

create function public._end_of_today() returns timestamptz language sql stable as $$
  select ((date_trunc('day', now() at time zone 'Europe/Vilnius') + interval '1 day' - interval '1 minute')
          at time zone 'Europe/Vilnius') $$;

create function public._expiry(p_duration text) returns timestamptz language sql stable as $$
  select case p_duration
    when 'today'   then public._end_of_today()
    when '30d'     then now() + interval '30 days'
    when '4h'      then now() + interval '4 hours'
    when '10m'     then now() + interval '10 minutes'
    else null end $$;

-- PIN check with lockout: 5 wrong tries lock the owner for 10 minutes.
-- It RETURNS a status instead of raising, because a raised exception would roll back the
-- failure counter and the lockout would never take effect.
create function public._check_pin(p_user uuid, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare s public.user_security;
begin
  select * into s from public.user_security where user_id = p_user;
  if s.pin_hash is null then return 'PIN_NOT_SET'; end if;
  if s.pin_locked_until is not null and s.pin_locked_until > now() then return 'PIN_LOCKED'; end if;
  if p_pin is null or s.pin_hash <> crypt(p_pin, s.pin_hash) then
    update public.user_security
       set pin_locked_until = case when s.pin_fails + 1 >= 5 then now() + interval '10 minutes' end,
           pin_fails = case when s.pin_fails + 1 >= 5 then 0 else s.pin_fails + 1 end
     where user_id = p_user;
    return case when s.pin_fails + 1 >= 5 then 'PIN_LOCKED' else 'PIN_WRONG' end;
  end if;
  update public.user_security set pin_fails = 0, pin_locked_until = null where user_id = p_user;
  return 'ok';
end $$;

-- Allergy classes: a penicillin allergy also covers amoxicillin and friends.
create function public.check_allergy(p_pet uuid, p_treatment text) returns text
language plpgsql stable security definer set search_path = public as $$
declare a record; t text := lower(coalesce(p_treatment, ''));
begin
  if public.access_level(p_pet) is null then raise exception 'NO_ACCESS'; end if;
  for a in select substance from public.pet_alerts where pet_id = p_pet and kind = 'allergy' loop
    if t like '%' || lower(a.substance) || '%' then return a.substance; end if;
    if lower(a.substance) = 'penicillin'
       and (t like '%amoxicillin%' or t like '%ampicillin%' or t like '%clavulan%') then return a.substance; end if;
  end loop;
  return null;
end $$;

-- ───────────────────────── owner onboarding ─────────────────────────

create function public.set_pin(p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.my_role() is distinct from 'owner' then raise exception 'NOT_OWNER'; end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN_FORMAT'; end if;
  if exists (select 1 from public.user_security where user_id = auth.uid() and pin_hash is not null) then
    raise exception 'PIN_ALREADY_SET';
  end if;
  insert into public.user_security (user_id, pin_hash) values (auth.uid(), crypt(p_pin, gen_salt('bf')))
  on conflict (user_id) do update set pin_hash = excluded.pin_hash, pin_fails = 0, pin_locked_until = null;
  update public.profiles set has_pin = true where id = auth.uid();
end $$;

-- ───────────────────────── vet functions ─────────────────────────

-- Lookup by 15-digit microchip or the owner's phone number. Returns identity only, never health data.
create function public.find_pet(p_query text)
returns table (id uuid, name text, species text, breed text, sex text, birth_date date, chip text,
               owner_first_name text, owner_phone_hint text, latest_clinic text)
language plpgsql stable security definer set search_path = public as $$
declare q text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
begin
  if public.my_role() is distinct from 'vet' then raise exception 'NOT_VET'; end if;
  if char_length(q) < 7 then return; end if;
  return query
    select p.id, p.name, p.species, p.breed, p.sex, p.birth_date, p.chip,
           split_part(coalesce(o.full_name, 'Owner'), ' ', 1),
           case when o.phone is null then null
                else '+•••• ' || right(regexp_replace(o.phone, '\D', '', 'g'), 4) end,
           (select v.clinic_name from public.visits v where v.pet_id = p.id order by v.visit_date desc limit 1)
      from public.pets p join public.profiles o on o.id = p.owner_id
     where p.chip = q or regexp_replace(coalesce(o.phone, ''), '\D', '', 'g') = q
     limit 5;
end $$;

create function public.request_access(p_pet uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.profiles; pet public.pets; rid uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role is distinct from 'vet' or me.clinic_id is null then raise exception 'NOT_VET'; end if;
  select * into pet from public.pets where id = p_pet;
  if pet.id is null then raise exception 'NOT_FOUND'; end if;
  select id into rid from public.access_requests
   where pet_id = p_pet and clinic_id = me.clinic_id
     and ((status = 'pending' and created_at > now() - interval '24 hours')
       or (status = 'approved' and (expires_at is null or expires_at > now())))
   order by created_at desc limit 1;
  if rid is not null then return rid; end if;
  insert into public.access_requests (pet_id, pet_name, clinic_id, requested_by, requested_by_name, kind)
  values (p_pet, pet.name, me.clinic_id, me.id, coalesce(me.full_name, me.email), 'request')
  returning id into rid;
  return rid;
end $$;

create function public.emergency_access(p_pet uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.profiles; pet public.pets; rid uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role is distinct from 'vet' or me.clinic_id is null then raise exception 'NOT_VET'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'REASON_REQUIRED'; end if;
  select * into pet from public.pets where id = p_pet;
  if pet.id is null then raise exception 'NOT_FOUND'; end if;
  insert into public.access_requests
    (pet_id, pet_name, clinic_id, requested_by, requested_by_name, kind, status, scope, duration, reason, expires_at, decided_at)
  values (p_pet, pet.name, me.clinic_id, me.id, coalesce(me.full_name, me.email), 'emergency', 'approved',
          'full', '4h', trim(p_reason), now() + interval '4 hours', now())
  returning id into rid;
  return rid;
end $$;

-- Returns {status, request_id, pet_id}. Failures are returned (not raised) so the attempt counter sticks.
create function public.redeem_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.profiles; sec public.user_security; c public.share_codes; pet public.pets; rid uuid;
        clinic_name text; entered text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role is distinct from 'vet' or me.clinic_id is null then raise exception 'NOT_VET'; end if;
  insert into public.user_security (user_id) values (me.id) on conflict do nothing;
  select * into sec from public.user_security where user_id = me.id;
  if sec.code_locked_until is not null and sec.code_locked_until > now() then
    return jsonb_build_object('status', 'CODE_LOCKED');
  end if;
  select * into c from public.share_codes where share_codes.code = entered;
  if c.code is null or c.redeemed_at is not null or c.expires_at < now() then
    update public.user_security
       set code_locked_until = case when sec.code_fails + 1 >= 5 then now() + interval '10 minutes' end,
           code_fails = case when sec.code_fails + 1 >= 5 then 0 else sec.code_fails + 1 end
     where user_id = me.id;
    return jsonb_build_object('status', 'CODE_INVALID');
  end if;
  update public.user_security set code_fails = 0, code_locked_until = null where user_id = me.id;
  select * into pet from public.pets where id = c.pet_id;
  select name into clinic_name from public.clinics where id = me.clinic_id;
  insert into public.access_requests
    (pet_id, pet_name, clinic_id, requested_by, requested_by_name, kind, status, scope, duration, expires_at, decided_at)
  values (c.pet_id, pet.name, me.clinic_id, me.id, coalesce(me.full_name, me.email), 'code', 'approved',
          c.scope, c.duration, public._expiry(c.duration), now())
  returning id into rid;
  update public.share_codes
     set redeemed_clinic_id = me.clinic_id, redeemed_clinic = clinic_name, redeemed_at = now()
   where share_codes.code = c.code;
  return jsonb_build_object('status', 'ok', 'request_id', rid, 'pet_id', c.pet_id);
end $$;

create function public.add_visit(p_pet uuid, p_reason text, p_diagnosis text, p_treatment text,
                                 p_vaccine text, p_batch text, p_next_due date, p_override text)
returns uuid language plpgsql security definer set search_path = public as $$
declare me public.profiles; clinic_name text; vid uuid; conflict text;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role is distinct from 'vet' or me.clinic_id is null then raise exception 'NOT_VET'; end if;
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
  return vid;
end $$;

create function public.request_missing_data(p_pet uuid, p_visit uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role is distinct from 'vet' or public.access_level(p_pet) is distinct from 'full' then raise exception 'NO_ACCESS'; end if;
  insert into public.data_requests (pet_id, visit_id, clinic_id, requested_by_name, note)
  values (p_pet, p_visit, me.clinic_id, coalesce(me.full_name, me.email), p_note);
end $$;

-- ───────────────────────── owner functions ─────────────────────────

create function public.respond_to_request(p_request uuid, p_decision text, p_scope text, p_duration text, p_pin text)
returns text language plpgsql security definer set search_path = public as $$
declare r public.access_requests; st text;
begin
  select * into r from public.access_requests where id = p_request;
  if r.id is null or not public.is_pet_owner(r.pet_id) then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'pending' then raise exception 'ALREADY_DECIDED'; end if;
  if r.created_at < now() - interval '24 hours' then raise exception 'REQUEST_EXPIRED'; end if;
  if p_decision = 'decline' then
    update public.access_requests set status = 'declined', decided_at = now() where id = p_request;
  elsif p_decision = 'approve' then
    if p_scope not in ('full', 'vaccinations') or p_duration not in ('today', '30d', 'forever') then
      raise exception 'BAD_CHOICE';
    end if;
    st := public._check_pin(auth.uid(), p_pin);
    if st <> 'ok' then return st; end if;
    update public.access_requests
       set status = 'approved', scope = p_scope, duration = p_duration,
           expires_at = public._expiry(p_duration), decided_at = now()
     where id = p_request;
  else
    raise exception 'BAD_CHOICE';
  end if;
  return 'ok';
end $$;

create function public.stop_sharing(p_request uuid, p_report boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare r public.access_requests;
begin
  select * into r from public.access_requests where id = p_request;
  if r.id is null or not public.is_pet_owner(r.pet_id) then raise exception 'NOT_FOUND'; end if;
  update public.access_requests
     set status = case when p_report then 'reported' else 'revoked' end,
         expires_at = now(), decided_at = now()
   where id = p_request and status in ('pending', 'approved');
end $$;

create function public.create_share_code(p_pet uuid, p_scope text, p_duration text, p_pin text)
returns table (code text, expires_at timestamptz, status text) language plpgsql security definer set search_path = public as $$
declare c text; exp timestamptz := now() + interval '10 minutes'; st text;
begin
  if not public.is_pet_owner(p_pet) then raise exception 'NOT_FOUND'; end if;
  if p_scope not in ('full', 'vaccinations') or p_duration not in ('today', '30d', 'forever') then
    raise exception 'BAD_CHOICE';
  end if;
  st := public._check_pin(auth.uid(), p_pin);
  if st <> 'ok' then
    return query select null::text, null::timestamptz, st;
    return;
  end if;
  loop
    c := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.share_codes s where s.code = c);
  end loop;
  insert into public.share_codes (code, pet_id, scope, duration, expires_at) values (c, p_pet, p_scope, p_duration, exp);
  return query select c, exp, 'ok'::text;
end $$;

-- ───────────────────────── row level security ─────────────────────────

alter table public.clinics         enable row level security;
alter table public.profiles        enable row level security;
alter table public.user_security   enable row level security;
alter table public.pets            enable row level security;
alter table public.pet_alerts      enable row level security;
alter table public.vaccinations    enable row level security;
alter table public.visits          enable row level security;
alter table public.access_requests enable row level security;
alter table public.share_codes     enable row level security;
alter table public.data_requests   enable row level security;

create policy clinics_read   on public.clinics for select to authenticated using (true);
create policy clinics_create on public.clinics for insert to authenticated with check (verified = false);

create policy profiles_read   on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant  update (role, full_name, phone, clinic_id) on public.profiles to authenticated;
revoke insert, delete on public.profiles from authenticated;

create policy pets_read   on public.pets for select to authenticated using (public.access_level(id) is not null);
create policy pets_insert on public.pets for insert to authenticated
  with check (owner_id = auth.uid() and public.my_role() = 'owner');
create policy pets_update on public.pets for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy pets_delete on public.pets for delete to authenticated using (owner_id = auth.uid());

create policy alerts_read   on public.pet_alerts for select to authenticated using (public.access_level(pet_id) is not null);
create policy alerts_write  on public.pet_alerts for insert to authenticated with check (public.is_pet_owner(pet_id));
create policy alerts_delete on public.pet_alerts for delete to authenticated using (public.is_pet_owner(pet_id));

create policy vacc_read   on public.vaccinations for select to authenticated using (public.access_level(pet_id) is not null);
create policy vacc_write  on public.vaccinations for insert to authenticated with check (public.is_pet_owner(pet_id));
create policy vacc_delete on public.vaccinations for delete to authenticated using (public.is_pet_owner(pet_id));

-- Full access sees the whole history; a "vaccinations only" clinic still sees the visits it wrote itself.
create policy visits_read on public.visits for select to authenticated
  using (public.access_level(pet_id) = 'full'
         or (clinic_id is not null and clinic_id = public.my_clinic() and public.access_level(pet_id) is not null));
create policy visits_owner_insert on public.visits for insert to authenticated
  with check (public.is_pet_owner(pet_id) and clinic_id is null and vet_id is null);

create policy requests_read on public.access_requests for select to authenticated
  using (public.is_pet_owner(pet_id) or clinic_id = public.my_clinic());

create policy codes_read on public.share_codes for select to authenticated using (public.is_pet_owner(pet_id));

create policy datareq_read on public.data_requests for select to authenticated
  using (public.is_pet_owner(pet_id) or clinic_id = public.my_clinic());
create policy datareq_owner_update on public.data_requests for update to authenticated
  using (public.is_pet_owner(pet_id)) with check (public.is_pet_owner(pet_id));

-- ───────────────────────── privileges ─────────────────────────

-- Functions: signed-in users only. Helpers starting with "_" are internal and not callable from the app.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname not in ('handle_new_user', 'profiles_lock') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if left(f.proname, 1) = '_' then
      execute format('revoke all on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
-- Trigger functions must not be callable through the API; pin the search_path of the helpers.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.profiles_lock()   from public, anon, authenticated;
alter function public._end_of_today() set search_path = public;
alter function public._expiry(text)   set search_path = public;
alter function public.profiles_lock() set search_path = public;
revoke all on public.user_security from anon, authenticated;
revoke all on all tables in schema public from anon;

-- ───────────────────────── sample clinics ─────────────────────────

insert into public.clinics (name, city, country, verified) values
  ('Vilnius Animal Clinic',    'Vilnius', 'Lithuania', true),
  ('Kaunas Pet Hospital',      'Kaunas',  'Lithuania', true),
  ('Riga Vet Centre',          'Riga',    'Latvia',    true),
  ('Tartu Lemmikloomakliinik', 'Tartu',   'Estonia',   true);
