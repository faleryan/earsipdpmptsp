# E-Arsip Perizinan — DPMPTSP Kabupaten Belu

Sistem manajemen arsip digital dokumen perizinan. Data permohonan dan izin terbit diterima dari
**SiCANTIK Cloud** melalui impor Excel/CSV, lalu dilengkapi dokumen PDF, klasifikasi arsip,
pencarian, laporan, dan audit trail. SiCANTIK tetap sistem utama pelayanan; aplikasi ini tidak
menyimpan kredensial SiCANTIK dan tidak terhubung langsung ke SiCANTIK.

| Lapisan | Teknologi |
| --- | --- |
| Frontend | React 19 + TypeScript + Vite 7, Tailwind CSS 4, komponen gaya shadcn/ui (Radix), Recharts |
| Backend | Supabase: PostgreSQL 15+, Auth, Storage (bucket privat), Edge Function, Row Level Security |
| Ekspor | SheetJS (Excel), jsPDF + AutoTable (PDF), pratinjau PDF dengan pdf.js (react-pdf) |
| Hosting | Vercel (frontend statis) + Supabase Cloud |

Dokumentasi lanjutan:

- [`docs/ARSITEKTUR.md`](docs/ARSITEKTUR.md) — arsitektur, model data, alur impor, keputusan desain
- [`docs/KEAMANAN-DAN-CADANGAN.md`](docs/KEAMANAN-DAN-CADANGAN.md) — peran & RLS, perlindungan data pribadi, backup & pemulihan
- [`docs/PANDUAN-IMPOR.md`](docs/PANDUAN-IMPOR.md) — langkah impor SiCANTIK untuk Admin Arsip

---

## 1. Struktur proyek

```
├── src/
│   ├── pages/               Halaman (dashboard, permohonan, impor, laporan, pengguna, …)
│   ├── components/          ui/ (primitif), common/, archive/, documents/, layout/
│   ├── lib/                 supabase, api & filter, ekspor, dokumen, import/ (parser + normalisasi)
│   └── hooks/               auth, pengaturan, daftar berhalaman, filter di URL
├── supabase/
│   ├── migrations/          001 skema · 002 keamanan/RLS/audit · 003 mesin impor · 004 laporan/backup · 005 storage · 006 rekap & masa berlaku
│   ├── seed.sql             Peran, klasifikasi contoh, pengaturan sistem
│   ├── functions/admin-users  Edge Function manajemen akun (Super Admin)
│   └── tests/               Uji integrasi database (PostgreSQL + stub Supabase)
├── scripts/                 Cadangan & pemulihan file PDF di Storage
└── vercel.json              SPA rewrite + header keamanan
```

## 2. Menyiapkan Supabase

1. Buat proyek di <https://supabase.com/dashboard> (region terdekat, mis. Singapore). Catat
   **Project URL**, **anon key**, dan **service_role key** (Project Settings → API).
2. Pasang Supabase CLI, lalu dari folder proyek:

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push                 # menjalankan supabase/migrations/*
   # data awal: tempel isi supabase/seed.sql di SQL Editor, atau dengan psql
   # (connection string: Project Settings → Database → Connection string)
   psql "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres" -f supabase/seed.sql
   ```

   Tanpa CLI: buka **SQL Editor**, jalankan berurutan keenam file di `supabase/migrations/`, lalu `supabase/seed.sql`.
   Sudah memasang versi sebelumnya? Cukup jalankan `20261106000006_recap_and_expiry.sql`.
3. **Authentication → Providers → Email**: matikan *Allow new users to sign up* (akun dibuat Super Admin).
   Atur *Site URL* ke alamat Vercel Anda dan tambahkan `https://<domain>/atur-sandi` pada *Redirect URLs*.
4. **Super Admin pertama**: Authentication → Users → *Add user* (centang *Auto Confirm*).
   Akun pertama di sistem otomatis menjadi **Super Admin aktif**. Akun berikutnya yang dibuat di luar
   aplikasi menjadi Operator nonaktif sampai diaktifkan.
5. Deploy Edge Function untuk menu *Pengguna* (membuat akun, atur ulang sandi, hapus akun):

   ```bash
   npx supabase functions deploy admin-users
   # opsional, batasi CORS ke domain Anda:
   npx supabase secrets set ALLOWED_ORIGIN=https://e-arsip.belukab.go.id
   ```

6. Pastikan bucket **arsip-dokumen** muncul di Storage dengan status *Private* (dibuat oleh migration 005).

> Database dapat dicek ulang kapan saja: semua tabel memakai RLS (`Database → Tables` menampilkan ikon perisai).

## 3. Menjalankan secara lokal

Butuh Node.js 20+.

```bash
npm install
cp .env.example .env.local      # isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY
npm run dev                     # http://localhost:5173
```

Perintah lain: `npm run build` (typecheck + build produksi), `npm test` (uji parser impor),
`npm run backup:storage` (cadangkan PDF, lihat dokumen keamanan).

## 4. Deploy ke Vercel

1. Push repositori ke GitHub/GitLab, lalu **Add New → Project** di Vercel dan pilih repositori.
2. Framework terdeteksi **Vite**; biarkan *Build Command* `npm run build` dan *Output* `dist`.
3. Isi *Environment Variables* (Production & Preview):
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon key
   
   **Jangan** memasukkan `SUPABASE_SERVICE_ROLE_KEY` ke Vercel.
4. Deploy. `vercel.json` sudah mengatur rewrite SPA (refresh di `/permohonan/...` tidak 404) dan header keamanan.
5. Masukkan domain Vercel ke *Site URL* / *Redirect URLs* Supabase Auth (langkah 2.3).

## 5. Alur kerja harian

