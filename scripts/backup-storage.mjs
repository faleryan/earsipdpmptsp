#!/usr/bin/env node
// Cadangkan seluruh file PDF dari bucket privat "arsip-dokumen" ke folder lokal.
// Pemakaian:  node --env-file=.env.local scripts/backup-storage.mjs [folder-tujuan]
// Butuh SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY (JANGAN pernah dipasang di frontend/Vercel).
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY (mis. di .env.local).')
  process.exit(1)
}
const BUCKET = 'arsip-dokumen'
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')
const outDir = path.resolve(process.argv[2] ?? `backups/storage-${stamp}`)
const supabase = createClient(url, key, { auth: { persistSession: false } })

async function listAll(prefix = '') {
  const files = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000, offset })
    if (error) throw error
    for (const item of data) {
      const full = prefix ? `${prefix}/${item.name}` : item.name
      if (item.id === null) files.push(...(await listAll(full)))
      else files.push(full)
    }
    if (data.length < 1000) break
  }
  return files
}

const files = await listAll()
console.log(`${files.length} file ditemukan. Menyimpan ke ${outDir}`)
const manifest = []
let failed = 0
for (const [i, name] of files.entries()) {
  const { data, error } = await supabase.storage.from(BUCKET).download(name)
  if (error) { console.error('  gagal', name, error.message); failed++; continue }
  const buf = Buffer.from(await data.arrayBuffer())
  const dest = path.join(outDir, name)
  mkdirSync(path.dirname(dest), { recursive: true })
  writeFileSync(dest, buf)
  manifest.push({ path: name, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') })
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${files.length}`)
}
writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ bucket: BUCKET, created_at: new Date().toISOString(), files: manifest }, null, 2))
console.log(`Selesai: ${manifest.length} file tersimpan, ${failed} gagal.`)
process.exit(failed ? 2 : 0)
