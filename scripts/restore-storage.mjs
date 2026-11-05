#!/usr/bin/env node
// Pulihkan file PDF dari hasil backup-storage.mjs ke bucket "arsip-dokumen".
// Pemakaian:  node --env-file=.env.local scripts/restore-storage.mjs backups/storage-YYYYMMDDHHMM
// File yang sudah ada di bucket dilewati (tidak ditimpa). Checksum diverifikasi dari manifest.
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const [dir] = process.argv.slice(2)
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!dir || !url || !key) {
  console.error('Pemakaian: node --env-file=.env.local scripts/restore-storage.mjs <folder-backup>')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
const supabase = createClient(url, key, { auth: { persistSession: false } })
let ok = 0, skipped = 0, failed = 0
for (const f of manifest.files) {
  const buf = readFileSync(path.join(dir, f.path))
  if (createHash('sha256').update(buf).digest('hex') !== f.sha256) { console.error('  checksum tidak cocok:', f.path); failed++; continue }
  const { error } = await supabase.storage.from(manifest.bucket).upload(f.path, buf, { contentType: 'application/pdf', upsert: false })
  if (!error) ok++
  else if (/exists|Duplicate/i.test(error.message)) skipped++
  else { console.error('  gagal', f.path, error.message); failed++ }
}
console.log(`Selesai: ${ok} dipulihkan, ${skipped} sudah ada, ${failed} gagal.`)
process.exit(failed ? 2 : 0)