1. **Admin Arsip** mengekspor data dari SiCANTIK → menu **Impor data** → unggah file → periksa
   pemetaan kolom → pratinjau (baru / berubah / konflik / tidak berubah / gagal) → mulai impor →
   unduh laporan kesalahan bila ada.
2. **Operator** membuka permohonan → **Unggah dokumen** (banyak PDF sekaligus, kategori ditebak dari nama file).
   Penanda kelengkapan berkas menunjukkan dokumen wajib yang masih kurang.
3. **Pimpinan** memantau dashboard dan mengekspor laporan Excel/PDF berkop dinas.
4. **Super Admin** mengelola pengguna, pengaturan, dan membuat cadangan berkala.

### Rekap izin harian / mingguan / bulanan

Menu **Rekap izin** menyusun matriks seperti spreadsheet rekapan dinas: baris per jenis izin
(dikelompokkan A, B, C… per kelompok laporan/sektor dengan JUMLAH tiap kelompok dan TOTAL),
kolom per hari dengan subtotal mingguan **Mg I–V** (minggu Senin–Minggu), per minggu, atau per bulan.

- Periode bebas (pintasan: bulan ini, bulan lalu, tahun ini). Harian maks. 31 hari.
- Menghitung **izin terbit** (tanggal penetapan) atau **permohonan masuk** (tanggal permohonan).
- Baris dapat diganti **per lokasi izin** atau **per kecamatan** (aturan pola di Pengaturan), plus filter
  sektor, jenis permohonan, dan "lokasi izin memuat …".
- **Unduh PDF** (A4/F4/A3 lanskap) berkop dinas dengan blok tanda tangan *Mengetahui, Kepala Dinas* dan
  *Kepala Bidang* (nama, pangkat, NIP; kosong = titik-titik untuk ditulis tangan). Penandatangan bawaan
  diatur di *Pengaturan → Laporan & notifikasi*. Juga tersedia ekspor Excel.
- Kelompok laporan (mis. "PERIZINAN BERUSAHA BERBASIS RISIKO") dan urutan baris diatur per jenis izin.

### Notifikasi masa berlaku izin

- Isi **Masa berlaku (tahun)** pada jenis izin → tanggal berakhir izin dihitung dari tanggal penetapan
  (izin yang tanggalnya pernah diubah manual tidak disentuh). Kolom "berlaku sampai" dari SiCANTIK
  juga dapat dipetakan saat impor.
- Lonceng di bilah atas dan kartu dashboard menampilkan izin aktif yang berakhir dalam **≤ 6, ≤ 3, ≤ 1 bulan**
  (ambang dapat diubah) serta yang sudah berakhir. Izin yang pemegangnya sudah mengajukan Perpanjangan/
  Perubahan jenis izin yang sama otomatis keluar dari notifikasi.
- Halaman **Masa berlaku izin**: kirim pengingat lewat **WhatsApp** (pesan sudah terisi), tandai "sudah
  diingatkan" dengan catatan, ekspor Excel/PDF. Semua tindakan tercatat di audit trail.

## 6. Pengujian yang sudah dijalankan

- `supabase/tests/db_test.py` — 96 uji integrasi pada PostgreSQL 16 dengan data ekspor SiCANTIK asli
  (857 baris): impor, impor ulang, deteksi perubahan, perlindungan edit manual, validasi, duplikat,
  RLS per peran, versi dokumen, kebijakan storage, audit trail append-only, dashboard, laporan,
  cadangan & pemulihan, rekap harian, perhitungan masa berlaku, ambang notifikasi 6/3/1 bulan,
  pengecualian izin yang sudah diperpanjang.

  ```bash
  createdb earsip_test
  psql -d earsip_test -f supabase/tests/stub_supabase.sql
  for f in supabase/migrations/*.sql supabase/seed.sql; do psql -d earsip_test -v ON_ERROR_STOP=1 -f $f; done
  python3 supabase/tests/xlsx_to_rows.py ekspor-sicantik.xlsx /tmp/rows.json
  pip install psycopg2-binary pandas openpyxl
  python3 supabase/tests/db_test.py /tmp/rows.json "dbname=earsip_test"
  ```

- `npm test` — matriks rekap (kolom hari/Mg I–V/bulan, subtotal, kecamatan) serta parser & normalisasi impor (tanggal Excel, format tanggal Indonesia, NIK panjang, CSV `;`,
  duplikat). Dengan `IMPORT_SAMPLE=/path/ekspor.xlsx npm test` hasilnya dicocokkan dengan file asli.
- Uji end-to-end antarmuka (Playwright) terhadap GoTrue + PostgREST asli: login, impor 857 baris lewat
  wizard, unggah PDF + validasi file palsu, pratinjau, unduh, versi baru, edit manual, impor ulang,
  laporan Excel/PDF, pembatasan per peran, cadangan & uji pemulihan.

## 7. Catatan penyesuaian

- **Klasifikasi arsip** di `seed.sql` (PRZ.01–PRZ.99) adalah contoh. Sesuaikan kode dan masa retensi
  dengan Klasifikasi Arsip dan JRA resmi Pemkab Belu melalui menu *Klasifikasi arsip*.
- **Sektor** jenis izin baru ditentukan dari aturan pola di *Pengaturan → Aturan impor*.
- **Dokumen wajib** per jenis izin diatur di *Jenis perizinan* (bawaan: surat permohonan, identitas,
  persyaratan, SK/izin).
- Paket `xlsx` memakai mirror npm `@e965/xlsx` (SheetJS 0.20.3 — versi yang sudah menambal
  kerentanan pada 0.18.5 di npm). Bila ingin sumber resmi, ganti di `package.json` menjadi
  `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`.
- Tipe TypeScript database ditulis manual di `src/types`. Untuk tipe otomatis:
  `npx supabase gen types typescript --linked > src/types/database.ts`.
