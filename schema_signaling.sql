-- Naskah: alamat server signaling (mis. ngrok) per naskah / per proyek.
-- Jalankan sekali di Dashboard > SQL Editor, SETELAH schema.sql utama.
-- Aman dijalankan ulang.

-- Bersihkan versi sebelumnya (satu admin global), kalau sempat dijalankan.
drop function if exists public.set_signaling(text);
drop function if exists public.claim_admin();
drop function if exists public.is_app_admin();
drop table if exists public.app_settings;
drop table if exists public.app_admins;

-- Alamat disimpan di naskah dan di proyek. Dipakai: milik naskah, kalau kosong milik proyeknya.
alter table public.scripts
  add column if not exists signaling text not null default '' check (length(signaling) <= 1000);
alter table public.projects
  add column if not exists signaling text not null default '' check (length(signaling) <= 1000);

-- Rapikan daftar alamat: satu per baris / dipisah spasi atau koma. https:// otomatis jadi wss://.
create or replace function public.normalize_signaling(p_urls text) returns text
language plpgsql immutable set search_path = public as $$
declare
  raw text;
  v text;
  res text[] := '{}';
begin
  for raw in select regexp_split_to_table(coalesce(p_urls, ''), '[\s,]+') loop
    v := trim(raw);
    if v = '' then continue; end if;
    v := regexp_replace(v, '^https://', 'wss://', 'i');
    v := regexp_replace(v, '^http://', 'ws://', 'i');
    v := regexp_replace(v, '/+$', '');
    if v !~* '^wss?://[a-z0-9._-]+(:[0-9]{1,5})?(/[^\s]*)?$' then raise exception 'bad_url'; end if;
    -- skema & nama host tidak membedakan huruf besar/kecil (path tetap apa adanya)
    v := lower(substring(v from '(?i)^wss?://[^/]+')) || substring(v from '(?i)^wss?://[^/]+(.*)$');
    if not (v = any(res)) then res := res || v; end if;
  end loop;
  if coalesce(array_length(res, 1), 0) > 5 then raise exception 'too_many'; end if;
  return array_to_string(res, E'\n');
end $$;

-- Hanya pemilik naskah yang boleh mengubah alamat naskah
create or replace function public.set_script_signaling(p_sid text, p_urls text) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not public.is_owner(p_sid) then raise exception 'not_owner'; end if;
  v := public.normalize_signaling(p_urls);
  update public.scripts set signaling = v where id = p_sid;
  return v;
end $$;

-- Hanya pemilik proyek yang boleh mengubah alamat proyek (berlaku untuk semua naskah di dalamnya)
create or replace function public.set_project_signaling(p_pid text, p_urls text) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not public.is_project_owner(p_pid) then raise exception 'not_owner'; end if;
  v := public.normalize_signaling(p_urls);
  update public.projects set signaling = v where id = p_pid;
  return v;
end $$;

revoke all on function public.normalize_signaling(text),
  public.set_script_signaling(text, text), public.set_project_signaling(text, text)
  from public, anon;
grant execute on function public.set_script_signaling(text, text),
  public.set_project_signaling(text, text) to authenticated;

-- Kolaborator yang sedang membuka naskah langsung dapat alamat baru
do $$ begin
  alter publication supabase_realtime add table public.scripts;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.projects;
exception when duplicate_object then null;
end $$;
