"""Ubah ekspor OSS (List izin / DP.NIB / DP.Proyek) menjadi baris kanonik untuk uji database.
Pemakaian: python3 supabase/tests/oss_to_rows.py <dataset> <file.xlsx> <out.json> <dmy|mdy>
dataset: oss_nib | oss_projects | oss_permits. Aplikasi web melakukan hal yang sama lewat wizard impor."""
import json, re, sys
import openpyxl

MONTHS = {m: i + 1 for i, m in enumerate(['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember'])}
MAPS = {
    'oss_nib': {'nib': 'nib', 'tanggalterbitoss': 'oss_issued_date', 'namaperusahaan': 'name', 'statuspenanamanmodal': 'investment_status',
                'uraianjenisperusahaan': 'company_type', 'uraianskalausaha': 'business_scale', 'alamatperusahaan': 'address',
                'kelurahan': 'kelurahan', 'kecamatan': 'kecamatan', 'kabkota': 'kab_kota'},
    'oss_projects': {'idproyek': 'project_id', 'uraianjenisproyek': 'project_type', 'nib': 'nib', 'namaperusahaan': 'company_name',
                     'tanggalterbitoss': 'oss_issued_date', 'uraianstatuspenanamanmodal': 'investment_status', 'uraianjenisperusahaan': 'company_type',
                     'uraianrisikoproyek': 'risk_level', 'namaproyek': 'project_name', 'uraianskalausaha': 'business_scale', 'alamatusaha': 'address',
                     'kabkotausaha': 'kab_kota', 'kecamatanusaha': 'kecamatan', 'kelurahanusaha': 'kelurahan', 'tanggalpengajuanproyek': 'submitted_date',
                     'kbli': 'kbli', 'judulkbli': 'kbli_title', 'klsektorpembina': 'kl_sector', 'luastanah': 'land_area', 'satuantanah': 'land_unit',
                     'jumlahinvestasi': 'investment', 'tki': 'workers'},
    'oss_permits': {'idpermohonanizin': 'permit_request_id', 'namaperusahaan': 'company_name', 'nib': 'nib', 'tanggalterbitoss': 'oss_issued_date',
                    'uraianstatuspenanamanmodal': 'investment_status', 'propinsi': 'provinsi', 'kabkota': 'kab_kota', 'kecamatan': 'kecamatan',
                    'kelurahan': 'kelurahan', 'idproyek': 'project_id', 'kdresiko': 'risk_code', 'kbli': 'kbli', 'tglizin': 'permit_date',
                    'uraianjenisperizinan': 'permit_category', 'namadokumen': 'document_name', 'uraiankewenangan': 'authority',
                    'statusperizinan': 'permit_status', 'kewenangan': 'authority_official', 'klsektor': 'kl_sector'},
}
DATES = {'oss_issued_date', 'submitted_date', 'permit_date'}

def norm(h): return re.sub(r'^dayof', '', re.sub(r'[^a-z0-9]', '', str(h or '').lower()))

def date(v, order):
    if v is None: return None
    if hasattr(v, 'strftime'): return v.strftime('%Y-%m-%d')
    s = str(v).strip()
    m = re.match(r'^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$', s)
    if m:
        a, b, y = int(m[1]), int(m[2]), int(m[3]); y = y + 2000 if y < 100 else y
        d, mo = (a, b) if order == 'dmy' else (b, a)
        return f'{y:04d}-{mo:02d}-{d:02d}'
    m = re.match(r'^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$', s)
    if m and m[2].lower() in MONTHS: return f'{int(m[3]):04d}-{MONTHS[m[2].lower()]:02d}-{int(m[1]):02d}'
    return s

dataset, src, out, order = sys.argv[1:5]
ws = openpyxl.load_workbook(src, read_only=True).worksheets[0]
rows = list(ws.iter_rows(values_only=True))
header = [norm(h) for h in rows[0]]
mp = MAPS[dataset]
res = []
for i, r in enumerate(rows[1:], start=2):
    o = {'row_number': i}
    for h, v in zip(header, r):
        if h in mp:
            f = mp[h]
            o[f] = date(v, order) if f in DATES else (None if v is None else (str(int(v)) if isinstance(v, float) and v.is_integer() else str(v)))
    if any(v for k, v in o.items() if k != 'row_number'): res.append(o)
json.dump(res, open(out, 'w'))
print(dataset, len(res), 'baris')
