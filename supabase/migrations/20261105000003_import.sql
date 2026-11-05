-- =============================================================================
-- Migration 003: Mesin impor data SiCANTIK
-- =============================================================================
-- Alur:
--   1. Klien membaca file (XLSX/XLS/CSV), pengguna memetakan kolom, klien
--      menormalkan nilai ke "baris kanonik" (kunci tetap, lihat di bawah).
--   2. import_preview(rows, match_key)  -> status tiap baris tanpa menulis:
--        new | unchanged | changed | conflict | error
--   3. Klien membuat import_batches, lalu memanggil import_commit_rows()
--      per potongan (chunk). Setiap panggilan = satu transaksi; setiap baris
--      dibungkus subtransaksi sehingga satu baris gagal tidak membatalkan
--      baris lain. Status dihitung ulang saat commit (bukan dari preview).
--   4. import_finalize_batch() menutup batch dan mencatat audit.
--
-- Kunci baris kanonik:
--   source_id, application_number, permit_type_name, application_type,
--   application_date, applicant_name, applicant_nik, applicant_phone,
--   applicant_email, applicant_address, location, permit_location,
--   permit_number, issued_date, valid_until, company_name, company_form,
--   company_nib, company_npwp, company_address, sector
-- =============================================================================

create or replace function public.import_clean_text(p text)
returns text
language sql
immutable
as $$
  select case
           when p is null then null
           when lower(regexp_replace(btrim(p), '\s+', ' ', 'g')) in ('', '-', '--', 'null', 'n/a', '#n/a') then null
           else regexp_replace(btrim(p), '\s+', ' ', 'g')
         end
$$;

create or replace function public.import_parse_date(p text, out v date, out ok boolean)
language plpgsql
immutable
as $$
declare
  s text := public.import_clean_text(p);
begin
  ok := true;
  v := null;
  if s is null then
    return;
  end if;
  if s !~ '^\d{4}-\d{2}-\d{2}$' then
    ok := false;
    return;
  end if;
  begin
    v := s::date;
    if v < date '1990-01-01' or v > date '2100-12-31' then
      v := null;
      ok := false;
    end if;
  exception when others then
    v := null;
    ok := false;
  end;
end;
$$;

