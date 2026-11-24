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
