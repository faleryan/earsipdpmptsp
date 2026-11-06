import { format } from 'date-fns'
import { id } from 'date-fns/locale'
import { drawLetterhead } from './export'
import { downloadBlob, safeFileName } from './utils'
import type { RecapColumn, RecapRow } from './recap'
import type { AppIdentity } from '@/hooks/useSettings'

export interface Signatory {
  label: string
  title: string
  name: string
  rank: string
  nip: string
}

export interface Signatories {
  city: string
  approver: Signatory
  preparer: Signatory
}

export const DEFAULT_SIGNATORIES: Signatories = {
  city: 'Atambua',
  approver: { label: 'Mengetahui,', title: 'Kepala Dinas Penanaman Modal dan Pelayanan Terpadu Satu Pintu Kabupaten Belu', name: '', rank: '', nip: '' },
  preparer: { label: '', title: 'Kepala Bidang Pelayanan Perizinan', name: '', rank: '', nip: '' },
}

export interface RecapDocMeta {
  title: string
  period: string
  subtitle?: string
  rowHeader: string
  identity: AppIdentity
  signatories: Signatories
  signDate: string // YYYY-MM-DD
  generatedBy?: string
}

export type PaperSize = 'a4' | 'f4' | 'a3'
const PAPER: Record<PaperSize, string | [number, number]> = { a4: 'a4', f4: [215, 330], a3: 'a3' }

const cellText = (c: RecapColumn, v: number) => (c.kind === 'day' && v === 0 ? '' : String(v))

export async function exportRecapPdf(rows: RecapRow[], cols: RecapColumn[], meta: RecapDocMeta, paper: PaperSize, fileBase: string) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: PAPER[paper] })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 10
  const navy: [number, number, number] = [11, 34, 64]

  let y = drawLetterhead(doc, meta.identity)
  doc.setTextColor(20, 20, 20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11.5)
  doc.text(meta.title, pageW / 2, y + 4, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.text(meta.period, pageW / 2, y + 9, { align: 'center' })
  if (meta.subtitle) doc.text(meta.subtitle, pageW / 2, y + 13.5, { align: 'center', maxWidth: pageW - 40 })
  y += meta.subtitle ? 17 : 13

  const n = cols.length
  const avail = pageW - margin * 2
  const noW = 7
  const numW = Math.min(12, Math.max(4.6, (avail - noW - 64) / n))
  const labelW = avail - noW - numW * n
  const font = numW < 6.5 ? 5.8 : numW < 8 ? 6.6 : 7.5
  const subIdx = new Set(cols.map((c, i) => (c.subtotal ? i + 2 : -1)).filter((i) => i >= 0))

  const head = [
    [
      { content: 'No', rowSpan: 2, styles: { valign: 'middle' as const, halign: 'center' as const } },
      { content: meta.rowHeader, rowSpan: 2, styles: { valign: 'middle' as const, halign: 'center' as const } },
      ...cols.map((c) => ({ content: c.top, styles: { halign: 'center' as const } })),
    ],
    cols.map((c) => ({ content: c.bottom, styles: { halign: 'center' as const } })),
  ]
  const body = rows.map((r) => {
    if (r.type === 'section') {
      return [
        { content: r.number, styles: { fontStyle: 'bold' as const, halign: 'center' as const } },
        { content: r.label, colSpan: n + 1, styles: { fontStyle: 'bold' as const } },
      ]
    }
    const bold = r.type !== 'item'
    return [
      { content: r.number, styles: { halign: 'center' as const } },
      { content: r.type === 'item' ? r.label.replace(/\s*Kab\.?\s*Belu\s*$/i, '') : r.label, styles: { fontStyle: bold ? ('bold' as const) : ('normal' as const), halign: bold ? ('center' as const) : ('left' as const) } },
      ...r.values.map((v, i) => ({ content: cellText(cols[i], v), styles: { fontStyle: bold || cols[i].subtotal ? ('bold' as const) : ('normal' as const) } })),
    ]
  })

  autoTable(doc, {
    startY: y,
    head,
    body,
    theme: 'grid',
    margin: { left: margin, right: margin, top: 14, bottom: 14 },
    styles: { fontSize: font, cellPadding: { top: 1, bottom: 1, left: 0.8, right: 0.8 }, lineColor: [120, 130, 145], lineWidth: 0.12, textColor: 20, overflow: 'linebreak', halign: 'center', valign: 'middle' },
    headStyles: { fillColor: [232, 238, 247], textColor: navy, fontStyle: 'bold', lineColor: [120, 130, 145], lineWidth: 0.12 },
    columnStyles: { 0: { cellWidth: noW }, 1: { cellWidth: labelW, halign: 'left' }, ...Object.fromEntries(cols.map((_, i) => [i + 2, { cellWidth: numW }])) },
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    didParseCell: (data) => {
      const raw = rows[data.row.index]
      if (data.section === 'body' && raw) {
        if (raw.type === 'subtotal') data.cell.styles.fillColor = [238, 242, 248]
        if (raw.type === 'total') data.cell.styles.fillColor = [214, 225, 242]
        if (raw.type === 'section') data.cell.styles.fillColor = [250, 251, 253]
      }
      if (subIdx.has(data.column.index) && (data.section === 'head' || raw?.type === 'item')) {
        data.cell.styles.fillColor = [217, 217, 217]
      }
    },
  })

  // Blok tanda tangan
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sy = ((doc as any).lastAutoTable?.finalY ?? y) + 8
  const blockW = Math.min(110, (avail - 20) / 2)
  doc.setFontSize(9.5)
  const lineH = 4.6
  const titleLines = (s: Signatory) => doc.splitTextToSize(s.title || '', blockW) as string[]
  const approverLines = titleLines(meta.signatories.approver)
  const preparerLines = titleLines(meta.signatories.preparer)
  const headerLines = Math.max(approverLines.length, preparerLines.length) + 1
  const needed = headerLines * lineH + 22 + 3 * lineH + 4
  if (sy + needed > pageH - 14) {
    doc.addPage()
    sy = 20
  }
  const leftX = margin + 12 + blockW / 2
  const rightX = pageW - margin - 12 - blockW / 2
  const signDate = format(new Date(`${meta.signDate}T00:00:00`), 'd MMMM yyyy', { locale: id })

  const drawBlock = (s: Signatory, cx: number, firstLine: string, lines: string[]) => {
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(20, 20, 20)
    let yy = sy
    doc.text(firstLine, cx, yy, { align: 'center' })
    lines.forEach((l, i) => doc.text(l, cx, sy + lineH * (i + 1), { align: 'center' }))
    yy = sy + lineH * headerLines + 22
    doc.setFont('helvetica', 'bold')
    const name = s.name.trim() || '(..................................................)'
    doc.text(name, cx, yy, { align: 'center' })
    const w = doc.getTextWidth(name)
    if (s.name.trim()) doc.line(cx - w / 2, yy + 0.8, cx + w / 2, yy + 0.8)
    doc.setFont('helvetica', 'normal')
    if (s.rank.trim()) { yy += lineH; doc.text(s.rank.trim(), cx, yy, { align: 'center' }) }
    yy += lineH
    doc.text(`NIP. ${s.nip.trim() || '..................................'}`, cx, yy, { align: 'center' })
  }
  drawBlock(meta.signatories.approver, leftX, meta.signatories.approver.label || ' ', approverLines)
  drawBlock(meta.signatories.preparer, rightX, `${meta.signatories.city || 'Atambua'}, ${signDate}`, preparerLines)

  // Nomor halaman
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(110)
    doc.text(`${meta.title} — ${meta.period}`, margin, pageH - 6)
    doc.text(`Halaman ${p} dari ${pages}`, pageW - margin, pageH - 6, { align: 'right' })
  }
  doc.save(`${safeFileName(fileBase)}.pdf`)
}

