-- =============================================================================
-- E-ARSIP PERIZINAN DPMPTSP KABUPATEN BELU
-- Migration 001: Skema inti (tabel, relasi, constraint, indeks)
-- =============================================================================
-- Prinsip:
--   * UUID sebagai primary key internal; ID SiCANTIK disimpan terpisah (source_id).
--   * Kolom data_source/source_data/source_hash untuk melacak asal data impor
--     dan mendeteksi perubahan pada impor berikutnya.
--   * is_manually_edited + manually_edited_fields menandai data yang diubah
--     manual sehingga impor tidak menimpanya tanpa konfirmasi.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- -----------------------------------------------------------------------------
-- Fungsi utilitas umum
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.restoring', true), '') = 'on' then
    return new;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- roles
-- -----------------------------------------------------------------------------
create table public.roles (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code ~ '^[a-z][a-z_]{2,40}$'),
  name          text not null check (length(btrim(name)) between 2 and 100),
  description   text,
  permissions   jsonb not null default '{}'::jsonb,
  is_system     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.roles is 'Peran pengguna (Super Admin, Admin Arsip, Operator, Pimpinan).';

-- -----------------------------------------------------------------------------
-- profiles (1:1 dengan auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null,
  full_name      text not null default '' check (length(full_name) <= 150),
  nip            text check (nip is null or nip ~ '^[0-9 ]{8,25}$'),
  position       text check (length(position) <= 150),
  phone          text check (length(phone) <= 30),
  role_id        uuid not null references public.roles(id) on update cascade,
  is_active      boolean not null default false,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index profiles_role_idx on public.profiles(role_id);
create unique index profiles_email_key on public.profiles(lower(email));
comment on table public.profiles is 'Profil pengguna aplikasi. Dibuat otomatis saat akun auth dibuat.';

-- -----------------------------------------------------------------------------
-- classifications (klasifikasi arsip & jadwal retensi)
-- -----------------------------------------------------------------------------
create table public.classifications (
  id                        uuid primary key default gen_random_uuid(),
  code                      text not null unique check (length(btrim(code)) between 1 and 50),
  name                      text not null check (length(btrim(name)) between 2 and 200),
  description               text,
  parent_id                 uuid references public.classifications(id) on delete set null,
  retention_active_years    integer not null default 2 check (retention_active_years between 0 and 100),
  retention_inactive_years  integer not null default 5 check (retention_inactive_years between 0 and 100),
  final_disposition         text not null default 'dinilai_kembali'
                              check (final_disposition in ('musnah','permanen','dinilai_kembali')),
  security_level            text not null default 'biasa'
                              check (security_level in ('biasa','terbatas','rahasia')),
  is_active                 boolean not null default true,
  created_by                uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by                uuid references public.profiles(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index classifications_parent_idx on public.classifications(parent_id);

-- -----------------------------------------------------------------------------
-- permit_types (jenis perizinan)
-- -----------------------------------------------------------------------------
create table public.permit_types (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(btrim(name)) between 2 and 300),
  code                text check (length(code) <= 50),
  sector              text not null default 'Lainnya' check (length(btrim(sector)) between 2 and 100),
  classification_id   uuid references public.classifications(id) on delete set null,
  validity_years      integer check (validity_years is null or validity_years between 1 and 100),
  required_documents  text[] not null default array['surat_permohonan','identitas_pemohon','dokumen_persyaratan','surat_keputusan'],
  description         text,
  is_active           boolean not null default true,
  source_name         text,
  created_by          uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (required_documents <@ array['surat_permohonan','identitas_pemohon','dokumen_persyaratan',
                                      'rekomendasi_teknis','berita_acara','surat_keputusan','dokumen_pendukung'])
);
create unique index permit_types_name_key on public.permit_types(lower(btrim(name)));
create unique index permit_types_code_key on public.permit_types(lower(code)) where code is not null;
create index permit_types_sector_idx on public.permit_types(sector);
create index permit_types_classification_idx on public.permit_types(classification_id);

-- -----------------------------------------------------------------------------
-- import_batches (riwayat proses impor)
-- -----------------------------------------------------------------------------
create table public.import_batches (
  id               uuid primary key default gen_random_uuid(),
  file_name        text not null check (length(file_name) <= 255),
  file_size        bigint check (file_size >= 0),
  file_hash        text,
  sheet_name       text,
  source_system    text not null default 'SiCANTIK Cloud',
  match_key        text not null default 'source_id' check (match_key in ('source_id','application_number')),
  column_mapping   jsonb not null default '{}'::jsonb,
  options          jsonb not null default '{}'::jsonb,
  total_rows       integer not null default 0 check (total_rows >= 0),
  inserted_count   integer not null default 0,
  updated_count    integer not null default 0,
  unchanged_count  integer not null default 0,
  skipped_count    integer not null default 0,
  failed_count     integer not null default 0,
  warning_count    integer not null default 0,
  status           text not null default 'draft'
                     check (status in ('draft','processing','completed','completed_with_errors','failed','cancelled')),
  notes            text,
  started_at       timestamptz,
  finished_at      timestamptz,
  imported_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index import_batches_created_idx on public.import_batches(created_at desc);
create index import_batches_hash_idx on public.import_batches(file_hash);

-- -----------------------------------------------------------------------------
-- applicants (pemohon)
-- -----------------------------------------------------------------------------
create table public.applicants (
  id                      uuid primary key default gen_random_uuid(),
  nik                     text check (nik is null or nik ~ '^[0-9]{16}$'),
  full_name               text not null check (length(btrim(full_name)) between 2 and 200),
  phone                   text check (length(phone) <= 30),
  email                   text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address                 text,
  data_source             text not null default 'manual' check (data_source in ('manual','import')),
  source_data             jsonb,
  source_hash             text,
  first_import_batch_id   uuid references public.import_batches(id) on delete set null,
  last_import_batch_id    uuid references public.import_batches(id) on delete set null,
  is_manually_edited      boolean not null default false,
  manually_edited_fields  text[] not null default '{}',
  manually_edited_at      timestamptz,
  manually_edited_by      uuid references public.profiles(id) on delete set null,
  created_by              uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create unique index applicants_nik_key on public.applicants(nik) where nik is not null;
create index applicants_name_trgm on public.applicants using gin (full_name gin_trgm_ops);
create index applicants_email_idx on public.applicants(lower(email));

-- -----------------------------------------------------------------------------
-- companies (badan usaha)
-- -----------------------------------------------------------------------------
create table public.companies (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null check (length(btrim(name)) between 2 and 250),
  business_form           text check (business_form in ('PT','CV','Firma','Koperasi','Yayasan','Perkumpulan','BUMD','BUMDes','Perorangan','Lainnya')),
  nib                     text check (nib is null or nib ~ '^[0-9]{13}$'),
  npwp                    text check (npwp is null or npwp ~ '^[0-9]{15,16}$'),
  sector                  text,
  address                 text,
  phone                   text check (length(phone) <= 30),
  email                   text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  applicant_id            uuid references public.applicants(id) on delete set null,
  data_source             text not null default 'manual' check (data_source in ('manual','import')),
  source_data             jsonb,
  source_hash             text,
  first_import_batch_id   uuid references public.import_batches(id) on delete set null,
  last_import_batch_id    uuid references public.import_batches(id) on delete set null,
  is_manually_edited      boolean not null default false,
  manually_edited_fields  text[] not null default '{}',
  manually_edited_at      timestamptz,
  manually_edited_by      uuid references public.profiles(id) on delete set null,
  created_by              uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create unique index companies_nib_key on public.companies(nib) where nib is not null;
create index companies_name_trgm on public.companies using gin (name gin_trgm_ops);
create index companies_applicant_idx on public.companies(applicant_id);

-- -----------------------------------------------------------------------------
-- applications (data permohonan) — satu baris = satu berkas arsip
-- -----------------------------------------------------------------------------
create table public.applications (
  id                      uuid primary key default gen_random_uuid(),
  source_system           text not null default 'SiCANTIK',
  source_id               text check (length(source_id) <= 100),
  application_number      text not null check (length(btrim(application_number)) between 1 and 150),
  applicant_id            uuid not null references public.applicants(id) on delete restrict,
  company_id              uuid references public.companies(id) on delete set null,
  permit_type_id          uuid not null references public.permit_types(id) on delete restrict,
  application_type        text not null default 'Baru' check (length(btrim(application_type)) between 2 and 50),
  application_date        date not null check (application_date between date '1990-01-01' and date '2100-12-31'),
  location                text,
  permit_location         text,
  status                  text not null default 'proses' check (status in ('proses','terbit','ditolak','dibatalkan')),
  classification_id       uuid references public.classifications(id) on delete set null,
  archive_code            text check (length(archive_code) <= 100),
  physical_location       text check (length(physical_location) <= 200),
  access_level            text not null default 'biasa' check (access_level in ('biasa','terbatas','rahasia')),
  notes                   text,
  data_source             text not null default 'manual' check (data_source in ('manual','import')),
  source_data             jsonb,
  source_hash             text,
  first_import_batch_id   uuid references public.import_batches(id) on delete set null,
  last_import_batch_id    uuid references public.import_batches(id) on delete set null,
  is_manually_edited      boolean not null default false,
  manually_edited_fields  text[] not null default '{}',
  manually_edited_at      timestamptz,
  manually_edited_by      uuid references public.profiles(id) on delete set null,
  created_by              uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create unique index applications_source_key on public.applications(source_system, source_id) where source_id is not null;
create unique index applications_archive_code_key on public.applications(archive_code) where archive_code is not null;
create index applications_number_idx on public.applications(application_number);
create index applications_number_trgm on public.applications using gin (application_number gin_trgm_ops);
create index applications_date_idx on public.applications(application_date desc);
create index applications_applicant_idx on public.applications(applicant_id);
create index applications_company_idx on public.applications(company_id);
create index applications_type_idx on public.applications(permit_type_id);
create index applications_status_idx on public.applications(status);
create index applications_classification_idx on public.applications(classification_id);
create index applications_location_trgm on public.applications using gin (location gin_trgm_ops);
create index applications_permit_location_trgm on public.applications using gin (permit_location gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- permits (izin terbit) — maksimal satu izin per permohonan
-- -----------------------------------------------------------------------------
create table public.permits (
  id                      uuid primary key default gen_random_uuid(),
  application_id          uuid not null unique references public.applications(id) on delete cascade,
  permit_number           text not null check (length(btrim(permit_number)) between 1 and 150),
  issued_date             date check (issued_date is null or issued_date between date '1990-01-01' and date '2100-12-31'),
  valid_until             date,
  status                  text not null default 'aktif' check (status in ('aktif','dicabut','kedaluwarsa','dibekukan')),
  signed_by               text check (length(signed_by) <= 200),
  notes                   text,
  data_source             text not null default 'manual' check (data_source in ('manual','import')),
  source_data             jsonb,
  source_hash             text,
  first_import_batch_id   uuid references public.import_batches(id) on delete set null,
  last_import_batch_id    uuid references public.import_batches(id) on delete set null,
  is_manually_edited      boolean not null default false,
  manually_edited_fields  text[] not null default '{}',
  manually_edited_at      timestamptz,
  manually_edited_by      uuid references public.profiles(id) on delete set null,
  created_by              uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (valid_until is null or issued_date is null or valid_until >= issued_date)
);
create unique index permits_number_key on public.permits(lower(btrim(permit_number)));
create index permits_number_trgm on public.permits using gin (permit_number gin_trgm_ops);
create index permits_issued_idx on public.permits(issued_date desc);
create index permits_status_idx on public.permits(status);

-- -----------------------------------------------------------------------------
-- archive_documents (dokumen PDF, berversi)
-- -----------------------------------------------------------------------------
create table public.archive_documents (
  id                 uuid primary key default gen_random_uuid(),
  application_id     uuid not null references public.applications(id) on delete restrict,
  permit_id          uuid references public.permits(id) on delete set null,
  category           text not null check (category in ('surat_permohonan','identitas_pemohon','dokumen_persyaratan',
                                                       'rekomendasi_teknis','berita_acara','surat_keputusan','dokumen_pendukung')),
  title              text not null check (length(btrim(title)) between 2 and 250),
  description        text,
  document_number    text check (length(document_number) <= 150),
  document_date      date,
  storage_bucket     text not null default 'arsip-dokumen',
  storage_path       text not null unique check (storage_path ~ '^permohonan/[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'),
  file_name          text not null check (length(file_name) <= 255),
  file_size          bigint not null check (file_size > 0),
  mime_type          text not null default 'application/pdf' check (mime_type = 'application/pdf'),
  checksum_sha256    text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  page_count         integer check (page_count is null or page_count > 0),
  document_group_id  uuid not null,
  version            integer not null default 1 check (version >= 1),
  is_latest          boolean not null default true,
  change_note        text,
  access_level       text not null default 'biasa' check (access_level in ('biasa','terbatas','rahasia')),
  uploaded_by        uuid references public.profiles(id) on delete set null default auth.uid(),
  deleted_at         timestamptz,
  deleted_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (document_group_id, version)
);
create unique index archive_documents_latest_key on public.archive_documents(document_group_id)
  where is_latest and deleted_at is null;
create index archive_documents_application_idx on public.archive_documents(application_id) where deleted_at is null;
create index archive_documents_category_idx on public.archive_documents(category);
create index archive_documents_created_idx on public.archive_documents(created_at desc);
create index archive_documents_title_trgm on public.archive_documents using gin (title gin_trgm_ops);
create index archive_documents_checksum_idx on public.archive_documents(checksum_sha256);

-- -----------------------------------------------------------------------------
-- import_errors (kesalahan & peringatan per baris impor)
-- -----------------------------------------------------------------------------
create table public.import_errors (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            uuid not null references public.import_batches(id) on delete cascade,
  row_number          integer,
  source_id           text,
  application_number  text,
  severity            text not null default 'error' check (severity in ('error','warning')),
  error_type          text not null default 'validation'
                        check (error_type in ('validation','duplicate_in_file','conflict','manual_protected','skipped','database')),
  field               text,
  message             text not null,
  raw_data            jsonb,
  created_at          timestamptz not null default now()
);
create index import_errors_batch_idx on public.import_errors(batch_id, row_number);

-- -----------------------------------------------------------------------------
-- activity_logs (audit trail — append only)
-- -----------------------------------------------------------------------------
create table public.activity_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles(id) on delete set null,
  user_email    text,
  user_role     text,
  action        text not null check (length(action) <= 60),
  entity_type   text check (length(entity_type) <= 60),
  entity_id     text,
  description   text,
  old_data      jsonb,
  new_data      jsonb,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index activity_logs_created_idx on public.activity_logs(created_at desc);
create index activity_logs_user_idx on public.activity_logs(user_id, created_at desc);
create index activity_logs_entity_idx on public.activity_logs(entity_type, entity_id);
create index activity_logs_action_idx on public.activity_logs(action);

-- -----------------------------------------------------------------------------
-- system_settings
-- -----------------------------------------------------------------------------
create table public.system_settings (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique check (key ~ '^[a-z0-9_.]{3,100}$'),
  value        jsonb not null,
  description  text,
  is_public    boolean not null default true,
  updated_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Trigger updated_at
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['roles','profiles','classifications','permit_types','import_batches','applicants',
                           'companies','applications','permits','archive_documents','system_settings']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Versi dokumen: nomor versi otomatis & penanda versi terakhir
-- -----------------------------------------------------------------------------
create or replace function public.archive_documents_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer;
  v_app uuid;
begin
  if coalesce(current_setting('app.restoring', true), '') = 'on' then
    return new;
  end if;

  if new.document_group_id is null then
    new.document_group_id := new.id;
    new.version := 1;
  else
    perform pg_advisory_xact_lock(hashtext(new.document_group_id::text));
    select max(version), max(application_id::text)::uuid into v_max, v_app
      from public.archive_documents where document_group_id = new.document_group_id;
    if v_max is null then
      raise exception 'Dokumen induk untuk versi baru tidak ditemukan' using errcode = 'P0002';
    end if;
    if v_app <> new.application_id then
      raise exception 'Versi baru harus terhubung ke permohonan yang sama' using errcode = '22023';
    end if;
    new.version := v_max + 1;
    update public.archive_documents
       set is_latest = false
     where document_group_id = new.document_group_id and is_latest;
  end if;
  new.is_latest := true;
  return new;
end;
$$;

create trigger archive_documents_versioning
before insert on public.archive_documents
for each row execute function public.archive_documents_before_insert();
