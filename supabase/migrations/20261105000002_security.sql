-- =============================================================================
-- Migration 002: Role helper, profil otomatis, pelacakan edit manual,
--                audit trail, dan Row Level Security
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper peran (SECURITY DEFINER agar tidak rekursif terhadap RLS profiles)
-- -----------------------------------------------------------------------------
create or replace function public.current_role_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.code
    from public.profiles p
    join public.roles r on r.id = p.role_id
   where p.id = auth.uid()
     and p.is_active
$$;

create or replace function public.has_any_role(variadic codes text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role_code() = any(codes), false)
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_code() is not null
$$;

-- Hak lihat berdasarkan tingkat akses dokumen/arsip
--   biasa    : semua pengguna aktif
--   terbatas : super_admin, admin_arsip, pimpinan, dan pengunggah
--   rahasia  : super_admin, admin_arsip, pimpinan
create or replace function public.can_access_level(p_level text, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_level
           when 'biasa'    then public.is_active_user()
           when 'terbatas' then public.has_any_role('super_admin','admin_arsip','pimpinan')
                                or (public.is_active_user() and p_owner = auth.uid())
           when 'rahasia'  then public.has_any_role('super_admin','admin_arsip','pimpinan')
           else false
         end
$$;

revoke all on function public.current_role_code() from public, anon;
revoke all on function public.has_any_role(text[]) from public, anon;
revoke all on function public.is_active_user() from public, anon;
revoke all on function public.can_access_level(text, uuid) from public, anon;
grant execute on function public.current_role_code() to authenticated;
grant execute on function public.has_any_role(text[]) to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.can_access_level(text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Profil otomatis untuk akun baru
--   * Akun pertama di sistem  -> Super Admin aktif (bootstrap).
--   * Akun berikutnya          -> Operator NONAKTIF sampai diaktifkan Super Admin.
--   Peran dari metadata pendaftaran TIDAK dipercaya; penetapan peran dilakukan
--   oleh Edge Function admin-users (service role) atau Super Admin.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_first boolean;
  v_role uuid;
begin
  perform pg_advisory_xact_lock(hashtext('e_arsip_handle_new_user'));
  select not exists (select 1 from public.profiles) into v_is_first;
  select id into v_role from public.roles
   where code = case when v_is_first then 'super_admin' else 'operator' end;

  insert into public.profiles (id, email, full_name, role_id, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, ''), '@', 1)), 150),
    v_role,
    v_is_first
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Lindungi kolom sensitif profil: hanya Super Admin yang boleh mengubah
-- peran, status aktif, dan email. Super Admin aktif terakhir tidak boleh
-- menonaktifkan / menurunkan dirinya sendiri.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_super uuid;
  v_remaining integer;
begin
  -- Perubahan oleh service role / proses sistem (tanpa auth.uid) diizinkan
  if auth.uid() is null or coalesce(current_setting('app.restoring', true), '') = 'on' then
    return new;
  end if;

  if not public.has_any_role('super_admin') then
    new.role_id   := old.role_id;
    new.is_active := old.is_active;
    new.email     := old.email;
    new.last_login_at := old.last_login_at;
    return new;
  end if;

  select id into v_super from public.roles where code = 'super_admin';
  if old.role_id = v_super and old.is_active
     and (new.role_id <> v_super or not new.is_active) then
    select count(*) into v_remaining
      from public.profiles
     where role_id = v_super and is_active and id <> old.id;
    if v_remaining = 0 then
      raise exception 'Tidak dapat menonaktifkan atau menurunkan Super Admin aktif terakhir'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_fields
before update on public.profiles
for each row execute function public.protect_profile_fields();

-- Kode peran sistem tidak boleh diubah
create or replace function public.protect_role_code()
returns trigger
language plpgsql
as $$
begin
  if new.code <> old.code or new.is_system <> old.is_system then
    raise exception 'Kode peran sistem tidak dapat diubah' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger roles_protect_code
before update on public.roles
for each row execute function public.protect_role_code();

-- -----------------------------------------------------------------------------
-- Pelacakan data hasil impor vs edit manual
--   Dipasang pada applicants, companies, applications, permits.
--   TG_ARGV = daftar kolom yang berasal dari SiCANTIK. Bila pengguna mengubah
--   salah satunya, baris ditandai is_manually_edited sehingga impor berikutnya
--   meminta konfirmasi sebelum menimpa.
--   Kolom pelacak impor (data_source, source_*, *_import_batch_id) hanya dapat
--   diubah oleh proses impor (app.importing = 'on').
-- -----------------------------------------------------------------------------
create or replace function public.track_record_changes()
returns trigger
language plpgsql
as $$
declare
  v_importing boolean := coalesce(current_setting('app.importing', true), '') = 'on'
                         or coalesce(current_setting('app.restoring', true), '') = 'on';
  v_col text;
  v_changed text[] := '{}';
  v_old jsonb;
  v_new jsonb;
