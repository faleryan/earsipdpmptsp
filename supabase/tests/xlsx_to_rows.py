"""Ubah file ekspor SiCANTIK (format contoh 13 kolom) menjadi rows.json untuk db_test.py.
Pemakaian: python3 supabase/tests/xlsx_to_rows.py ekspor.xlsx rows.json
Aplikasi web melakukan pemetaan yang sama melalui wizard impor (src/lib/import)."""
import json, sys
import pandas as pd

MAP = {'Izin': 'permit_type_name', 'Nomor izin': 'permit_number', 'Jenis': 'application_type', 'Tanggal': 'application_date',
       'Pemohon': 'applicant_name', 'Lokasi': 'location', 'No Permohonan': 'application_number', 'No KTP': 'applicant_nik',
       'No Hp/Telp': 'applicant_phone', 'Email': 'applicant_email', 'Tanggal Penetapan': 'issued_date', 'ID': 'source_id',
       'Lokasi Izin': 'permit_location'}
df = pd.read_excel(sys.argv[1], dtype=object)
rows = []
for i, r in df.iterrows():
    o = {'row_number': i + 2}
    for src, dst in MAP.items():
        v = r.get(src)
        o[dst] = None if pd.isna(v) else v.strftime('%Y-%m-%d') if hasattr(v, 'strftime') else str(v)
    rows.append(o)
json.dump(rows, open(sys.argv[2], 'w'))
print(len(rows), 'baris')
