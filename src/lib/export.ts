import { format } from 'date-fns'
import { id } from 'date-fns/locale'
import { downloadBlob, safeFileName } from './utils'
import type { AppIdentity } from '@/hooks/useSettings'

export interface ExportColumn<T> {
  header: string
  value: (row: T) => string | number | null | undefined
  width?: number
}

interface ExportMeta {
  title: string
  subtitle?: string
  identity: AppIdentity
  generatedBy?: string
}

const stamp = () => format(new Date(), 'yyyyMMdd-HHmm')

export async function exportExcel<T>(rows: T[], columns: ExportColumn<T>[], meta: ExportMeta, fileBase: string) {
  const XLSX = await import('xlsx')
  const header = [
    [meta.identity.agency_name.toUpperCase()],
    [meta.title],
    [meta.subtitle ?? ''],
    [`Dicetak ${format(new Date(), 'd MMMM yyyy HH.mm', { locale: id })}${meta.generatedBy ? ` oleh ${meta.generatedBy}` : ''}`],
    [],
    ['No', ...columns.map((c) => c.header)],
  ]
  const body = rows.map((r, i) => [i + 1, ...columns.map((c) => c.value(r) ?? '')])
  const ws = XLSX.utils.aoa_to_sheet([...header, ...body])
  ws['!cols'] = [{ wch: 5 }, ...columns.map((c) => ({ wch: c.width ?? 20 }))]
  ws['!merges'] = [0, 1, 2, 3].map((r) => ({ s: { r, c: 0 }, e: { r, c: columns.length } }))
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 5, c: 0 }, e: { r: 5 + rows.length, c: columns.length } }) }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Data')
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true })
  downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeFileName(fileBase)}-${stamp()}.xlsx`)
}

/** Ekspor sederhana tanpa kop (mis. laporan kesalahan impor) */
export async function exportRawExcel(sheets: { name: string; rows: Record<string, unknown>[] }[], fileBase: string) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  sheets.forEach((s) => {
    const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ Keterangan: 'Tidak ada data' }])
    const keys = Object.keys(s.rows[0] ?? { Keterangan: '' })
    ws['!cols'] = keys.map((k) => ({ wch: Math.min(60, Math.max(10, k.length + 2, ...s.rows.slice(0, 200).map((r) => String(r[k] ?? '').length))) }))
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  })
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true })
  downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeFileName(fileBase)}-${stamp()}.xlsx`)
}


type JsPdfDoc = InstanceType<typeof import('jspdf').jsPDF>

/** Kop surat dinas. Mengembalikan posisi Y di bawah garis kop. */
export function drawLetterhead(doc: JsPdfDoc, identity: AppIdentity) {
  const pageW = doc.internal.pageSize.getWidth()
  const navy: [number, number, number] = [11, 34, 64]
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...navy)
  doc.text('PEMERINTAH KABUPATEN BELU', pageW / 2, 14, { align: 'center' })
  doc.setFontSize(12)
  doc.text(identity.agency_name.toUpperCase(), pageW / 2, 20, { align: 'center', maxWidth: pageW - 30 })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  const contact = [identity.address, identity.phone && `Telp. ${identity.phone}`, identity.email].filter(Boolean).join(' · ')
  doc.text(contact, pageW / 2, 25.5, { align: 'center' })
  doc.setDrawColor(...navy)
  doc.setLineWidth(0.8)
  doc.line(14, 28.5, pageW - 14, 28.5)
  doc.setLineWidth(0.2)
  doc.line(14, 29.6, pageW - 14, 29.6)

  return 33
}

export async function exportPdf<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  meta: ExportMeta,
  fileBase: string,
  options: { orientation?: 'portrait' | 'landscape'; totals?: (string | number)[] } = {},
) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: options.orientation ?? 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const navy: [number, number, number] = [11, 34, 64]

  drawLetterhead(doc, meta.identity)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11.5)
  doc.setTextColor(20, 20, 20)
  doc.text(meta.title, pageW / 2, 37, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  if (meta.subtitle) doc.text(meta.subtitle, pageW / 2, 42, { align: 'center', maxWidth: pageW - 30 })

  autoTable(doc, {
    startY: meta.subtitle ? 46 : 41,
    head: [['No', ...columns.map((c) => c.header)]],
    body: rows.map((r, i) => [i + 1, ...columns.map((c) => String(c.value(r) ?? ''))]),
    foot: options.totals ? [options.totals.map(String)] : undefined,
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 1.6, lineColor: [210, 218, 228], lineWidth: 0.15, overflow: 'linebreak' },
    headStyles: { fillColor: navy, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [232, 238, 247], textColor: 20, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [247, 249, 252] },
    columnStyles: { 0: { halign: 'right', cellWidth: 9 } },
    margin: { left: 14, right: 14, bottom: 16 },
    didDrawPage: () => {
      const h = doc.internal.pageSize.getHeight()
      doc.setFontSize(7.5)
      doc.setTextColor(110)
      doc.text(
        `Dicetak ${format(new Date(), 'd MMMM yyyy HH.mm', { locale: id })}${meta.generatedBy ? ` oleh ${meta.generatedBy}` : ''} — E-Arsip Perizinan`,
        14, h - 8,
      )
      doc.text(`Halaman ${doc.getCurrentPageInfo().pageNumber}`, pageW - 14, h - 8, { align: 'right' })
    },
  })
  doc.save(`${safeFileName(fileBase)}-${stamp()}.pdf`)
}
