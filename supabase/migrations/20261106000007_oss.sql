-- =============================================================================
-- Migration 007: Data OSS RBA (NIB, Proyek, Daftar Izin)
-- =============================================================================
-- Tiga ekspor OSS saling terhubung melalui teks kunci (bukan FK) agar urutan
-- impor bebas dan ekspor parsial tetap dapat dimuat:
--   oss_businesses.nib  <- oss_projects.nib  <- oss_permits.nib
--   oss_projects.project_id                   <- oss_permits.project_id
-- Data OSS bersifat referensi (tidak diedit manual di E-Arsip); penulisan
-- hanya melalui fungsi impor.
-- =============================================================================

alter table public.import_batches
  add column if not exists dataset text not null default 'sicantik'
    check (dataset in ('sicantik', 'oss_nib', 'oss_projects', 'oss_permits'));
create index if not exists import_batches_dataset_idx on public.import_batches(dataset, created_at desc);

-- -----------------------------------------------------------------------------
-- Normalisasi
-- -----------------------------------------------------------------------------
create or replace function public.oss_norm_kecamatan(p text)
returns text
language sql
immutable
as $$
  select case
    when p is null or btrim(p) = '' then null
    else coalesce(
      (select k from unnest(array['Atambua Barat','Atambua Selatan','Kota Atambua','Kakuluk Mesak','Lamaknen',
                                  'Lamaknen Selatan','Lasiolat','Nanaet Duabesi','Raihat','Raimanuk',
                                  'Tasifeto Barat','Tasifeto Timur']) k
        where lower(replace(k, ' ', '')) = lower(regexp_replace(p, '[^A-Za-z]', '', 'g'))
           or lower(replace(k, ' ', '')) = lower(regexp_replace(regexp_replace(p, '^\s*kec(amatan)?\.?\s*', '', 'i'), '[^A-Za-z]', '', 'g'))
        limit 1),
      initcap(regexp_replace(btrim(p), '\s+', ' ', 'g')))
  end
$$;

-- Teks bersih: buang tag HTML (mis. "<br>"), rapikan spasi, "-" = kosong
create or replace function public.oss_clean(p text)
returns text
language sql
immutable
as $$ select public.import_clean_text(regexp_replace(coalesce(p, ''), '<[^>]*>', ' ', 'g')) $$;

-- Angka format Indonesia: "1.035,34" -> 1035.34 ; "14.177" -> 14177 ; "50000000" -> 50000000
create or replace function public.oss_parse_number(p text)
returns numeric
language plpgsql
immutable
as $$
declare
  s text := regexp_replace(coalesce(p, ''), '[^0-9.,-]', '', 'g');
begin
  if s = '' or s = '-' then return null; end if;
  if s ~ ',' then
    s := replace(replace(s, '.', ''), ',', '.');
  elsif s ~ '^-?\d{1,3}(\.\d{3})+$' then
    s := replace(s, '.', '');
  end if;
  return s::numeric;