begin
  if v_importing then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.data_source            := 'manual';
    new.source_data            := null;
    new.source_hash            := null;
    new.first_import_batch_id  := null;
    new.last_import_batch_id   := null;
    new.is_manually_edited     := false;
    new.manually_edited_fields := '{}';
    new.manually_edited_at     := null;
    new.manually_edited_by     := null;
    new.created_by             := coalesce(auth.uid(), new.created_by);
    return new;
  end if;

  -- UPDATE oleh pengguna
  new.data_source           := old.data_source;
  new.source_data           := old.source_data;
  new.source_hash           := old.source_hash;
  new.first_import_batch_id := old.first_import_batch_id;
  new.last_import_batch_id  := old.last_import_batch_id;
  new.created_by            := old.created_by;
  new.created_at            := old.created_at;
  new.updated_by            := coalesce(auth.uid(), new.updated_by);

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  foreach v_col in array tg_argv loop
    if (v_old -> v_col) is distinct from (v_new -> v_col) then
      v_changed := array_append(v_changed, v_col);
    end if;
  end loop;

  if old.data_source = 'import' and cardinality(v_changed) > 0 then
    new.is_manually_edited     := true;
    new.manually_edited_fields := (select array_agg(distinct f order by f)
                                     from unnest(old.manually_edited_fields || v_changed) f);
    new.manually_edited_at     := now();
    new.manually_edited_by     := auth.uid();
  else
    new.is_manually_edited     := old.is_manually_edited;
    new.manually_edited_fields := old.manually_edited_fields;
    new.manually_edited_at     := old.manually_edited_at;
    new.manually_edited_by     := old.manually_edited_by;
  end if;
  return new;
end;
$$;

create trigger applicants_track_changes
before insert or update on public.applicants
for each row execute function public.track_record_changes('nik','full_name','phone','email','address');

create trigger companies_track_changes
before insert or update on public.companies
for each row execute function public.track_record_changes('name','business_form','nib','npwp','address','applicant_id');

create trigger applications_track_changes
before insert or update on public.applications
for each row execute function public.track_record_changes(
  'application_number','applicant_id','company_id','permit_type_id','application_type',
  'application_date','location','permit_location','status');

create trigger permits_track_changes
before insert or update on public.permits
for each row execute function public.track_record_changes('permit_number','issued_date','valid_until','status');

-- Stempel pembuat/pengubah untuk tabel master lain
create or replace function public.stamp_user_columns()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.restoring', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end;
$$;

create trigger classifications_stamp before insert or update on public.classifications
for each row execute function public.stamp_user_columns();
create trigger permit_types_stamp before insert or update on public.permit_types
for each row execute function public.stamp_user_columns();

-- Dokumen: pengunggah selalu pengguna saat ini; metadata file tidak dapat diubah
create or replace function public.protect_document_fields()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.restoring', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
    new.deleted_at := null;
    new.deleted_by := null;
    return new;
  end if;
  new.application_id    := old.application_id;
  new.storage_bucket    := old.storage_bucket;
  new.storage_path      := old.storage_path;
  new.file_name         := old.file_name;
  new.file_size         := old.file_size;
  new.mime_type         := old.mime_type;
  new.checksum_sha256   := old.checksum_sha256;
  new.document_group_id := old.document_group_id;
  new.version           := old.version;
  new.uploaded_by       := old.uploaded_by;
  new.created_at        := old.created_at;
  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger archive_documents_protect
before insert or update on public.archive_documents
for each row execute function public.protect_document_fields();

-- Batch impor: pengimpor selalu pengguna saat ini
create or replace function public.stamp_import_batch()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.restoring', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.imported_by := coalesce(auth.uid(), new.imported_by);
  else
    new.imported_by := old.imported_by;
  end if;
  return new;
end;
$$;

create trigger import_batches_stamp before insert or update on public.import_batches
for each row execute function public.stamp_import_batch();

