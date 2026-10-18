-- Naskah: skema Supabase. Jalankan sekali di Dashboard > SQL Editor.

create table if not exists public.scripts (
  id text primary key check (id ~ '^[a-z0-9]{8,64}$'),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '',
  state text,                              -- snapshot Yjs (base64) hasil pemadatan
  state_upto bigint not null default 0,    -- id update terakhir yang sudah masuk snapshot
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id text primary key check (id ~ '^[a-z0-9]{4,64}$'),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now()
);
alter table public.scripts
  add column if not exists project_id text references public.projects(id) on delete set null;

create table if not exists public.project_members (   -- kolaborator tingkat proyek
  project_id text not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (project_id, user_id)
);

create table if not exists public.script_members (
  script_id text not null references public.scripts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (script_id, user_id)
);

create table if not exists public.script_updates (   -- log perubahan Yjs (hanya ditambah)
  id bigint generated always as identity primary key,
  script_id text not null references public.scripts(id) on delete cascade,
  client bigint not null,
  data text not null,                                 -- update Yjs (base64)
  created_at timestamptz not null default now()
);
create index if not exists script_updates_script_idx on public.script_updates (script_id, id);

-- Fungsi bantu (security definer agar kebijakan RLS tidak saling berputar)
create or replace function public.is_owner(sid text) returns boolean
language sql security definer stable set search_path = public as
$$ select exists (select 1 from public.scripts where id = sid and owner = auth.uid()) $$;

create or replace function public.is_project_owner(pid text) returns boolean
language sql security definer stable set search_path = public as
$$ select exists (select 1 from public.projects where id = pid and owner = auth.uid()) $$;

create or replace function public.has_project_access(pid text) returns boolean
language sql security definer stable set search_path = public as
$$ select public.is_project_owner(pid)
        or exists (select 1 from public.project_members where project_id = pid and user_id = auth.uid()) $$;

-- Akses ke script: pemilik, anggota script, atau anggota/pemilik proyek tempat script berada
create or replace function public.has_access(sid text) returns boolean
language sql security definer stable set search_path = public as
$$ select public.is_owner(sid)
        or exists (select 1 from public.script_members where script_id = sid and user_id = auth.uid())
        or exists (select 1 from public.scripts s
                    where s.id = sid and s.project_id is not null
                      and public.has_project_access(s.project_id)) $$;

alter table public.scripts        enable row level security;
alter table public.script_members enable row level security;
alter table public.projects       enable row level security;
alter table public.project_members enable row level security;
alter table public.script_updates enable row level security;

drop policy if exists projects_all on public.projects;
drop policy if exists projects_select on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;
drop policy if exists pm_select on public.project_members;
drop policy if exists pm_delete on public.project_members;
drop policy if exists scripts_select on public.scripts;
drop policy if exists scripts_insert on public.scripts;
drop policy if exists scripts_update on public.scripts;
drop policy if exists scripts_delete on public.scripts;
drop policy if exists members_select on public.script_members;
drop policy if exists members_delete on public.script_members;
drop policy if exists updates_select on public.script_updates;
drop policy if exists updates_insert on public.script_updates;

create policy scripts_select on public.scripts for select to authenticated
  using (owner = auth.uid() or public.has_access(id));
create policy projects_select on public.projects for select to authenticated
  using (owner = auth.uid() or public.has_project_access(id));
create policy projects_insert on public.projects for insert to authenticated
  with check (owner = auth.uid());
create policy projects_update on public.projects for update to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy projects_delete on public.projects for delete to authenticated
  using (owner = auth.uid());
create policy pm_select on public.project_members for select to authenticated
  using (user_id = auth.uid() or public.is_project_owner(project_id));
create policy pm_delete on public.project_members for delete to authenticated
  using (public.is_project_owner(project_id));

-- anggota proyek boleh membuat script di proyek itu; memindahkan script hanya oleh pemilik script
create policy scripts_insert on public.scripts for insert to authenticated
  with check (owner = auth.uid() and (project_id is null or public.has_project_access(project_id)));
create policy scripts_update on public.scripts for update to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid() and (project_id is null or public.has_project_access(project_id)));
create policy scripts_delete on public.scripts for delete to authenticated
  using (owner = auth.uid());

create policy members_select on public.script_members for select to authenticated
  using (user_id = auth.uid() or public.is_owner(script_id));
create policy members_delete on public.script_members for delete to authenticated
  using (public.is_owner(script_id));

create policy updates_select on public.script_updates for select to authenticated
  using (public.has_access(script_id));
create policy updates_insert on public.script_updates for insert to authenticated
  with check (public.has_access(script_id));

-- Undang kolaborator lewat email (hanya pemilik; orangnya harus sudah punya akun)
create or replace function public.invite_member(p_sid text, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_owner(p_sid) then raise exception 'not_owner'; end if;
  select u.id into uid from auth.users u where lower(u.email) = lower(p_email) limit 1;
  if uid is null then raise exception 'user_not_found'; end if;
  insert into public.script_members (script_id, user_id) values (p_sid, uid) on conflict do nothing;
end $$;

-- Undang kolaborator ke proyek: otomatis bisa membuka semua script di proyek itu
create or replace function public.invite_project_member(p_pid text, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_project_owner(p_pid) then raise exception 'not_owner'; end if;
  select u.id into uid from auth.users u where lower(u.email) = lower(p_email) limit 1;
  if uid is null then raise exception 'user_not_found'; end if;
  insert into public.project_members (project_id, user_id) values (p_pid, uid) on conflict do nothing;
end $$;

-- Ubah judul script (boleh oleh siapa pun yang punya akses)
create or replace function public.set_title(p_sid text, p_title text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_access(p_sid) then raise exception 'no_access'; end if;
  update public.scripts set title = left(p_title, 120) where id = p_sid;
end $$;

-- Padatkan log update menjadi satu snapshot
create or replace function public.compact_script(p_sid text, p_snapshot text, p_upto bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_access(p_sid) then raise exception 'no_access'; end if;
  update public.scripts set state = p_snapshot, state_upto = p_upto
   where id = p_sid and p_upto >= state_upto;
  if found then
    delete from public.script_updates where script_id = p_sid and id <= p_upto;
  end if;
end $$;

-- Perbarui updated_at tiap ada perubahan baru
create or replace function public.touch_script() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.scripts set updated_at = now() where id = new.script_id;
  return new;
end $$;
drop trigger if exists script_updates_touch on public.script_updates;
create trigger script_updates_touch after insert on public.script_updates
  for each row execute function public.touch_script();

revoke all on function public.is_owner(text), public.has_access(text),
  public.invite_member(text, text), public.compact_script(text, text, bigint)
  from public, anon;
grant execute on function public.is_owner(text), public.has_access(text),
  public.invite_member(text, text), public.compact_script(text, text, bigint)
  to authenticated;

revoke all on function public.is_project_owner(text), public.has_project_access(text),
  public.invite_project_member(text, text), public.set_title(text, text) from public, anon;
grant execute on function public.is_project_owner(text), public.has_project_access(text),
  public.invite_project_member(text, text), public.set_title(text, text) to authenticated;

-- Sinkronisasi realtime antar kolaborator
do $$ begin
  alter publication supabase_realtime add table public.script_updates;
exception when duplicate_object then null;
end $$;