exception when others then
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tabel
-- -----------------------------------------------------------------------------
create table public.oss_businesses (
  id                     uuid primary key default gen_random_uuid(),
  nib                    text not null unique check (nib ~ '^[0-9]{13}$'),
  name                   text not null,
  oss_issued_date        date,
  investment_status      text,
  company_type           text,
  business_scale         text,
  address                text,
  kelurahan              text,
  kecamatan              text,
  kab_kota               text,
  source_data            jsonb not null,
  source_hash            text not null,
  first_import_batch_id  uuid references public.import_batches(id) on delete set null,
  last_import_batch_id   uuid references public.import_batches(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index oss_businesses_name_trgm on public.oss_businesses using gin (name gin_trgm_ops);
create index oss_businesses_issued_idx on public.oss_businesses(oss_issued_date);
create index oss_businesses_kec_idx on public.oss_businesses(kecamatan);

create table public.oss_projects (
  id                     uuid primary key default gen_random_uuid(),
  project_id             text not null unique,
  nib                    text not null check (nib ~ '^[0-9]{13}$'),
  project_type           text,
  company_name           text not null,
  oss_issued_date        date,
  investment_status      text,
  company_type           text,
  risk_level             text,
  project_name           text,
  business_scale         text,
  address                text,
  kab_kota               text,
  kecamatan              text,
  kelurahan              text,
  submitted_date         date,
  kbli                   text,
  kbli_title             text,
  kl_sector              text,
  land_area              numeric(18,2),
  land_unit              text,
  investment             numeric(20,2) check (investment is null or investment >= 0),
  workers                integer check (workers is null or workers >= 0),
  source_data            jsonb not null,
  source_hash            text not null,
  first_import_batch_id  uuid references public.import_batches(id) on delete set null,
  last_import_batch_id   uuid references public.import_batches(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index oss_projects_nib_idx on public.oss_projects(nib);
create index oss_projects_kbli_idx on public.oss_projects(kbli);
create index oss_projects_submitted_idx on public.oss_projects(submitted_date);
create index oss_projects_name_trgm on public.oss_projects using gin ((coalesce(project_name, '') || ' ' || company_name) gin_trgm_ops);

create table public.oss_permits (
  id                     uuid primary key default gen_random_uuid(),
  permit_request_id      text not null unique,
  nib                    text check (nib ~ '^[0-9]{13}$'),
  company_name           text not null,
  oss_issued_date        date,
  investment_status      text,
  provinsi               text,
  kab_kota               text,
  kecamatan              text,
  kelurahan              text,
  project_id             text,
  risk_code              text check (risk_code is null or risk_code in ('R','MR','MT','T')),
  kbli                   text,
  permit_date            date not null,
  permit_category        text not null,
  document_name          text not null,
  authority              text,
  permit_status          text,
  authority_official     text,
  kl_sector              text,
  source_data            jsonb not null,
  source_hash            text not null,
  first_import_batch_id  uuid references public.import_batches(id) on delete set null,
  last_import_batch_id   uuid references public.import_batches(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index oss_permits_nib_idx on public.oss_permits(nib);
create index oss_permits_project_idx on public.oss_permits(project_id);
create index oss_permits_date_idx on public.oss_permits(permit_date);
create index oss_permits_doc_idx on public.oss_permits(permit_category, document_name);
create index oss_permits_name_trgm on public.oss_permits using gin (company_name gin_trgm_ops);

do $$
declare t text;
begin
  foreach t in array array['oss_businesses','oss_projects','oss_permits'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_active_user())', t || '_select', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
-- Tidak ada policy INSERT/UPDATE/DELETE: penulisan hanya lewat fungsi impor.

-- -----------------------------------------------------------------------------
-- Normalisasi baris per dataset -> {canon, errors[], warnings[]}
-- Klien mengirim tanggal sudah dalam YYYY-MM-DD (atau teks asli bila gagal).
-- -----------------------------------------------------------------------------
create or replace function public.oss_normalize_row(p_dataset text, p jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  c jsonb := '{}'::jsonb;
  errs jsonb := '[]'::jsonb;
  warns jsonb := '[]'::jsonb;
  f text;
  d record;
  v text;
  text_fields text[];
  date_fields text[];
  required text[];
  key_field text;
begin
  if p_dataset = 'oss_nib' then
    key_field := 'nib';
    text_fields := array['name','investment_status','company_type','business_scale','address','kelurahan','kecamatan','kab_kota'];
    date_fields := array['oss_issued_date'];
    required := array['nib','name'];
  elsif p_dataset = 'oss_projects' then
    key_field := 'project_id';
    text_fields := array['project_id','project_type','company_name','investment_status','company_type','risk_level','project_name',
                         'business_scale','address','kab_kota','kecamatan','kelurahan','kbli','kbli_title','kl_sector','land_unit'];
    date_fields := array['oss_issued_date','submitted_date'];
    required := array['project_id','nib','company_name'];
  elsif p_dataset = 'oss_permits' then
    key_field := 'permit_request_id';
    text_fields := array['permit_request_id','company_name','investment_status','provinsi','kab_kota','kecamatan','kelurahan','project_id',
                         'risk_code','kbli','permit_category','document_name','authority','permit_status','authority_official','kl_sector'];
    date_fields := array['oss_issued_date','permit_date'];
    required := array['permit_request_id','company_name','permit_date','permit_category','document_name'];
  else
    raise exception 'Dataset OSS tidak dikenal: %', p_dataset using errcode = '22023';
  end if;

  foreach f in array text_fields loop
    c := c || jsonb_build_object(f, public.oss_clean(p->>f));
  end loop;
  if c ? 'kecamatan' then c := c || jsonb_build_object('kecamatan', public.oss_norm_kecamatan(c->>'kecamatan')); end if;
  if c ? 'kelurahan' and c->>'kelurahan' is not null then c := c || jsonb_build_object('kelurahan', initcap(c->>'kelurahan')); end if;
  if c ? 'risk_code' and c->>'risk_code' is not null then
    v := upper(replace(c->>'risk_code', ' ', ''));
    v := case v when 'RENDAH' then 'R' when 'MENENGAHRENDAH' then 'MR' when 'MENENGAHTINGGI' then 'MT' when 'TINGGI' then 'T' else v end;
    if v not in ('R','MR','MT','T') then
      warns := warns || jsonb_build_object('field', 'risk_code', 'message', format('Kode risiko "%s" tidak dikenal; dikosongkan', p->>'risk_code'));
      v := null;
    end if;
    c := c || jsonb_build_object('risk_code', v);
  end if;

  -- NIB 13 digit (Excel kadang membuang angka 0 di depan)
  v := regexp_replace(coalesce(p->>'nib', ''), '[^0-9]', '', 'g');
  if v <> '' and length(v) < 13 then v := lpad(v, 13, '0'); end if;
  if v <> '' and length(v) <> 13 then
    errs := errs || jsonb_build_object('field', 'nib', 'message', format('NIB "%s" bukan 13 digit', p->>'nib'));
  end if;
  c := c || jsonb_build_object('nib', nullif(v, ''));

  if p_dataset = 'oss_nib' and c->>'name' is null then
    c := c || jsonb_build_object('name', public.oss_clean(p->>'company_name'));
  end if;

  foreach f in array date_fields loop
    select * into d from public.import_parse_date(p->>f);
    if not d.ok then
      if f = any(required) then
        errs := errs || jsonb_build_object('field', f, 'message', format('Tanggal "%s" tidak valid', p->>f));
      else
        warns := warns || jsonb_build_object('field', f, 'message', format('Tanggal "%s" tidak valid; dikosongkan', p->>f));
      end if;
    end if;
    c := c || jsonb_build_object(f, to_jsonb(d.v));
  end loop;

  if p_dataset = 'oss_projects' then
    c := c || jsonb_build_object(
      'land_area', public.oss_parse_number(p->>'land_area'),
      'investment', public.oss_parse_number(p->>'investment'),
      'workers', (public.oss_parse_number(p->>'workers'))::int);
    if p->>'investment' is not null and c->'investment' = 'null'::jsonb then
      warns := warns || jsonb_build_object('field', 'investment', 'message', format('Nilai investasi "%s" tidak dikenali', p->>'investment'));
    end if;
  end if;

  if p_dataset = 'oss_permits' and c->>'nib' is null then
    warns := warns || jsonb_build_object('field', 'nib', 'message', 'NIB kosong di ekspor OSS; izin tetap disimpan tanpa tautan pelaku usaha');
  end if;

  foreach f in array required loop
    if c->>f is null and not exists (select 1 from jsonb_array_elements(errs) e where e->>'field' = f) then
      errs := errs || jsonb_build_object('field', f, 'message', format('Kolom %s wajib diisi', f));
    end if;
  end loop;

  return jsonb_build_object('canon', c, 'errors', errs, 'warnings', warns, 'key', c->>key_field);
end;
$$;

create or replace function public.oss_table(p_dataset text)
returns text
language sql
immutable
as $$ select case p_dataset when 'oss_nib' then 'oss_businesses' when 'oss_projects' then 'oss_projects' when 'oss_permits' then 'oss_permits' end $$;

create or replace function public.oss_key_column(p_dataset text)
returns text
language sql
immutable
as $$ select case p_dataset when 'oss_nib' then 'nib' when 'oss_projects' then 'project_id' when 'oss_permits' then 'permit_request_id' end $$;

-- Analisis satu baris: new | unchanged | changed (+ daftar perubahan)
create or replace function public.oss_analyze_row(p_dataset text, p_canon jsonb, p_key text)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_hash text := md5(p_canon::text);
  v_prev jsonb;
  v_prev_hash text;
  v_changes jsonb := '[]'::jsonb;
  k text;
begin
  execute format('select source_data, source_hash from public.%I where %I = $1', public.oss_table(p_dataset), public.oss_key_column(p_dataset))
    into v_prev, v_prev_hash using p_key;
  if v_prev_hash is null then
    return jsonb_build_object('status', 'new', 'hash', v_hash);
  end if;
  if v_prev_hash = v_hash then
    return jsonb_build_object('status', 'unchanged', 'hash', v_hash);
  end if;
  for k in select jsonb_object_keys(p_canon) loop
    if (v_prev -> k) is distinct from (p_canon -> k) then
      v_changes := v_changes || jsonb_build_object('field', k, 'old', v_prev -> k, 'new', p_canon -> k);
    end if;
  end loop;
  return jsonb_build_object('status', case when jsonb_array_length(v_changes) = 0 then 'unchanged' else 'changed' end,
                            'hash', v_hash, 'changes', v_changes);
end;
$$;

create or replace function public.oss_import_preview(p_dataset text, p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r jsonb; n jsonb; a jsonb;
  out jsonb := '[]'::jsonb;
begin
  if not public.has_any_role('super_admin', 'admin_arsip') then
    raise exception 'Anda tidak memiliki hak untuk impor data' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Data pratinjau harus berupa array maksimal 1000 baris' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    n := public.oss_normalize_row(p_dataset, r);
    a := case when jsonb_array_length(n->'errors') > 0 then jsonb_build_object('status', 'error')
              else public.oss_analyze_row(p_dataset, n->'canon', n->>'key') end;
    out := out || jsonb_build_object(
      'row_number', (r->>'row_number')::int, 'status', a->>'status', 'application_id', null, 'reason', null, 'message', null,
      'changes', coalesce(a->'changes', '[]'::jsonb), 'conflict_fields', '[]'::jsonb,
      'errors', n->'errors', 'warnings', n->'warnings');
  end loop;
  return out;
end;
$$;

create or replace function public.oss_apply_row(p_dataset text, p_batch uuid, c jsonb, p_hash text)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_dataset = 'oss_nib' then
    insert into public.oss_businesses as t (nib, name, oss_issued_date, investment_status, company_type, business_scale, address,
                                            kelurahan, kecamatan, kab_kota, source_data, source_hash, first_import_batch_id, last_import_batch_id)
    values (c->>'nib', c->>'name', (c->>'oss_issued_date')::date, c->>'investment_status', c->>'company_type', c->>'business_scale',
            c->>'address', c->>'kelurahan', c->>'kecamatan', c->>'kab_kota', c, p_hash, p_batch, p_batch)
    on conflict (nib) do update set
      name = excluded.name, oss_issued_date = excluded.oss_issued_date, investment_status = excluded.investment_status,
      company_type = excluded.company_type, business_scale = excluded.business_scale, address = excluded.address,
      kelurahan = excluded.kelurahan, kecamatan = excluded.kecamatan, kab_kota = excluded.kab_kota,
      source_data = excluded.source_data, source_hash = excluded.source_hash, last_import_batch_id = p_batch;
  elsif p_dataset = 'oss_projects' then
    insert into public.oss_projects as t (project_id, nib, project_type, company_name, oss_issued_date, investment_status, company_type,
                                          risk_level, project_name, business_scale, address, kab_kota, kecamatan, kelurahan, submitted_date,
                                          kbli, kbli_title, kl_sector, land_area, land_unit, investment, workers,
                                          source_data, source_hash, first_import_batch_id, last_import_batch_id)
    values (c->>'project_id', c->>'nib', c->>'project_type', c->>'company_name', (c->>'oss_issued_date')::date, c->>'investment_status',
            c->>'company_type', c->>'risk_level', c->>'project_name', c->>'business_scale', c->>'address', c->>'kab_kota', c->>'kecamatan',
            c->>'kelurahan', (c->>'submitted_date')::date, c->>'kbli', c->>'kbli_title', c->>'kl_sector', (c->>'land_area')::numeric,
            c->>'land_unit', (c->>'investment')::numeric, (c->>'workers')::int, c, p_hash, p_batch, p_batch)
    on conflict (project_id) do update set
      nib = excluded.nib, project_type = excluded.project_type, company_name = excluded.company_name, oss_issued_date = excluded.oss_issued_date,
      investment_status = excluded.investment_status, company_type = excluded.company_type, risk_level = excluded.risk_level,
      project_name = excluded.project_name, business_scale = excluded.business_scale, address = excluded.address, kab_kota = excluded.kab_kota,
      kecamatan = excluded.kecamatan, kelurahan = excluded.kelurahan, submitted_date = excluded.submitted_date, kbli = excluded.kbli,
      kbli_title = excluded.kbli_title, kl_sector = excluded.kl_sector, land_area = excluded.land_area, land_unit = excluded.land_unit,
      investment = excluded.investment, workers = excluded.workers, source_data = excluded.source_data, source_hash = excluded.source_hash,
      last_import_batch_id = p_batch;
  else
    insert into public.oss_permits as t (permit_request_id, nib, company_name, oss_issued_date, investment_status, provinsi, kab_kota,
                                         kecamatan, kelurahan, project_id, risk_code, kbli, permit_date, permit_category, document_name,
                                         authority, permit_status, authority_official, kl_sector,
                                         source_data, source_hash, first_import_batch_id, last_import_batch_id)
    values (c->>'permit_request_id', c->>'nib', c->>'company_name', (c->>'oss_issued_date')::date, c->>'investment_status', c->>'provinsi',
            c->>'kab_kota', c->>'kecamatan', c->>'kelurahan', c->>'project_id', c->>'risk_code', c->>'kbli', (c->>'permit_date')::date,
            c->>'permit_category', c->>'document_name', c->>'authority', c->>'permit_status', c->>'authority_official', c->>'kl_sector',
            c, p_hash, p_batch, p_batch)
    on conflict (permit_request_id) do update set
      nib = excluded.nib, company_name = excluded.company_name, oss_issued_date = excluded.oss_issued_date,
      investment_status = excluded.investment_status, provinsi = excluded.provinsi, kab_kota = excluded.kab_kota, kecamatan = excluded.kecamatan,
      kelurahan = excluded.kelurahan, project_id = excluded.project_id, risk_code = excluded.risk_code, kbli = excluded.kbli,
      permit_date = excluded.permit_date, permit_category = excluded.permit_category, document_name = excluded.document_name,
      authority = excluded.authority, permit_status = excluded.permit_status, authority_official = excluded.authority_official,
      kl_sector = excluded.kl_sector, source_data = excluded.source_data, source_hash = excluded.source_hash, last_import_batch_id = p_batch;
  end if;
end;
$$;

create or replace function public.oss_import_commit(p_batch_id uuid, p_dataset text, p_rows jsonb, p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.import_batches%rowtype;
  r jsonb; n jsonb; a jsonb; w jsonb;
  v_row int;
  v_update boolean := coalesce((p_options->>'update_changed')::boolean, false);
  c_ins int := 0; c_upd int := 0; c_unch int := 0; c_skip int := 0; c_fail int := 0;
  v_state text; v_msg text; v_constraint text;
begin
  if not public.has_any_role('super_admin', 'admin_arsip') then
    raise exception 'Anda tidak memiliki hak untuk impor data' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Data impor harus berupa array maksimal 1000 baris per potongan' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('e_arsip_import'));
  select * into v_batch from public.import_batches where id = p_batch_id for update;
  if not found then raise exception 'Batch impor tidak ditemukan' using errcode = 'P0002'; end if;
  if v_batch.status not in ('draft', 'processing') then raise exception 'Batch impor sudah ditutup' using errcode = 'P0001'; end if;
  if v_batch.dataset <> p_dataset then raise exception 'Jenis data batch tidak sesuai' using errcode = '22023'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_row := (r->>'row_number')::int;
    n := public.oss_normalize_row(p_dataset, r);
    if jsonb_array_length(n->'errors') > 0 then
      insert into public.import_errors (batch_id, row_number, source_id, application_number, severity, error_type, field, message, raw_data)
      select p_batch_id, v_row, n->>'key', n->'canon'->>'nib', 'error', 'validation', e->>'field', e->>'message', r
        from jsonb_array_elements(n->'errors') e;
      c_fail := c_fail + 1;
      continue;
    end if;
    begin
      a := public.oss_analyze_row(p_dataset, n->'canon', n->>'key');
      if a->>'status' = 'new' then
        perform public.oss_apply_row(p_dataset, p_batch_id, n->'canon', a->>'hash'); c_ins := c_ins + 1;
      elsif a->>'status' = 'unchanged' then
        c_unch := c_unch + 1;
      elsif v_update then
        perform public.oss_apply_row(p_dataset, p_batch_id, n->'canon', a->>'hash'); c_upd := c_upd + 1;
      else
        insert into public.import_errors (batch_id, row_number, source_id, application_number, severity, error_type, message, raw_data)
        values (p_batch_id, v_row, n->>'key', n->'canon'->>'nib', 'warning', 'skipped', 'Data berubah di OSS, dilewati sesuai pilihan pengguna',
                jsonb_build_object('row', r, 'changes', a->'changes'));
        c_skip := c_skip + 1;
      end if;
      for w in select * from jsonb_array_elements(n->'warnings') loop
        insert into public.import_errors (batch_id, row_number, source_id, application_number, severity, error_type, field, message, raw_data)
        values (p_batch_id, v_row, n->>'key', n->'canon'->>'nib', 'warning', 'validation', w->>'field', w->>'message', r);
      end loop;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name, v_msg = message_text;
      insert into public.import_errors (batch_id, row_number, source_id, application_number, severity, error_type, message, raw_data)
      values (p_batch_id, v_row, n->>'key', n->'canon'->>'nib', 'error', 'database', public.import_friendly_error(v_state, v_constraint, v_msg), r);
      c_fail := c_fail + 1;
    end;
  end loop;

  update public.import_batches set
    status = 'processing', started_at = coalesce(started_at, now()),
    inserted_count = inserted_count + c_ins, updated_count = updated_count + c_upd,
    unchanged_count = unchanged_count + c_unch, skipped_count = skipped_count + c_skip,
    options = options || coalesce(p_options, '{}'::jsonb)
  where id = p_batch_id;
  return jsonb_build_object('inserted', c_ins, 'updated', c_upd, 'unchanged', c_unch, 'skipped', c_skip, 'failed', c_fail);
end;
$$;

revoke all on function public.oss_import_preview(text, jsonb) from public, anon;
revoke all on function public.oss_import_commit(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.oss_import_preview(text, jsonb) to authenticated;
grant execute on function public.oss_import_commit(uuid, text, jsonb, jsonb) to authenticated;
revoke all on function public.oss_apply_row(text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.oss_analyze_row(text, jsonb, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- View pelaku usaha (gabungan NIB dari ketiga ekspor)
-- -----------------------------------------------------------------------------
create or replace view public.v_oss_business
with (security_invoker = true) as
with nibs as (
  select nib from public.oss_businesses
  union select nib from public.oss_projects
  union select nib from public.oss_permits where nib is not null
),
pj as (
  select nib, count(*) as project_count, sum(investment) as investment, sum(workers) as workers,
         min(oss_issued_date) as issued, max(company_name) as company_name, max(company_type) as company_type,
         max(business_scale) as business_scale, max(kecamatan) as kecamatan, max(kelurahan) as kelurahan, max(address) as address
    from public.oss_projects group by nib
),
pm as (
  select nib, count(*) as permit_count, max(permit_date) as last_permit_date, min(oss_issued_date) as issued,
         max(company_name) as company_name, max(kecamatan) as kecamatan, max(kelurahan) as kelurahan
    from public.oss_permits group by nib
)
select
  n.nib,
  coalesce(b.name, pj.company_name, pm.company_name) as name,
  coalesce(b.oss_issued_date, pj.issued, pm.issued) as oss_issued_date,
  coalesce(b.company_type, pj.company_type) as company_type,
  coalesce(b.business_scale, pj.business_scale) as business_scale,
  b.investment_status,
  coalesce(b.address, pj.address) as address,
  coalesce(b.kecamatan, pj.kecamatan, pm.kecamatan) as kecamatan,
  coalesce(b.kelurahan, pj.kelurahan, pm.kelurahan) as kelurahan,
  b.id is not null as has_nib_record,
  coalesce(pj.project_count, 0)::int as project_count,
  coalesce(pm.permit_count, 0)::int as permit_count,
  coalesce(pj.investment, 0) as investment,
  coalesce(pj.workers, 0)::int as workers,
  pm.last_permit_date
from nibs n
left join public.oss_businesses b on b.nib = n.nib
left join pj on pj.nib = n.nib
left join pm on pm.nib = n.nib;

create or replace view public.v_oss_permit
with (security_invoker = true) as
select p.*, pr.id as project_record_id, pr.project_name, pr.kbli_title, pr.risk_level as project_risk, pr.business_scale, pr.investment
  from public.oss_permits p
  left join public.oss_projects pr on pr.project_id = p.project_id;

grant select on public.v_oss_business, public.v_oss_permit to authenticated;
revoke all on public.v_oss_business, public.v_oss_permit from anon;

-- -----------------------------------------------------------------------------
-- Rekap harian OSS (dipakai halaman Rekap izin)
--   NIB terbit       : tanggal terbit OSS per NIB (dari ketiga ekspor)
--   Sertifikat Standar & Izin : oss_permits berdasarkan tanggal izin
--   Persyaratan Dasar         : per nama dokumen
--   Status yang memuat "menunggu", "tolak", "batal", "proses" tidak dihitung.
-- -----------------------------------------------------------------------------
create or replace function public.report_oss_daily_counts(p_from date, p_to date)
returns table (day date, category text, label text, section text, location text, total bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_user() then
    raise exception 'Akun tidak aktif' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then
    raise exception 'Rentang tanggal tidak valid' using errcode = '22023';
  end if;

  return query
  with nib_dates as (
    select n.nib,
           coalesce(b.oss_issued_date,
                    (select min(x.oss_issued_date) from public.oss_projects x where x.nib = n.nib),
                    (select min(y.oss_issued_date) from public.oss_permits y where y.nib = n.nib)) as d,
           coalesce(b.kecamatan,
                    (select max(x.kecamatan) from public.oss_projects x where x.nib = n.nib),
                    (select max(y.kecamatan) from public.oss_permits y where y.nib = n.nib)) as kec,
           coalesce(b.kelurahan,
                    (select max(x.kelurahan) from public.oss_projects x where x.nib = n.nib)) as kel
      from (select nib from public.oss_businesses union select nib from public.oss_projects
            union select nib from public.oss_permits where nib is not null) n
      left join public.oss_businesses b on b.nib = n.nib
  ),
  permits as (
    select p.permit_date as d,
           case
             when p.permit_category ilike 'persyaratan dasar%' then 'oss:pd:' || lower(p.document_name)
             when p.permit_category ilike 'sertifikat standar%' and p.risk_code = 'MR' then 'oss:ss_mr'
             when p.permit_category ilike 'sertifikat standar%' and p.risk_code = 'MT' then 'oss:ss_mt'
             when p.permit_category ilike 'sertifikat standar%' then 'oss:ss_other'
             else 'oss:izin'
           end as cat,
           case
             when p.permit_category ilike 'persyaratan dasar%' then p.document_name
             when p.permit_category ilike 'sertifikat standar%' and p.risk_code = 'MR' then 'Sertifikat Standar (Menengah Rendah)'
             when p.permit_category ilike 'sertifikat standar%' and p.risk_code = 'MT' then 'Sertifikat Standar (Menengah Tinggi)'
             when p.permit_category ilike 'sertifikat standar%' then 'Sertifikat Standar (risiko lainnya)'
             else 'Izin (OSS)'
           end as lbl,
           case when p.permit_category ilike 'persyaratan dasar%' then 'PERSYARATAN DASAR PERIZINAN BERUSAHA (OSS)'
                else 'PERIZINAN BERUSAHA BERBASIS RISIKO (OSS)' end as sec,
           p.kecamatan as kec, p.kelurahan as kel
      from public.oss_permits p
     where p.permit_date between p_from and p_to
       and coalesce(p.permit_status, '') !~* '(menunggu|tolak|batal|proses|draft)'
  )
  select nd.d, 'oss:nib'::text, 'Nomor Induk Berusaha (NIB)'::text, 'PERIZINAN BERUSAHA BERBASIS RISIKO (OSS)'::text,
         nullif(upper(concat_ws(', ', nd.kel, nd.kec)), ''), count(*)::bigint
    from nib_dates nd where nd.d between p_from and p_to
   group by 1, 2, 3, 4, 5
  union all
  select pr.d, pr.cat, pr.lbl, pr.sec, nullif(upper(concat_ws(', ', pr.kel, pr.kec)), ''), count(*)::bigint
    from permits pr
   group by 1, 2, 3, 4, 5;
end;
$$;
revoke all on function public.report_oss_daily_counts(date, date) from public, anon;
grant execute on function public.report_oss_daily_counts(date, date) to authenticated;

-- Ringkasan OSS untuk dashboard
create or replace function public.get_oss_summary(p_year integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  if not public.is_active_user() then
    raise exception 'Akun tidak aktif' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'businesses', (select count(*) from public.v_oss_business b where p_year is null or extract(year from b.oss_issued_date) = p_year),
    'new_nib', (select count(*) from public.oss_businesses b where p_year is null or extract(year from b.oss_issued_date) = p_year),
    'projects', (select count(*) from public.oss_projects pr where p_year is null or extract(year from pr.submitted_date) = p_year),
    'permits', (select count(*) from public.oss_permits p where p_year is null or extract(year from p.permit_date) = p_year),
    'investment', (select coalesce(sum(investment), 0) from public.oss_projects pr where p_year is null or extract(year from pr.submitted_date) = p_year),
    'workers', (select coalesce(sum(workers), 0) from public.oss_projects pr where p_year is null or extract(year from pr.submitted_date) = p_year),
    'waiting', (select count(*) from public.oss_permits p where p.permit_status ~* 'menunggu'),
    'per_risk', coalesce((select jsonb_agg(jsonb_build_object('risk', r, 'count', n) order by n desc)
        from (select coalesce(risk_level, 'Tidak diketahui') r, count(*) n from public.oss_projects pr
               where p_year is null or extract(year from pr.submitted_date) = p_year group by 1) s), '[]'::jsonb),
    'per_kecamatan', coalesce((select jsonb_agg(jsonb_build_object('kecamatan', k, 'count', n) order by n desc)
        from (select coalesce(kecamatan, 'Tidak diketahui') k, count(*) n from public.oss_permits p
               where p_year is null or extract(year from p.permit_date) = p_year group by 1) s), '[]'::jsonb),
    'per_document', coalesce((select jsonb_agg(jsonb_build_object('document', d, 'count', n) order by n desc)
        from (select document_name d, count(*) n from public.oss_permits p
               where p_year is null or extract(year from p.permit_date) = p_year group by 1) s), '[]'::jsonb),
    'last_import', (select max(finished_at) from public.import_batches where dataset like 'oss%' and status in ('completed','completed_with_errors'))
  ) into v;
  return v;
end;
$$;
revoke all on function public.get_oss_summary(integer) from public, anon;
grant execute on function public.get_oss_summary(integer) to authenticated;

-- -----------------------------------------------------------------------------
-- Cadangan: sertakan tabel OSS
-- -----------------------------------------------------------------------------
create or replace function public.backup_table_order()
returns text[]
language sql
immutable
as $$
  select array['roles','profiles','classifications','permit_types','applicants','companies',
               'import_batches','applications','permits','archive_documents','import_errors',
               'system_settings','activity_logs','oss_businesses','oss_projects','oss_permits']
$$;
