"""
Uji integrasi database E-Arsip (PostgreSQL murni + stub skema Supabase).

Menjalankan:
  1. Buat database kosong, jalankan supabase/tests/stub_supabase.sql,
     seluruh supabase/migrations/*.sql, lalu supabase/seed.sql.
  2. python3 supabase/tests/db_test.py <rows.json> [dsn]

rows.json = array baris kanonik (hasil pemetaan kolom), contoh dibuat oleh
supabase/tests/xlsx_to_rows.py dari file ekspor SiCANTIK.
"""
import json
import sys
import uuid

import psycopg2
import psycopg2.extras

ROWS_FILE = sys.argv[1]
DSN = sys.argv[2] if len(sys.argv) > 2 else "host=/tmp port=5433 user=postgres dbname=earsip"

conn = psycopg2.connect(DSN)
conn.autocommit = False
passed = 0
failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  [OK]   {name}")
    else:
        failed += 1
        print(f"  [GAGAL] {name} {detail}")


def as_user(uid):
    """Kursor yang berjalan sebagai role authenticated dengan JWT sub = uid."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("set local role authenticated")
    if uid:
        cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(uid),))
    else:
        cur.execute("select set_config('request.jwt.claim.sub', '', true)")
    return cur


def admin_cursor():
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("reset role")
    cur.execute("select set_config('request.jwt.claim.sub', '', true)")
    return cur


def expect_error(name, fn):
    try:
        fn()
        conn.rollback()
        check(name, False, "(seharusnya ditolak)")
    except psycopg2.Error as e:
        conn.rollback()
        check(name, True)
        return e


rows = json.load(open(ROWS_FILE))

print("\n== 1. Akun & peran")
cur = admin_cursor()
users = {}
for key in ["super", "admin", "operator", "pimpinan", "pending"]:
    cur.execute("insert into auth.users (email, raw_user_meta_data) values (%s, %s) returning id",
                (f"{key}@belukab.go.id", json.dumps({"full_name": key.title(), "role": "super_admin"})))
    users[key] = cur.fetchone()["id"]
cur.execute("select p.id, r.code, p.is_active from profiles p join roles r on r.id = p.role_id")
prof = {r["id"]: r for r in cur.fetchall()}
check("akun pertama menjadi super_admin aktif", prof[users["super"]]["code"] == "super_admin" and prof[users["super"]]["is_active"])
check("akun berikutnya operator nonaktif (metadata role diabaikan)",
      prof[users["admin"]]["code"] == "operator" and not prof[users["admin"]]["is_active"])
conn.commit()

# Super admin menetapkan peran
for key, code in [("admin", "admin_arsip"), ("operator", "operator"), ("pimpinan", "pimpinan")]:
    c = as_user(users["super"])
    c.execute("update profiles set role_id = (select id from roles where code = %s), is_active = true where id = %s",
              (code, users[key]))
    conn.commit()
c = as_user(users["admin"])
c.execute("select current_role_code() as r")
check("super admin dapat menetapkan peran admin_arsip", c.fetchone()["r"] == "admin_arsip")
conn.commit()

c = as_user(users["operator"])
c.execute("update profiles set role_id = (select id from roles where code='super_admin') where id = %s", (users["operator"],))
c.execute("select current_role_code() as r")
check("operator tidak dapat menaikkan perannya sendiri", c.fetchone()["r"] == "operator")
conn.commit()

expect_error("super admin terakhir tidak dapat menonaktifkan diri",
             lambda: as_user(users["super"]).execute("update profiles set is_active=false where id=%s", (users["super"],)))

c = as_user(users["pending"])
c.execute("select count(*) n from applications")
check("akun nonaktif tidak melihat data", c.fetchone()["n"] == 0)
conn.rollback()

print("\n== 2. Hak impor")
expect_error("operator tidak dapat pratinjau impor",
             lambda: as_user(users["operator"]).execute("select import_preview(%s::jsonb)", (json.dumps(rows[:2]),)))
expect_error("pimpinan tidak dapat membuat batch impor",
             lambda: as_user(users["pimpinan"]).execute("insert into import_batches(file_name) values ('x.xlsx')"))


def run_import(rows_, update_changed=False, overwrite_rows=None, label="impor"):
    c = as_user(users["admin"])
    c.execute("insert into import_batches (file_name, total_rows, match_key) values (%s, %s, 'source_id') returning id",
              (f"{label}.xlsx", len(rows_)))
    batch = c.fetchone()["id"]
    conn.commit()
    totals = {}
    for i in range(0, len(rows_), 200):
        c = as_user(users["admin"])
        c.execute("select import_commit_rows(%s, %s::jsonb, %s::jsonb) as r",
                  (batch, json.dumps(rows_[i:i + 200]),
                   json.dumps({"update_changed": update_changed, "overwrite_rows": overwrite_rows or []})))
        r = c.fetchone()["r"]
        conn.commit()
        for k, v in r.items():
            totals[k] = totals.get(k, 0) + v
    c = as_user(users["admin"])
    c.execute("select * from import_finalize_batch(%s)", (batch,))
    b = c.fetchone()
    conn.commit()
    return batch, totals, b


print("\n== 3. Pratinjau impor pertama")
c = as_user(users["admin"])
c.execute("select import_preview(%s::jsonb, 'source_id') as p", (json.dumps(rows[:300]),))
p = c.fetchone()["p"]
conn.rollback()
statuses = {}
for x in p:
    statuses[x["status"]] = statuses.get(x["status"], 0) + 1
check("pratinjau 300 baris semuanya 'new'", statuses == {"new": 300}, statuses)
nwarn = sum(len(x["warnings"]) for x in p)
check("NIK tidak valid menjadi peringatan", nwarn > 0, nwarn)

print("\n== 4. Impor penuh")
b1, t1, batch1 = run_import(rows, label="sicantik-awal")
print("   ", t1, batch1["status"])
check("seluruh baris tersimpan (baru)", t1["inserted"] == len(rows), t1)
check("tidak ada baris gagal", t1["failed"] == 0, t1)
cur = admin_cursor()
cur.execute("select count(*) n from applications"); n_app = cur.fetchone()["n"]
cur.execute("select count(*) n from permits"); n_pm = cur.fetchone()["n"]
cur.execute("select count(*) n from applicants"); n_ap = cur.fetchone()["n"]
cur.execute("select count(*) n from permit_types"); n_pt = cur.fetchone()["n"]
cur.execute("select count(*) n from activity_logs where action like 'import.%'"); n_log = cur.fetchone()["n"]
cur.execute("select count(*) n from activity_logs where action = 'insert' and entity_type = 'applications'"); n_rowlog = cur.fetchone()["n"]
expected_permits = sum(1 for r in rows if r.get("permit_number") not in (None, "-", ""))
print(f"    permohonan={n_app} izin={n_pm} pemohon={n_ap} jenis_izin={n_pt}")
check("jumlah permohonan = jumlah baris", n_app == len(rows))
check("jumlah izin = baris bernomor izin", n_pm == expected_permits, (n_pm, expected_permits))
check("29 jenis izin terbentuk otomatis", n_pt == len({r['permit_type_name'] for r in rows}), n_pt)
check("impor dicatat sekali di audit (bukan per baris)", n_log == 1 and n_rowlog == 0, (n_log, n_rowlog))
cur.execute("select sector, count(*) n from permit_types group by sector order by 1")
print("    sektor:", {r['sector']: r['n'] for r in cur.fetchall()})
cur.execute("select count(*) n from permit_types where classification_id is null")
check("setiap jenis izin mendapat klasifikasi default", cur.fetchone()["n"] == 0)
cur.execute("select count(*) n from applications where application_number = '0015/500.16.7.1.Resi/DPMPTSP/I/2026'")
check("No Permohonan ganda dengan ID berbeda tetap tersimpan terpisah", cur.fetchone()["n"] == 2)
conn.rollback()

print("\n== 5. Impor ulang file yang sama")
b2, t2, _ = run_import(rows, label="sicantik-ulang")
check("semua baris 'tidak berubah'", t2["unchanged"] == len(rows) and t2["inserted"] == 0, t2)

print("\n== 6. Perubahan data & edit manual")
changed = json.loads(json.dumps(rows))
target_phone = changed[10]
target_phone["applicant_phone"] = "081200000001"
target_loc = changed[20]
target_loc["permit_location"] = "LOKASI BARU DARI SICANTIK"
issued_later = next(r for r in changed if r["permit_number"] == "-")
issued_later["permit_number"] = "999/500.16.7.2.TEST/DPMPTSP/XI/2026"
issued_later["issued_date"] = "2026-11-05"

# Admin mengubah manual lokasi izin pada target_loc
c = as_user(users["admin"])
c.execute("update applications set permit_location = 'DIUBAH MANUAL' where source_id = %s returning is_manually_edited, manually_edited_fields",
          (target_loc["source_id"],))
r = c.fetchone()
conn.commit()
check("edit manual ditandai", r["is_manually_edited"] and "permit_location" in r["manually_edited_fields"], r)

c = as_user(users["admin"])
c.execute("update applications set physical_location = 'Rak A-01' where source_id = %s returning is_manually_edited",
          (target_phone["source_id"],))
check("ubah metadata arsip (lokasi fisik) tidak dianggap edit data sumber", not c.fetchone()["is_manually_edited"])
conn.commit()

c = as_user(users["admin"])
c.execute("select import_preview(%s::jsonb, 'source_id') as p", (json.dumps([target_phone, target_loc, issued_later, changed[30]]),))
p = {x["row_number"]: x for x in c.fetchone()["p"]}
conn.rollback()
check("perubahan telepon terdeteksi 'changed'", p[target_phone["row_number"]]["status"] == "changed", p[target_phone["row_number"]])
check("perubahan pada field yang diedit manual = 'conflict'", p[target_loc["row_number"]]["status"] == "conflict",
      p[target_loc["row_number"]]["status"])
check("izin terbit baru terdeteksi 'changed'", p[issued_later["row_number"]]["status"] == "changed")
check("baris tak berubah = 'unchanged'", p[changed[30]["row_number"]]["status"] == "unchanged")

# Impor dengan opsi lewati perubahan
b3, t3, _ = run_import(changed, update_changed=False, label="sicantik-lewati")
check("mode lewati: 2 dilewati karena berubah + 1 konflik dilewati", t3["skipped"] == 3 and t3["updated"] == 0, t3)
cur = admin_cursor()
cur.execute("select phone from applicants a join applications p on p.applicant_id=a.id where p.source_id=%s", (target_phone["source_id"],))
check("data tidak berubah saat dilewati", cur.fetchone()["phone"] != "081200000001")
conn.rollback()

# Impor dengan pembaruan, tanpa konfirmasi timpa manual
b4, t4, _ = run_import(changed, update_changed=True, label="sicantik-perbarui")
check("mode perbarui: 2 diperbarui, konflik manual tetap dilewati", t4["updated"] == 2 and t4["skipped"] == 1, t4)
cur = admin_cursor()
cur.execute("select a.phone from applicants a join applications p on p.applicant_id=a.id where p.source_id=%s", (target_phone["source_id"],))
check("telepon diperbarui", cur.fetchone()["phone"] == "081200000001")
cur.execute("select permit_location from applications where source_id=%s", (target_loc["source_id"],))
check("nilai edit manual TIDAK ditimpa tanpa konfirmasi", cur.fetchone()["permit_location"] == "DIUBAH MANUAL")
cur.execute("select a.status, p.permit_number from applications a join permits p on p.application_id = a.id where a.source_id=%s",
            (issued_later["source_id"],))
r = cur.fetchone()
check("izin terbit baru tercatat & status permohonan 'terbit'", r and r["status"] == "terbit", r)
cur.execute("select physical_location from applications where source_id=%s", (target_phone["source_id"],))
check("metadata arsip (lokasi fisik) tetap utuh setelah impor", cur.fetchone()["physical_location"] == "Rak A-01")
conn.rollback()

# Dengan konfirmasi timpa
b5, t5, _ = run_import(changed, update_changed=True, overwrite_rows=[target_loc["row_number"]], label="sicantik-timpa")
check("konfirmasi timpa: 1 diperbarui", t5["updated"] == 1, t5)
cur = admin_cursor()
cur.execute("select permit_location, is_manually_edited from applications where source_id=%s", (target_loc["source_id"],))
r = cur.fetchone()
check("data manual ditimpa setelah dikonfirmasi & tanda manual dihapus",
      r["permit_location"] == "LOKASI BARU DARI SICANTIK" and not r["is_manually_edited"], r)
conn.rollback()

print("\n== 7. Validasi & duplikat")
bad = [
    {"row_number": 9001, "source_id": "X1", "application_number": "", "permit_type_name": "Uji", "application_date": "2026-01-01", "applicant_name": "A B"},
    {"row_number": 9002, "source_id": "X2", "application_number": "N2", "permit_type_name": "Uji", "application_date": "31/12/2026", "applicant_name": "C D"},
    {"row_number": 9003, "source_id": "X3", "application_number": "N3", "permit_type_name": "Uji Izin Duplikat", "application_date": "2026-02-02",
     "applicant_name": "E F", "permit_number": rows[0]["permit_number"], "issued_date": "2026-02-03"},
]
b6, t6, batch6 = run_import(bad, label="sicantik-buruk")
check("3 baris gagal (wajib kosong, tanggal salah, nomor izin duplikat)", t6["failed"] == 3, t6)
check("status batch 'failed'", batch6["status"] == "failed", batch6["status"])
c = as_user(users["admin"])
c.execute("select error_type, message from import_errors where batch_id=%s order by row_number", (b6,))
errs = c.fetchall()
conn.rollback()
check("pesan kesalahan ramah pengguna", any("Nomor izin sudah tercatat" in e["message"] for e in errs), errs)
c = as_user(users["pimpinan"])
c.execute("select count(*) n from import_errors")
check("pimpinan tidak dapat membaca detail kesalahan impor (berisi NIK)", c.fetchone()["n"] == 0)
conn.rollback()

print("\n== 8. RLS data arsip")
c = as_user(users["operator"])
c.execute("select id from permit_types limit 1"); pt = c.fetchone()["id"]
c.execute("insert into applicants (full_name, nik) values ('Pemohon Manual', '5304000000000001') returning id, data_source")
r = c.fetchone()
check("operator dapat menambah pemohon (data_source=manual)", r["data_source"] == "manual")
c.execute("insert into applications (application_number, applicant_id, permit_type_id, application_date) values ('MANUAL-1', %s, %s, '2026-11-01') returning id",
          (r["id"], pt))
op_app = c.fetchone()["id"]
conn.commit()
c = as_user(users["operator"])
c.execute("update applications set notes='x' where source_id = %s", (rows[0]["source_id"],))
check("operator tidak dapat mengubah data milik orang lain", c.rowcount == 0)
c.execute("update applications set notes='catatan operator' where id = %s", (op_app,))
check("operator dapat mengubah data yang ia buat", c.rowcount == 1)
c.execute("delete from applications where id = %s", (op_app,))
check("operator tidak dapat menghapus", c.rowcount == 0)
conn.commit()
expect_error("pimpinan tidak dapat menambah data", lambda: as_user(users["pimpinan"]).execute(
    "insert into applicants (full_name) values ('X Y')"))
c = as_user(users["pimpinan"])
c.execute("select count(*) n from v_archive_list")
check("pimpinan dapat melihat arsip", c.fetchone()["n"] > 800)
conn.rollback()
c = as_user(None)
c.execute("select count(*) n from applications")
check("tanpa login tidak melihat data", c.fetchone()["n"] == 0)
conn.rollback()
cur = admin_cursor()
cur.execute("set local role anon")
expect_error("role anon ditolak di level grant", lambda: cur.execute("select * from applications limit 1"))

# Impor menemukan arsip manual dengan nomor sama -> konflik
c = as_user(users["admin"])
c.execute("select import_preview(%s::jsonb, 'application_number') as p", (json.dumps([{
    "row_number": 1, "source_id": "777", "application_number": "MANUAL-1", "permit_type_name": "Uji",
    "application_date": "2026-11-01", "applicant_name": "Pemohon Manual"}]),))
check("arsip manual yang cocok nomor permohonan = konflik", c.fetchone()["p"][0]["status"] == "conflict")
conn.rollback()

print("\n== 9. Dokumen & versi")
c = as_user(users["operator"])
gid = str(uuid.uuid4())
c.execute("""insert into archive_documents (id, application_id, category, title, storage_path, file_name, file_size)
             values (%s, %s, 'surat_permohonan', 'Surat Permohonan', %s, 'a.pdf', 1000) returning version, document_group_id, uploaded_by""",
          (gid, op_app, f"permohonan/{op_app}/{uuid.uuid4()}.pdf"))
r = c.fetchone()
check("versi 1 & grup = id", r["version"] == 1 and str(r["document_group_id"]) == gid and str(r["uploaded_by"]) == str(users["operator"]))
c.execute("""insert into archive_documents (application_id, category, title, storage_path, file_name, file_size, document_group_id, version)
             values (%s, 'surat_permohonan', 'Surat Permohonan rev', %s, 'b.pdf', 2000, %s, 99) returning version""",
          (op_app, f"permohonan/{op_app}/{uuid.uuid4()}.pdf", gid))
check("versi berikutnya otomatis = 2", c.fetchone()["version"] == 2)
c.execute("select count(*) n from archive_documents where document_group_id=%s and is_latest", (gid,))
check("hanya satu versi terakhir", c.fetchone()["n"] == 1)
conn.commit()
expect_error("operator tidak dapat mengunggah dokumen rahasia", lambda: as_user(users["operator"]).execute(
    """insert into archive_documents (application_id, category, title, storage_path, file_name, file_size, access_level)
       values (%s, 'berita_acara', 'BA', %s, 'c.pdf', 10, 'rahasia')""", (op_app, f"permohonan/{op_app}/{uuid.uuid4()}.pdf")))
c = as_user(users["admin"])
c.execute("""insert into archive_documents (application_id, category, title, storage_path, file_name, file_size, access_level)
             values (%s, 'berita_acara', 'BA rahasia', %s, 'c.pdf', 10, 'rahasia') returning storage_path""",
          (op_app, f"permohonan/{op_app}/{uuid.uuid4()}.pdf"))
secret_path = c.fetchone()["storage_path"]
conn.commit()
c = as_user(users["operator"])
c.execute("select count(*) n from archive_documents where access_level='rahasia'")
check("operator tidak melihat dokumen rahasia", c.fetchone()["n"] == 0)
c.execute("select can_read_storage_object(%s) ok", (secret_path,))
check("operator tidak dapat membuat signed URL dokumen rahasia", not c.fetchone()["ok"])
conn.rollback()
c = as_user(users["pimpinan"])
c.execute("select can_read_storage_object(%s) ok", (secret_path,))
check("pimpinan dapat membaca dokumen rahasia", c.fetchone()["ok"])
conn.rollback()
c = as_user(users["operator"])
c.execute("update archive_documents set file_size = 1, title='Judul baru' where document_group_id=%s and is_latest returning file_size", (gid,))
check("metadata file (ukuran/path) tidak dapat dimanipulasi", c.fetchone()["file_size"] == 2000)
conn.rollback()

# Storage policy
cur = admin_cursor()
cur.execute("insert into storage.buckets values ('x','x',false,null,null) on conflict do nothing")
conn.commit()
c = as_user(users["operator"])
p_ok = f"permohonan/{op_app}/{uuid.uuid4()}.pdf"
c.execute("insert into storage.objects (bucket_id, name, owner_id) values ('arsip-dokumen', %s, %s)", (p_ok, str(users["operator"])))
check("operator dapat unggah ke path permohonan yang valid", c.rowcount == 1)
conn.commit()
expect_error("unggah ke path tidak valid ditolak", lambda: as_user(users["operator"]).execute(
    "insert into storage.objects (bucket_id, name, owner_id) values ('arsip-dokumen', 'lain/file.exe', %s)", (str(users["operator"]),)))
expect_error("pimpinan tidak dapat mengunggah", lambda: as_user(users["pimpinan"]).execute(
    "insert into storage.objects (bucket_id, name, owner_id) values ('arsip-dokumen', %s, %s)",
    (f"permohonan/{op_app}/{uuid.uuid4()}.pdf", str(users["pimpinan"]))))
c = as_user(users["operator"])
c.execute("delete from storage.objects where name = %s", (p_ok,))
check("pengunggah dapat menghapus berkas yatim miliknya", c.rowcount == 1)
conn.commit()

print("\n== 10. Audit trail")
c = as_user(users["admin"])
c.execute("select count(*) n from activity_logs where entity_type='applications' and action='update'")
check("perubahan manual tercatat di audit", c.fetchone()["n"] >= 2)
conn.rollback()
expect_error("log aktivitas tidak dapat ditulis langsung", lambda: as_user(users["super"]).execute(
    "insert into activity_logs (action) values ('palsu')"))
c = as_user(users["super"])
c.execute("delete from activity_logs")
check("log aktivitas tidak dapat dihapus (bahkan Super Admin)", c.rowcount == 0)
conn.rollback()
c = as_user(users["operator"])
c.execute("select log_activity('document.download', 'archive_documents', %s, 'Unduh')", (gid,))
c.execute("select count(*) n, count(distinct user_id) u from activity_logs")
r = c.fetchone()
check("operator hanya melihat log miliknya", r["u"] == 1, r)
conn.commit()
expect_error("log_activity menolak aksi DML palsu", lambda: as_user(users["operator"]).execute(
    "select log_activity('delete', 'applications', 'x', 'palsu')"))

print("\n== 11. Dashboard & laporan")
c = as_user(users["pimpinan"])
c.execute("select get_dashboard_stats() s")
s = c.fetchone()["s"]
print("    totals:", s["totals"])
check("dashboard: total permohonan sesuai data", s["totals"]["applications"] == len(rows) + 1)
check("dashboard: per jenis izin & sektor terisi", len(s["per_permit_type"]) > 0 and len(s["per_sector"]) > 0)
check("dashboard: riwayat impor terisi", len(s["recent_imports"]) == 5)
c.execute("select get_dashboard_stats(2026) s")
check("dashboard filter tahun", c.fetchone()["s"]["totals"]["applications"] == len(rows) + 1)
for g in ["permit_type", "sector", "month", "year", "application_type", "status", "classification"]:
    c.execute("select * from report_summary(null, null, %s)", (g,))
    res = c.fetchall()
    check(f"laporan rekap per {g}", sum(r["applications"] for r in res) == len(rows) + 1, len(res))
c.execute("select count(*) n from v_archive_list where not is_complete")
check("kelengkapan dokumen dihitung di view", c.fetchone()["n"] > 0)
conn.rollback()

print("\n== 12. Cadangan & pemulihan")
expect_error("admin arsip tidak dapat membuat cadangan", lambda: as_user(users["admin"]).execute("select export_backup()"))
c = as_user(users["super"])
c.execute("select export_backup() b")
backup = c.fetchone()["b"]
conn.commit()
check("cadangan berisi 13 tabel", len(backup["tables"]) == 13, list(backup["counts"].items()))
c = as_user(users["super"])
c.execute("select restore_backup(%s::jsonb, true) r", (json.dumps(backup, default=str),))
check("pemulihan uji (dry run) berhasil", c.fetchone()["r"]["dry_run"])
conn.rollback()
# Hapus satu izin lalu pulihkan
cur = admin_cursor()
cur.execute("select id, permit_number from permits order by permit_number limit 1")
victim = cur.fetchone()
cur.execute("delete from permits where id=%s", (victim["id"],))
conn.commit()
c = as_user(users["super"])
c.execute("select restore_backup(%s::jsonb, false) r", (json.dumps(backup, default=str),))
conn.commit()
cur = admin_cursor()
cur.execute("select permit_number from permits where id=%s", (victim["id"],))
r = cur.fetchone()
check("data yang terhapus kembali setelah pemulihan", r and r["permit_number"] == victim["permit_number"])
cur.execute("select count(*) n from applications")
check("tidak ada duplikasi setelah pemulihan", cur.fetchone()["n"] == len(rows) + 1)
conn.rollback()

print("\n== 13. Rekap harian & masa berlaku")
c = as_user(users["pimpinan"])
c.execute("select sum(total) n from report_daily_counts('2026-01-01', '2026-12-31', 'issued')")
check("rekap per tanggal penetapan = jumlah izin terbit", int(c.fetchone()["n"]) == len([r for r in rows if r.get("permit_number") not in (None, "-", "")]) + 1)
c.execute("select sum(total) n from report_daily_counts('2026-01-01', '2026-12-31', 'application')")
check("rekap per tanggal permohonan = jumlah permohonan", int(c.fetchone()["n"]) == len(rows) + 1)
c.execute("select day, sum(total) n from report_daily_counts('2026-10-01', '2026-10-31', 'issued') group by day order by day")
oct_rows = c.fetchall()
check("rekap Oktober hanya berisi tanggal Oktober", all(str(r["day"]).startswith("2026-10") for r in oct_rows) and len(oct_rows) > 0)
conn.rollback()
expect_error("rentang tanggal terbalik ditolak", lambda: as_user(users["pimpinan"]).execute("select * from report_daily_counts('2026-12-01','2026-01-01','issued')"))
c = as_user(None)
try:
    c.execute("select * from report_daily_counts('2026-01-01','2026-12-31','issued')")
    check("tanpa login tidak bisa rekap", False)
except psycopg2.Error:
    check("tanpa login tidak bisa rekap", True)
conn.rollback()

# Masa berlaku: atur 5 tahun untuk SIP Perawat Vokasi lalu hitung ulang
c = as_user(users["admin"])
c.execute("select id from permit_types where name ilike 'Surat Izin Praktik Perawat Vokasi%'")
pt_id = c.fetchone()["id"]
c.execute("update permit_types set validity_years = 5 where id = %s", (pt_id,))
c.execute("select recalculate_permit_validity(%s) n", (pt_id,))
n_recalc = c.fetchone()["n"]
conn.commit()
check("hitung ulang masa berlaku mengisi izin jenis tsb", n_recalc > 100, n_recalc)
cur = admin_cursor()
cur.execute("select count(*) n from permits where is_manually_edited")
check("hitung ulang tidak menandai edit manual", cur.fetchone()["n"] <= 1)
# Buat 3 izin hampir berakhir: 20 hari, 75 hari, 160 hari; 1 sudah lewat
cur.execute("""select permit_id as id from v_permit_expiry
               where permit_type_id=%s and not is_renewed order by issued_date desc limit 4""", (pt_id,))
ids = [r["id"] for r in cur.fetchall()]
for pid, days in zip(ids, [20, 75, 160, -10]):
    cur.execute("update permits set valid_until = today_wita() + %s, issued_date = least(issued_date, today_wita() + %s - 1) where id=%s", (days, days, pid))
conn.commit()
c = as_user(users["operator"])
c.execute("select get_expiry_summary() s")
s = c.fetchone()["s"]
b = {x["months"]: x["count"] for x in s["buckets"]}
print("    ringkasan:", b, "kedaluwarsa", s["expired"])
check("notifikasi <=1 bulan", b.get(1) == 1, b)
check("notifikasi <=3 bulan (kumulatif)", b.get(3) == 2, b)
check("notifikasi <=6 bulan (kumulatif)", b.get(6) == 3, b)
check("izin lewat masa berlaku terdeteksi", s["expired"] == 1, s["expired"])
c.execute("select mark_permit_reminded(%s, 'Dihubungi via WA')", (ids[0],))
c.execute("select renewal_notified_at is not null ok, renewal_note from v_permit_expiry where permit_id=%s", (ids[0],))
r = c.fetchone()
check("operator dapat menandai sudah diingatkan", r["ok"] and r["renewal_note"] == "Dihubungi via WA")
conn.commit()
expect_error("pimpinan tidak dapat menandai pengingat", lambda: as_user(users["pimpinan"]).execute("select mark_permit_reminded(%s)", (ids[1],)))
# Perpanjangan menghapus dari notifikasi
cur = admin_cursor()
cur.execute("select a.applicant_id, a.permit_type_id from permits pm join applications a on a.id=pm.application_id where pm.id=%s", (ids[1],))
ref = cur.fetchone()
conn.rollback()
c = as_user(users["operator"])
c.execute("insert into applications (application_number, applicant_id, permit_type_id, application_type, application_date) values ('PERPANJANG-1', %s, %s, 'Perpanjangan', today_wita())",
          (ref["applicant_id"], ref["permit_type_id"]))
conn.commit()
c = as_user(users["operator"])
c.execute("select get_expiry_summary() s")
b2 = {x["months"]: x["count"] for x in c.fetchone()["s"]["buckets"]}
c.execute("select is_renewed from v_permit_expiry where permit_id=%s", (ids[1],))
check("izin yang sudah diajukan perpanjangan keluar dari notifikasi", c.fetchone()["is_renewed"] and b2.get(3) == 1, b2)
conn.rollback()
expect_error("operator tidak dapat menghitung ulang masa berlaku", lambda: as_user(users["operator"]).execute("select recalculate_permit_validity(%s)", (pt_id,)))

print(f"\nHasil: {passed} lulus, {failed} gagal")
sys.exit(1 if failed else 0)