-- -----------------------------------------------------------------------------
-- Audit trail
-- -----------------------------------------------------------------------------
create or replace function public.write_activity_log(
  p_action      text,
  p_entity_type text,
  p_entity_id   text,
  p_description text,
  p_old_data    jsonb default null,
  p_new_data    jsonb default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_role text;
begin
  select p.email, r.code into v_email, v_role
    from public.profiles p join public.roles r on r.id = p.role_id
   where p.id = auth.uid();

  insert into public.activity_logs (user_id, user_email, user_role, action, entity_type, entity_id,
                                    description, old_data, new_data, metadata)
  values (auth.uid(), v_email, v_role, p_action, p_entity_type, p_entity_id,
          p_description, p_old_data, p_new_data, coalesce(p_metadata, '{}'::jsonb));
end;
$$;
revoke all on function public.write_activity_log(text,text,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;

-- Dipanggil dari aplikasi untuk peristiwa non-DML (login, unduh, pratinjau, ekspor)
create or replace function public.log_activity(
  p_action      text,
  p_entity_type text default null,
  p_entity_id   text default null,
  p_description text default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Tidak terautentikasi' using errcode = '28000';
  end if;
  if p_action !~ '^[a-z_.]{2,60}$' then
    raise exception 'Aksi log tidak valid' using errcode = '22023';
  end if;
  if p_action in ('insert','update','delete') then
    raise exception 'Aksi DML dicatat otomatis oleh sistem' using errcode = '22023';
  end if;
  perform public.write_activity_log(p_action, p_entity_type, p_entity_id, left(p_description, 500),
                                    null, null, coalesce(p_metadata, '{}'::jsonb));
end;
$$;
revoke all on function public.log_activity(text,text,text,text,jsonb) from public, anon;
grant execute on function public.log_activity(text,text,text,text,jsonb) to authenticated;

create or replace function public.touch_last_login()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  update public.profiles set last_login_at = now() where id = auth.uid();
  perform public.write_activity_log('login', 'profiles', auth.uid()::text, 'Masuk ke aplikasi');
end;
$$;
revoke all on function public.touch_last_login() from public, anon;
grant execute on function public.touch_last_login() to authenticated;

-- Trigger audit generik. Selama impor massal (app.importing = 'on') log
-- per-baris dilewati; ringkasan dicatat sekali per batch oleh fungsi impor.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_diff_old jsonb := '{}'::jsonb;
  v_diff_new jsonb := '{}'::jsonb;
  v_key text;
  v_id text;
  v_ignore text[] := array['updated_at','updated_by','source_data','source_hash','last_login_at'];
begin
  if coalesce(current_setting('app.importing', true), '') = 'on'
     or coalesce(current_setting('app.restoring', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    v_new := to_jsonb(new) - v_ignore;
    v_id := v_new->>'id';
    perform public.write_activity_log('insert', tg_table_name, v_id, 'Menambah data ' || tg_table_name, null, v_new);
    return new;
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old) - v_ignore;
    v_id := v_old->>'id';
    perform public.write_activity_log('delete', tg_table_name, v_id, 'Menghapus data ' || tg_table_name, v_old, null);
    return old;
  end if;

  v_old := to_jsonb(old) - v_ignore;
  v_new := to_jsonb(new) - v_ignore;
  for v_key in select jsonb_object_keys(v_new) loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      v_diff_old := v_diff_old || jsonb_build_object(v_key, v_old -> v_key);
      v_diff_new := v_diff_new || jsonb_build_object(v_key, v_new -> v_key);
    end if;
  end loop;
  if v_diff_new = '{}'::jsonb then
    return new;
  end if;
  v_id := v_new->>'id';
  perform public.write_activity_log('update', tg_table_name, v_id, 'Mengubah data ' || tg_table_name,
                                    v_diff_old, v_diff_new);
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['roles','profiles','classifications','permit_types','applicants','companies',
                           'applications','permits','archive_documents','system_settings']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.roles             enable row level security;
alter table public.profiles          enable row level security;
alter table public.classifications   enable row level security;
alter table public.permit_types      enable row level security;
alter table public.import_batches    enable row level security;
alter table public.applicants        enable row level security;
alter table public.companies         enable row level security;
alter table public.applications      enable row level security;
alter table public.permits           enable row level security;
alter table public.archive_documents enable row level security;
alter table public.import_errors     enable row level security;
alter table public.activity_logs     enable row level security;
alter table public.system_settings   enable row level security;

-- Pengguna anonim tidak mendapat akses apa pun ke tabel aplikasi
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- roles
create policy roles_select on public.roles for select to authenticated
  using (public.is_active_user() or id = (select role_id from public.profiles where id = auth.uid()));
create policy roles_update on public.roles for update to authenticated
  using (public.has_any_role('super_admin')) with check (public.has_any_role('super_admin'));

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.has_any_role('super_admin')) with check (public.has_any_role('super_admin'));

-- classifications & permit_types: baca semua pengguna aktif, kelola admin
create policy classifications_select on public.classifications for select to authenticated
  using (public.is_active_user());
create policy classifications_insert on public.classifications for insert to authenticated
  with check (public.has_any_role('super_admin','admin_arsip'));
create policy classifications_update on public.classifications for update to authenticated
  using (public.has_any_role('super_admin','admin_arsip')) with check (public.has_any_role('super_admin','admin_arsip'));
create policy classifications_delete on public.classifications for delete to authenticated
  using (public.has_any_role('super_admin','admin_arsip'));

create policy permit_types_select on public.permit_types for select to authenticated
  using (public.is_active_user());
create policy permit_types_insert on public.permit_types for insert to authenticated
  with check (public.has_any_role('super_admin','admin_arsip'));
create policy permit_types_update on public.permit_types for update to authenticated
  using (public.has_any_role('super_admin','admin_arsip')) with check (public.has_any_role('super_admin','admin_arsip'));
create policy permit_types_delete on public.permit_types for delete to authenticated
  using (public.has_any_role('super_admin','admin_arsip'));

-- Data arsip inti: applicants, companies, applications, permits
--   SELECT : semua pengguna aktif
--   INSERT : super_admin, admin_arsip, operator
--   UPDATE : super_admin, admin_arsip; operator hanya data yang ia buat sendiri
--   DELETE : super_admin, admin_arsip
do $$
declare t text;
begin
  foreach t in array array['applicants','companies','applications','permits'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using (public.is_active_user());
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check (public.has_any_role('super_admin','admin_arsip','operator'));
      create policy %1$s_update on public.%1$s for update to authenticated
        using (public.has_any_role('super_admin','admin_arsip')
               or (public.has_any_role('operator') and created_by = auth.uid()))
        with check (public.has_any_role('super_admin','admin_arsip')
               or (public.has_any_role('operator') and created_by = auth.uid()));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using (public.has_any_role('super_admin','admin_arsip'));
    $f$, t);
  end loop;
end $$;

-- archive_documents
create policy archive_documents_select on public.archive_documents for select to authenticated
  using (
    public.can_access_level(access_level, uploaded_by)
    and (deleted_at is null or public.has_any_role('super_admin','admin_arsip'))
  );
create policy archive_documents_insert on public.archive_documents for insert to authenticated
  with check (
    public.has_any_role('super_admin','admin_arsip','operator')
    and (access_level <> 'rahasia' or public.has_any_role('super_admin','admin_arsip'))
  );
create policy archive_documents_update on public.archive_documents for update to authenticated
  using (public.has_any_role('super_admin','admin_arsip')
         or (public.has_any_role('operator') and uploaded_by = auth.uid() and deleted_at is null))
  with check (public.has_any_role('super_admin','admin_arsip')
         or (public.has_any_role('operator') and uploaded_by = auth.uid() and deleted_at is null
             and access_level <> 'rahasia'));
create policy archive_documents_delete on public.archive_documents for delete to authenticated
  using (public.has_any_role('super_admin'));

-- import_batches: riwayat terlihat oleh semua pengguna aktif (dashboard),
-- dikelola Super Admin & Admin Arsip
create policy import_batches_select on public.import_batches for select to authenticated
  using (public.is_active_user());
create policy import_batches_insert on public.import_batches for insert to authenticated
  with check (public.has_any_role('super_admin','admin_arsip'));
create policy import_batches_update on public.import_batches for update to authenticated
  using (public.has_any_role('super_admin','admin_arsip')) with check (public.has_any_role('super_admin','admin_arsip'));
create policy import_batches_delete on public.import_batches for delete to authenticated
  using (public.has_any_role('super_admin'));

-- import_errors: berisi data mentah (NIK dsb.) -> hanya pengelola impor
create policy import_errors_select on public.import_errors for select to authenticated
  using (public.has_any_role('super_admin','admin_arsip'));
create policy import_errors_insert on public.import_errors for insert to authenticated
  with check (public.has_any_role('super_admin','admin_arsip'));

-- activity_logs: append-only. Tidak ada policy INSERT/UPDATE/DELETE untuk klien;
-- penulisan hanya lewat fungsi SECURITY DEFINER.
create policy activity_logs_select on public.activity_logs for select to authenticated
  using (public.has_any_role('super_admin','admin_arsip','pimpinan') or user_id = auth.uid());

-- system_settings
create policy system_settings_select on public.system_settings for select to authenticated
  using ((is_public and public.is_active_user()) or public.has_any_role('super_admin'));
create policy system_settings_insert on public.system_settings for insert to authenticated
  with check (public.has_any_role('super_admin'));
create policy system_settings_update on public.system_settings for update to authenticated
  using (public.has_any_role('super_admin')) with check (public.has_any_role('super_admin'));
create policy system_settings_delete on public.system_settings for delete to authenticated
  using (public.has_any_role('super_admin'));

-- Kunci kolom system_settings.updated_by
create or replace function public.stamp_settings()
returns trigger
language plpgsql
as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
create trigger system_settings_stamp before insert or update on public.system_settings
for each row execute function public.stamp_settings();

-- Admin Arsip boleh menyimpan template pemetaan kolom impor
create policy system_settings_update_import_templates on public.system_settings for update to authenticated
  using (key = 'import.mapping_templates' and public.has_any_role('admin_arsip'))
  with check (key = 'import.mapping_templates' and public.has_any_role('admin_arsip'));