-- Menghasilkan {canon, errors[], warnings[]}
create or replace function public.import_normalize_row(p jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  c jsonb;
  errs jsonb := '[]'::jsonb;
  warns jsonb := '[]'::jsonb;
  v text;
  d record;
  f text;
  v_type text;
begin
  v_type := public.import_clean_text(p->>'application_type');
  if v_type is not null then
    v_type := initcap(lower(v_type));
  end if;

  c := jsonb_build_object(
    'source_id',          public.import_clean_text(p->>'source_id'),
    'application_number', public.import_clean_text(p->>'application_number'),
    'permit_type_name',   public.import_clean_text(p->>'permit_type_name'),
    'application_type',   coalesce(v_type, 'Baru'),
    'applicant_name',     public.import_clean_text(p->>'applicant_name'),
    'applicant_address',  public.import_clean_text(p->>'applicant_address'),
    'location',           public.import_clean_text(p->>'location'),
    'permit_location',    public.import_clean_text(p->>'permit_location'),
    'permit_number',      public.import_clean_text(p->>'permit_number'),
    'company_name',       public.import_clean_text(p->>'company_name'),
    'company_address',    public.import_clean_text(p->>'company_address'),
    'sector',             public.import_clean_text(p->>'sector')
  );

  -- NIK: hanya digit, 16 karakter (apostrof Excel & spasi dibuang)
  v := regexp_replace(coalesce(p->>'applicant_nik', ''), '[^0-9]', '', 'g');
  if v = '' then
    c := c || jsonb_build_object('applicant_nik', null);
  elsif length(v) <> 16 then
    c := c || jsonb_build_object('applicant_nik', null);
    warns := warns || jsonb_build_object('field', 'applicant_nik',
               'message', format('NIK "%s" bukan 16 digit; NIK dikosongkan', p->>'applicant_nik'));
  else
    c := c || jsonb_build_object('applicant_nik', v);
  end if;

  -- Telepon: digit dan + di depan
  v := public.import_clean_text(p->>'applicant_phone');
  if v is not null then
    v := regexp_replace(v, '[^0-9+]', '', 'g');
    v := left(v, 1) || replace(substr(v, 2), '+', '');
    if length(v) < 6 or length(v) > 20 then
      warns := warns || jsonb_build_object('field', 'applicant_phone',
                 'message', format('Nomor telepon "%s" tidak valid; dikosongkan', p->>'applicant_phone'));
      v := null;
    end if;
  end if;
  c := c || jsonb_build_object('applicant_phone', v);

  -- Email
  v := lower(public.import_clean_text(p->>'applicant_email'));
  if v is not null and v !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    warns := warns || jsonb_build_object('field', 'applicant_email',
               'message', format('Email "%s" tidak valid; dikosongkan', p->>'applicant_email'));
    v := null;
  end if;
  c := c || jsonb_build_object('applicant_email', v);

  -- Badan usaha
  v := public.import_clean_text(p->>'company_form');
  if v is not null then
    v := case upper(replace(v, '.', ''))
           when 'PT' then 'PT' when 'CV' then 'CV' when 'FIRMA' then 'Firma' when 'FA' then 'Firma'
           when 'KOPERASI' then 'Koperasi' when 'YAYASAN' then 'Yayasan' when 'PERKUMPULAN' then 'Perkumpulan'
           when 'BUMD' then 'BUMD' when 'BUMDES' then 'BUMDes' when 'PERORANGAN' then 'Perorangan'
           else 'Lainnya' end;
  end if;
  c := c || jsonb_build_object('company_form', v);

  v := nullif(regexp_replace(coalesce(p->>'company_nib', ''), '[^0-9]', '', 'g'), '');
  if v is not null and length(v) <> 13 then
    warns := warns || jsonb_build_object('field', 'company_nib',
               'message', format('NIB "%s" bukan 13 digit; dikosongkan', p->>'company_nib'));
    v := null;
  end if;
  c := c || jsonb_build_object('company_nib', v);

  v := nullif(regexp_replace(coalesce(p->>'company_npwp', ''), '[^0-9]', '', 'g'), '');
  if v is not null and length(v) not in (15, 16) then
    warns := warns || jsonb_build_object('field', 'company_npwp',
               'message', format('NPWP "%s" bukan 15/16 digit; dikosongkan', p->>'company_npwp'));
    v := null;
  end if;
  c := c || jsonb_build_object('company_npwp', v);

  -- Tanggal
  foreach f in array array['application_date', 'issued_date', 'valid_until'] loop
    select * into d from public.import_parse_date(p->>f);
    if not d.ok then
      if f = 'application_date' then
        errs := errs || jsonb_build_object('field', f,
                  'message', format('Tanggal permohonan "%s" tidak valid (format YYYY-MM-DD)', p->>f));
      else
        warns := warns || jsonb_build_object('field', f,
                  'message', format('Tanggal "%s" pada kolom %s tidak valid; dikosongkan', p->>f, f));
      end if;
    end if;
    c := c || jsonb_build_object(f, to_jsonb(d.v));
  end loop;

  -- Data wajib
  if c->>'application_number' is null then
    errs := errs || jsonb_build_object('field', 'application_number', 'message', 'Nomor permohonan wajib diisi');
  end if;
  if c->>'permit_type_name' is null then
    errs := errs || jsonb_build_object('field', 'permit_type_name', 'message', 'Jenis izin wajib diisi');
  end if;
  if c->>'applicant_name' is null or length(c->>'applicant_name') < 2 then
    errs := errs || jsonb_build_object('field', 'applicant_name', 'message', 'Nama pemohon wajib diisi');
  end if;
  if c->>'application_date' is null and not exists (select 1 from jsonb_array_elements(errs) e where e->>'field' = 'application_date') then
    errs := errs || jsonb_build_object('field', 'application_date', 'message', 'Tanggal permohonan wajib diisi');
  end if;

  -- Konsistensi
  if (c->>'issued_date') is not null and (c->>'application_date') is not null
     and (c->>'issued_date')::date < (c->>'application_date')::date then
    warns := warns || jsonb_build_object('field', 'issued_date',
               'message', 'Tanggal penetapan lebih awal dari tanggal permohonan');
  end if;
  if (c->>'valid_until') is not null and (c->>'issued_date') is not null
     and (c->>'valid_until')::date < (c->>'issued_date')::date then
    warns := warns || jsonb_build_object('field', 'valid_until',
               'message', 'Masa berlaku lebih awal dari tanggal penetapan; dikosongkan');
    c := c || jsonb_build_object('valid_until', null);
  end if;
  if (c->>'permit_number') is not null and (c->>'issued_date') is null then
    warns := warns || jsonb_build_object('field', 'issued_date',
               'message', 'Nomor izin terisi tetapi tanggal penetapan kosong');
  end if;

  return jsonb_build_object('canon', c, 'errors', errs, 'warnings', warns);
end;
$$;

-- Pemetaan kolom tabel -> kunci kanonik (untuk deteksi konflik edit manual)
create or replace function public.import_manual_fields(p_app_id uuid)
returns text[]
language sql
stable
as $$
  with app as (
    select a.*, ap.manually_edited_fields as ap_fields, ap.data_source as ap_source,
           pm.manually_edited_fields as pm_fields
      from public.applications a
      join public.applicants ap on ap.id = a.applicant_id
      left join public.permits pm on pm.application_id = a.id
     where a.id = p_app_id
  )
  select coalesce(array_agg(distinct f), '{}') from (
    select case x
             when 'permit_type_id' then 'permit_type_name'
             when 'status' then 'permit_number'
             when 'company_id' then 'company_name'
             else x end as f
      from app, unnest(app.manually_edited_fields) x
    union all
    select case x
             when 'full_name' then 'applicant_name'
             when 'nik' then 'applicant_nik'
             when 'phone' then 'applicant_phone'
             when 'email' then 'applicant_email'
             when 'address' then 'applicant_address'
           end
      from app, unnest(app.ap_fields) x
    union all
    select x from app, unnest(coalesce(app.pm_fields, '{}')) x
  ) s
  where f is not null
$$;

-- Analisis satu baris kanonik terhadap database
create or replace function public.import_analyze_row(p_canon jsonb, p_match_key text)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_hash text := md5(p_canon::text);
  v_ids uuid[];
  v_app public.applications%rowtype;
  v_prev jsonb;
  v_key text;
  v_changed text[] := '{}';
  v_changes jsonb := '[]'::jsonb;
  v_manual text[];
  v_conflict text[];
begin
  if p_match_key = 'source_id' then
    if p_canon->>'source_id' is null then
      return jsonb_build_object('status', 'error', 'hash', v_hash,
               'message', 'ID sumber SiCANTIK kosong, padahal dipakai sebagai kunci pencocokan');
    end if;
    select array_agg(id) into v_ids
      from public.applications
     where source_system = 'SiCANTIK' and source_id = p_canon->>'source_id';
  else
    select array_agg(id) into v_ids
      from public.applications
     where application_number = p_canon->>'application_number';
  end if;

  if v_ids is null then
    return jsonb_build_object('status', 'new', 'hash', v_hash);
  end if;
  if cardinality(v_ids) > 1 then
    return jsonb_build_object('status', 'error', 'hash', v_hash,
             'message', format('Nomor permohonan %s cocok dengan %s arsip; gunakan ID SiCANTIK sebagai kunci',
                               p_canon->>'application_number', cardinality(v_ids)));
  end if;

  select * into v_app from public.applications where id = v_ids[1];

  if v_app.source_hash is not null and v_app.source_hash = v_hash then
    return jsonb_build_object('status', 'unchanged', 'hash', v_hash, 'application_id', v_app.id);
  end if;

  v_prev := coalesce(v_app.source_data, '{}'::jsonb);
  for v_key in select jsonb_object_keys(p_canon) loop
    if (v_prev -> v_key) is distinct from (p_canon -> v_key) then
      v_changed := array_append(v_changed, v_key);
      v_changes := v_changes || jsonb_build_object('field', v_key,
                                  'old', v_prev -> v_key, 'new', p_canon -> v_key);
    end if;
  end loop;

  if cardinality(v_changed) = 0 then
    return jsonb_build_object('status', 'unchanged', 'hash', v_hash, 'application_id', v_app.id);
  end if;

  if v_app.data_source = 'manual' then
    return jsonb_build_object('status', 'conflict', 'hash', v_hash, 'application_id', v_app.id,
             'reason', 'manual_record', 'changes', v_changes, 'conflict_fields', to_jsonb(v_changed),
             'message', 'Arsip ini dibuat manual; menimpa memerlukan konfirmasi');
  end if;

  v_manual := public.import_manual_fields(v_app.id);
  select coalesce(array_agg(x), '{}') into v_conflict from unnest(v_changed) x where x = any(v_manual);

  if cardinality(v_conflict) > 0 then
    return jsonb_build_object('status', 'conflict', 'hash', v_hash, 'application_id', v_app.id,
             'reason', 'manual_edit', 'changes', v_changes, 'conflict_fields', to_jsonb(v_conflict),
             'message', 'Data berubah di SiCANTIK dan juga pernah diubah manual');
  end if;

  return jsonb_build_object('status', 'changed', 'hash', v_hash, 'application_id', v_app.id,
                            'changes', v_changes);
end;
$$;

-- Pratinjau (read-only)
create or replace function public.import_preview(p_rows jsonb, p_match_key text default 'source_id')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r jsonb;
  n jsonb;
  a jsonb;
  out jsonb := '[]'::jsonb;
begin
  if not public.has_any_role('super_admin', 'admin_arsip') then
    raise exception 'Anda tidak memiliki hak untuk impor data' using errcode = '42501';
  end if;
  if p_match_key not in ('source_id', 'application_number') then
    raise exception 'Kunci pencocokan tidak dikenal' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Data pratinjau harus berupa array maksimal 1000 baris' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    n := public.import_normalize_row(r);
    if jsonb_array_length(n->'errors') > 0 then
      a := jsonb_build_object('status', 'error');
    else
      a := public.import_analyze_row(n->'canon', p_match_key);
    end if;
    out := out || jsonb_build_object(
      'row_number', (r->>'row_number')::int,
      'status', a->>'status',
      'application_id', a->'application_id',
      'reason', a->'reason',
      'message', a->'message',
      'changes', coalesce(a->'changes', '[]'::jsonb),
      'conflict_fields', coalesce(a->'conflict_fields', '[]'::jsonb),
      'errors', n->'errors',
      'warnings', n->'warnings'
    );
  end loop;
  return out;
end;
$$;

-- Sektor dari nama jenis izin (aturan di system_settings: import.sector_rules)
create or replace function public.import_infer_sector(p_name text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  rule jsonb;
begin
  for rule in
    select * from jsonb_array_elements(
      coalesce((select value from public.system_settings where key = 'import.sector_rules'), '[]'::jsonb))
  loop
    if p_name ~* (rule->>'pattern') then
      return rule->>'sector';
    end if;
  end loop;
  return 'Lainnya';
end;
$$;

create or replace function public.import_resolve_permit_type(p_name text, p_sector text)
returns public.permit_types
language plpgsql
set search_path = public
as $$
declare
  v public.permit_types%rowtype;
  v_sector text;
  v_class uuid;
begin
  select * into v from public.permit_types where lower(btrim(name)) = lower(btrim(p_name));
  if found then
    return v;
  end if;
  v_sector := coalesce(p_sector, public.import_infer_sector(p_name));
  select c.id into v_class
    from public.classifications c
   where c.code = (select value->>v_sector from public.system_settings where key = 'import.sector_classification');
  insert into public.permit_types (name, sector, classification_id, source_name, created_by)
  values (p_name, v_sector, v_class, p_name, auth.uid())
  on conflict ((lower(btrim(name)))) do nothing;
  select * into v from public.permit_types where lower(btrim(name)) = lower(btrim(p_name));
  return v;
end;
$$;

-- Perbarui pemohon dengan menghormati edit manual & data yang lebih baru
create or replace function public.import_update_applicant(
  p_id uuid, p_batch uuid, p_canon jsonb, p_overwrite boolean
)
returns void
language plpgsql
set search_path = public
as $$
declare
  ap public.applicants%rowtype;
  keep text[];
  v_src jsonb;
begin
  select * into ap from public.applicants where id = p_id for update;
  -- Jangan menurunkan data kontak ke versi yang lebih lama
  if not p_overwrite and ap.source_data ? 'application_date'
     and (ap.source_data->>'application_date')::date > (p_canon->>'application_date')::date then
    return;
  end if;

  keep := case
            when p_overwrite then '{}'::text[]
            when ap.data_source = 'manual' then array['nik','full_name','phone','email','address']
            else ap.manually_edited_fields
          end;

  v_src := jsonb_build_object(
    'nik', p_canon->'applicant_nik', 'full_name', p_canon->'applicant_name',
    'phone', p_canon->'applicant_phone', 'email', p_canon->'applicant_email',
    'address', p_canon->'applicant_address', 'application_date', p_canon->'application_date');

  update public.applicants set
    nik       = case when 'nik' = any(keep) then nik else coalesce(p_canon->>'applicant_nik', nik) end,
    full_name = case when 'full_name' = any(keep) then full_name else p_canon->>'applicant_name' end,
    phone     = case when 'phone' = any(keep) then phone else coalesce(p_canon->>'applicant_phone', phone) end,
    email     = case when 'email' = any(keep) then email else coalesce(p_canon->>'applicant_email', email) end,
    address   = case when 'address' = any(keep) then address else coalesce(p_canon->>'applicant_address', address) end,
    data_source = case when p_overwrite then 'import' else data_source end,
    source_data = case when data_source = 'import' or p_overwrite then v_src else source_data end,
    source_hash = case when data_source = 'import' or p_overwrite then md5(v_src::text) else source_hash end,
    first_import_batch_id = coalesce(first_import_batch_id, p_batch),
    last_import_batch_id = p_batch,
    is_manually_edited = case when p_overwrite then false else is_manually_edited end,
    manually_edited_fields = case when p_overwrite then '{}' else manually_edited_fields end,
    updated_by = auth.uid()
  where id = p_id;
end;
$$;

create or replace function public.import_resolve_applicant(
  p_batch uuid, p_canon jsonb, p_current uuid, p_overwrite boolean
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
  v_cur_nik text;
  v_nik text := p_canon->>'applicant_nik';
  v_src jsonb;
begin
  if v_nik is not null then
    select id into v_id from public.applicants where nik = v_nik;
    if v_id is null and p_current is not null then
      select nik into v_cur_nik from public.applicants where id = p_current;
      if v_cur_nik is null then
        v_id := p_current;  -- lengkapi NIK pemohon yang sudah terhubung
      end if;
    end if;
  elsif p_current is not null then
    v_id := p_current;
  elsif p_canon->>'applicant_phone' is not null then
    select id into v_id
      from public.applicants
     where nik is null
       and lower(full_name) = lower(p_canon->>'applicant_name')
       and phone = p_canon->>'applicant_phone'
     limit 1;
  end if;

  if v_id is not null then
    perform public.import_update_applicant(v_id, p_batch, p_canon, p_overwrite);
    return v_id;
  end if;

  v_src := jsonb_build_object(
    'nik', p_canon->'applicant_nik', 'full_name', p_canon->'applicant_name',
    'phone', p_canon->'applicant_phone', 'email', p_canon->'applicant_email',
    'address', p_canon->'applicant_address', 'application_date', p_canon->'application_date');

  insert into public.applicants (nik, full_name, phone, email, address, data_source, source_data, source_hash,
                                 first_import_batch_id, last_import_batch_id, created_by)
  values (v_nik, p_canon->>'applicant_name', p_canon->>'applicant_phone', p_canon->>'applicant_email',
          p_canon->>'applicant_address', 'import', v_src, md5(v_src::text), p_batch, p_batch, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.import_resolve_company(
  p_batch uuid, p_canon jsonb, p_applicant uuid, p_overwrite boolean
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
  v_src jsonb;
  co public.companies%rowtype;
  keep text[];
begin
  if p_canon->>'company_name' is null then
    return null;
  end if;
  v_src := jsonb_build_object('name', p_canon->'company_name', 'business_form', p_canon->'company_form',
             'nib', p_canon->'company_nib', 'npwp', p_canon->'company_npwp', 'address', p_canon->'company_address');

  if p_canon->>'company_nib' is not null then
    select * into co from public.companies where nib = p_canon->>'company_nib' for update;
  end if;
  if co.id is null then
    select * into co from public.companies where lower(name) = lower(p_canon->>'company_name')
     order by created_at limit 1 for update;
  end if;

  if co.id is null then
    insert into public.companies (name, business_form, nib, npwp, address, applicant_id, data_source,
                                  source_data, source_hash, first_import_batch_id, last_import_batch_id, created_by)
    values (p_canon->>'company_name', p_canon->>'company_form', p_canon->>'company_nib', p_canon->>'company_npwp',
            p_canon->>'company_address', p_applicant, 'import', v_src, md5(v_src::text), p_batch, p_batch, auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  keep := case
            when p_overwrite then '{}'::text[]
            when co.data_source = 'manual' then array['name','business_form','nib','npwp','address','applicant_id']
            else co.manually_edited_fields
          end;
  update public.companies set
    name          = case when 'name' = any(keep) then name else p_canon->>'company_name' end,
    business_form = case when 'business_form' = any(keep) then business_form else coalesce(p_canon->>'company_form', business_form) end,
    nib           = case when 'nib' = any(keep) then nib else coalesce(p_canon->>'company_nib', nib) end,
    npwp          = case when 'npwp' = any(keep) then npwp else coalesce(p_canon->>'company_npwp', npwp) end,
    address       = case when 'address' = any(keep) then address else coalesce(p_canon->>'company_address', address) end,
    applicant_id  = case when 'applicant_id' = any(keep) then applicant_id else coalesce(applicant_id, p_applicant) end,
    source_data   = case when data_source = 'import' or p_overwrite then v_src else source_data end,
    source_hash   = case when data_source = 'import' or p_overwrite then md5(v_src::text) else source_hash end,
    data_source   = case when p_overwrite then 'import' else data_source end,
    last_import_batch_id = p_batch,
    is_manually_edited = case when p_overwrite then false else is_manually_edited end,
    manually_edited_fields = case when p_overwrite then '{}' else manually_edited_fields end,
    updated_by = auth.uid()
  where id = co.id;
  return co.id;
end;
$$;

-- Tulis satu baris kanonik (insert atau update)
create or replace function public.import_apply_row(
  p_batch uuid, p_canon jsonb, p_hash text, p_app_id uuid, p_overwrite boolean
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  pt public.permit_types%rowtype;
  app public.applications%rowtype;
  pm public.permits%rowtype;
  v_app_id uuid := p_app_id;
  v_applicant uuid;
  v_company uuid;
  v_status text;
  keep text[];
  v_pm_src jsonb;
  v_valid date;
begin
  pt := public.import_resolve_permit_type(p_canon->>'permit_type_name', p_canon->>'sector');
  v_status := case when p_canon->>'permit_number' is not null then 'terbit' else 'proses' end;

  if v_app_id is null then
    v_applicant := public.import_resolve_applicant(p_batch, p_canon, null, false);
    v_company := public.import_resolve_company(p_batch, p_canon, v_applicant, false);
    insert into public.applications (
      source_system, source_id, application_number, applicant_id, company_id, permit_type_id,
      application_type, application_date, location, permit_location, status, classification_id,
      data_source, source_data, source_hash, first_import_batch_id, last_import_batch_id, created_by)
    values (
      'SiCANTIK', p_canon->>'source_id', p_canon->>'application_number', v_applicant, v_company, pt.id,
      p_canon->>'application_type', (p_canon->>'application_date')::date, p_canon->>'location',
      p_canon->>'permit_location', v_status, pt.classification_id,
      'import', p_canon, p_hash, p_batch, p_batch, auth.uid())
    returning id into v_app_id;
  else
    select * into app from public.applications where id = v_app_id for update;
    keep := case when p_overwrite then '{}'::text[] else app.manually_edited_fields end;

    v_applicant := case when 'applicant_id' = any(keep) then app.applicant_id
                        else public.import_resolve_applicant(p_batch, p_canon, app.applicant_id, p_overwrite) end;
    v_company := coalesce(public.import_resolve_company(p_batch, p_canon, v_applicant, p_overwrite), app.company_id);

    update public.applications set
      source_id          = coalesce(source_id, p_canon->>'source_id'),
      application_number = case when 'application_number' = any(keep) then application_number else p_canon->>'application_number' end,
      applicant_id       = v_applicant,
      company_id         = case when 'company_id' = any(keep) then company_id else v_company end,
      permit_type_id     = case when 'permit_type_id' = any(keep) then permit_type_id else pt.id end,
      application_type   = case when 'application_type' = any(keep) then application_type else p_canon->>'application_type' end,
      application_date   = case when 'application_date' = any(keep) then application_date else (p_canon->>'application_date')::date end,
      location           = case when 'location' = any(keep) then location else p_canon->>'location' end,
      permit_location    = case when 'permit_location' = any(keep) then permit_location else p_canon->>'permit_location' end,
      status             = case when 'status' = any(keep) then status
                                when v_status = 'terbit' then 'terbit'
                                else status end,
      classification_id  = coalesce(classification_id, pt.classification_id),
      data_source        = 'import',
      source_data        = p_canon,
      source_hash        = p_hash,
      first_import_batch_id = coalesce(first_import_batch_id, p_batch),
      last_import_batch_id  = p_batch,
      is_manually_edited     = case when p_overwrite then false else is_manually_edited end,
      manually_edited_fields = case when p_overwrite then '{}' else manually_edited_fields end,
      updated_by = auth.uid()
    where id = v_app_id;
  end if;

  -- Izin terbit
  if p_canon->>'permit_number' is not null then
    v_valid := coalesce((p_canon->>'valid_until')::date,
                        case when pt.validity_years is not null and p_canon->>'issued_date' is not null
                             then ((p_canon->>'issued_date')::date + make_interval(years => pt.validity_years))::date end);
    v_pm_src := jsonb_build_object('permit_number', p_canon->'permit_number', 'issued_date', p_canon->'issued_date',
                                   'valid_until', p_canon->'valid_until');
    select * into pm from public.permits where application_id = v_app_id for update;
    if pm.id is null then
      insert into public.permits (application_id, permit_number, issued_date, valid_until, status, data_source,
                                  source_data, source_hash, first_import_batch_id, last_import_batch_id, created_by)
      values (v_app_id, p_canon->>'permit_number', (p_canon->>'issued_date')::date, v_valid, 'aktif', 'import',
              v_pm_src, md5(v_pm_src::text), p_batch, p_batch, auth.uid());
    else
      keep := case
                when p_overwrite then '{}'::text[]
                when pm.data_source = 'manual' then array['permit_number','issued_date','valid_until','status']
                else pm.manually_edited_fields
              end;
      update public.permits set
        permit_number = case when 'permit_number' = any(keep) then permit_number else p_canon->>'permit_number' end,
        issued_date   = case when 'issued_date' = any(keep) then issued_date else (p_canon->>'issued_date')::date end,
        valid_until   = case when 'valid_until' = any(keep) then valid_until else coalesce(v_valid, valid_until) end,
        data_source   = case when p_overwrite then 'import' else data_source end,
        source_data   = v_pm_src,
        source_hash   = md5(v_pm_src::text),
        first_import_batch_id = coalesce(first_import_batch_id, p_batch),
        last_import_batch_id  = p_batch,
        is_manually_edited     = case when p_overwrite then false else is_manually_edited end,
        manually_edited_fields = case when p_overwrite then '{}' else manually_edited_fields end,
        updated_by = auth.uid()
      where id = pm.id;
    end if;
  end if;

  return v_app_id;
end;
$$;

create or replace function public.import_friendly_error(p_state text, p_constraint text, p_message text)
returns text
language sql
immutable
as $$
  select case
    when p_constraint = 'permits_number_key' then 'Nomor izin sudah tercatat pada arsip lain'
    when p_constraint = 'applicants_nik_key' then 'NIK sudah tercatat untuk pemohon lain'
    when p_constraint = 'companies_nib_key' then 'NIB sudah tercatat untuk badan usaha lain'
    when p_constraint = 'applications_source_key' then 'ID SiCANTIK sudah tercatat pada arsip lain'
    when p_state = '23505' then 'Data duplikat: ' || p_message
    when p_state = '23514' then 'Nilai tidak memenuhi aturan validasi: ' || coalesce(p_constraint, p_message)
    when p_state = '23502' then 'Kolom wajib kosong: ' || p_message
    when p_state in ('22007','22008') then 'Format tanggal tidak valid'
    else p_message
  end
$$;

-- Commit satu potongan baris ke batch impor
create or replace function public.import_commit_rows(p_batch_id uuid, p_rows jsonb, p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.import_batches%rowtype;
  r jsonb;
  n jsonb;
  a jsonb;
  w jsonb;
  v_row integer;
  v_update_changed boolean := coalesce((p_options->>'update_changed')::boolean, false);
  v_overwrite integer[];
  c_ins integer := 0; c_upd integer := 0; c_unch integer := 0; c_skip integer := 0; c_fail integer := 0; c_warn integer := 0;
  v_state text; v_constraint text; v_msg text;
begin
  if not public.has_any_role('super_admin', 'admin_arsip') then
    raise exception 'Anda tidak memiliki hak untuk impor data' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Data impor harus berupa array maksimal 1000 baris per potongan' using errcode = '22023';
  end if;

  select coalesce(array_agg(x::int), '{}') into v_overwrite
    from jsonb_array_elements_text(coalesce(p_options->'overwrite_rows', '[]'::jsonb)) x;

  -- Serialisasi proses impor agar tidak terjadi balapan data antarbatch
  perform pg_advisory_xact_lock(hashtext('e_arsip_import'));

  select * into v_batch from public.import_batches where id = p_batch_id for update;
  if not found then
    raise exception 'Batch impor tidak ditemukan' using errcode = 'P0002';
  end if;
  if v_batch.status not in ('draft', 'processing') then
    raise exception 'Batch impor sudah ditutup (%)', v_batch.status using errcode = 'P0001';
  end if;

  perform set_config('app.importing', 'on', true);

  for r in select * from jsonb_array_elements(p_rows) loop
    v_row := (r->>'row_number')::int;
    n := public.import_normalize_row(r);

    if jsonb_array_length(n->'errors') > 0 then
      insert into public.import_errors (batch_id, row_number, source_id, application_number, severity, error_type, field, message, raw_data)
      select p_batch_id, v_row, n->'canon'->>'source_id', n->'canon'->>'application_number', 'error', 'validation',
             e->>'field', e->>'message', r
        from jsonb_array_elements(n->'errors') e;
      c_fail := c_fail + 1;
      continue;
    end if;

    begin
      a := public.import_analyze_row(n->'canon', v_batch.match_key);
      case a->>'status'
        when 'error' then
          insert into public.import_errors (batch_id, row_number, source_id, application_number, severity, error_type, message, raw_data)
          values (p_batch_id, v_row, n->'canon'->>'source_id', n->'canon'->>'application_number', 'error', 'conflict', a->>'message', r);
          c_fail := c_fail + 1;
        when 'unchanged' then
          c_unch := c_unch + 1;
        when 'new' then
          perform public.import_apply_row(p_batch_id, n->'canon', a->>'hash', null, false);
          c_ins := c_ins + 1;
        when 'changed' then
          if v_update_changed then
            perform public.import_apply_row(p_batch_id, n->'canon', a->>'hash', (a->>'application_id')::uuid, false);
            c_upd := c_upd + 1;
          else
            insert into public.import_errors (batch_id, row_number, source_id, application_number, severity, error_type, message, raw_data)
            values (p_batch_id, v_row, n->'canon'->>'source_id', n->'canon'->>'application_number', 'warning', 'skipped',
                    'Data berubah di sumber, dilewati sesuai pilihan pengguna', jsonb_build_object('row', r, 'changes', a->'changes'));
            c_skip := c_skip + 1;
          end if;
        when 'conflict' then
          if v_row = any(v_overwrite) then
            perform public.import_apply_row(p_batch_id, n->'canon', a->>'hash', (a->>'application_id')::uuid, true);
            c_upd := c_upd + 1;
          else
            insert into public.import_errors (batch_id, row_number, source_id, application_number, severity, error_type, field, message, raw_data)
            values (p_batch_id, v_row, n->'canon'->>'source_id', n->'canon'->>'application_number', 'warning', 'manual_protected',
                    array_to_string(array(select jsonb_array_elements_text(a->'conflict_fields')), ', '),
                    'Dilewati: ' || (a->>'message'), jsonb_build_object('row', r, 'changes', a->'changes'));
            c_skip := c_skip + 1;
          end if;
      end case;

      for w in select * from jsonb_array_elements(n->'warnings') loop
        insert into public.import_errors (batch_id, row_number, source_id, application_number, severity, error_type, field, message, raw_data)
        values (p_batch_id, v_row, n->'canon'->>'source_id', n->'canon'->>'application_number', 'warning', 'validation',
                w->>'field', w->>'message', r);
        c_warn := c_warn + 1;
      end loop;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name, v_msg = message_text;
      insert into public.import_errors (batch_id, row_number, source_id, application_number, severity, error_type, message, raw_data)
      values (p_batch_id, v_row, n->'canon'->>'source_id', n->'canon'->>'application_number', 'error', 'database',
              public.import_friendly_error(v_state, v_constraint, v_msg), r);
      c_fail := c_fail + 1;
    end;
  end loop;

  update public.import_batches set
    status          = 'processing',
    started_at      = coalesce(started_at, now()),
    inserted_count  = inserted_count + c_ins,
    updated_count   = updated_count + c_upd,
    unchanged_count = unchanged_count + c_unch,
    skipped_count   = skipped_count + c_skip,
    options         = options || coalesce(p_options, '{}'::jsonb) - 'overwrite_rows'
  where id = p_batch_id;

  return jsonb_build_object('inserted', c_ins, 'updated', c_upd, 'unchanged', c_unch,
                            'skipped', c_skip, 'failed', c_fail, 'warnings', c_warn);
end;
$$;

-- Tutup batch & catat audit
create or replace function public.import_finalize_batch(p_batch_id uuid, p_cancelled boolean default false)
returns public.import_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.import_batches%rowtype;
  v_failed integer;
  v_warn integer;
begin
  if not public.has_any_role('super_admin', 'admin_arsip') then
    raise exception 'Anda tidak memiliki hak untuk impor data' using errcode = '42501';
  end if;
  select * into v from public.import_batches where id = p_batch_id for update;
  if not found then
    raise exception 'Batch impor tidak ditemukan' using errcode = 'P0002';
  end if;

  select count(distinct coalesce(row_number, -1)) filter (where severity = 'error'),
         count(*) filter (where severity = 'warning' and error_type = 'validation')
    into v_failed, v_warn
    from public.import_errors where batch_id = p_batch_id;

  update public.import_batches set
    failed_count  = v_failed,
    warning_count = v_warn,
    finished_at   = now(),
    status = case
               when p_cancelled then 'cancelled'
               when inserted_count + updated_count + unchanged_count + skipped_count = 0 and v_failed > 0 then 'failed'
               when v_failed > 0 then 'completed_with_errors'
               else 'completed'
             end
  where id = p_batch_id
  returning * into v;

  perform public.write_activity_log(
    'import.' || v.status, 'import_batches', v.id::text,
    format('Impor %s: %s baru, %s diperbarui, %s tidak berubah, %s dilewati, %s gagal',
           v.file_name, v.inserted_count, v.updated_count, v.unchanged_count, v.skipped_count, v.failed_count),
    null, null,
    jsonb_build_object('file_name', v.file_name, 'total_rows', v.total_rows, 'inserted', v.inserted_count,
                       'updated', v.updated_count, 'unchanged', v.unchanged_count, 'skipped', v.skipped_count,
                       'failed', v.failed_count, 'warnings', v.warning_count));
  return v;
end;
$$;

revoke all on function public.import_preview(jsonb, text) from public, anon;
revoke all on function public.import_commit_rows(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.import_finalize_batch(uuid, boolean) from public, anon;
grant execute on function public.import_preview(jsonb, text) to authenticated;
grant execute on function public.import_commit_rows(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.import_finalize_batch(uuid, boolean) to authenticated;

-- Fungsi internal tidak dipanggil langsung dari klien
do $$
declare f text;
begin
  foreach f in array array[
    'public.import_analyze_row(jsonb, text)',
    'public.import_resolve_permit_type(text, text)',
    'public.import_update_applicant(uuid, uuid, jsonb, boolean)',
    'public.import_resolve_applicant(uuid, jsonb, uuid, boolean)',
    'public.import_resolve_company(uuid, jsonb, uuid, boolean)',
    'public.import_apply_row(uuid, jsonb, text, uuid, boolean)',
    'public.import_manual_fields(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