export async function exportRecapExcel(rows: RecapRow[], cols: RecapColumn[], meta: RecapDocMeta, fileBase: string) {
  const XLSX = await import('xlsx')
  const width = cols.length + 2
  const aoa: (string | number)[][] = [
    [meta.identity.agency_name.toUpperCase()],
    [meta.title],
    [meta.period],
    [meta.subtitle ?? ''],
    [],
    ['No', meta.rowHeader, ...cols.map((c) => c.top)],
    ['', '', ...cols.map((c) => c.bottom)],
  ]
  const merges = [0, 1, 2, 3].map((r) => ({ s: { r, c: 0 }, e: { r, c: width - 1 } }))
  merges.push({ s: { r: 5, c: 0 }, e: { r: 6, c: 0 } }, { s: { r: 5, c: 1 }, e: { r: 6, c: 1 } })
  rows.forEach((r) => {
    if (r.type === 'section') {
      merges.push({ s: { r: aoa.length, c: 1 }, e: { r: aoa.length, c: width - 1 } })
      aoa.push([r.number, r.label])
    } else {
      aoa.push([r.number, r.label, ...r.values.map((v, i) => (cols[i].kind === 'day' && v === 0 ? '' : v))])
    }
  })
  const s = meta.signatories
  const signDate = format(new Date(`${meta.signDate}T00:00:00`), 'd MMMM yyyy', { locale: id })
  const rightCol = Math.max(2, width - 8)
  const sig = (left: string, right: string) => { const row: string[] = Array(width).fill(''); row[1] = left; row[rightCol] = right; aoa.push(row) }
  aoa.push([])
  sig(s.approver.label, `${s.city}, ${signDate}`)
  sig(s.approver.title, s.preparer.title)
  aoa.push([], [], [])
  sig(s.approver.name || '(.............................................)', s.preparer.name || '(.............................................)')
  if (s.approver.rank || s.preparer.rank) sig(s.approver.rank, s.preparer.rank)
  sig(`NIP. ${s.approver.nip}`, `NIP. ${s.preparer.nip}`)

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!merges'] = merges
  ws['!cols'] = [{ wch: 5 }, { wch: 55 }, ...cols.map((c) => ({ wch: c.kind === 'day' ? 4.5 : c.kind === 'week' && c.subtotal ? 5 : 9 }))]
  ws['!freeze'] = { xSplit: 2, ySplit: 7 }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Rekap')
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true })
  downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeFileName(fileBase)}.xlsx`)
}
