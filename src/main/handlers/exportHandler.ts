import { dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import ExcelJS from 'exceljs'
import archiver from 'archiver'
import { getDb } from './dbHandler'

interface Invoice {
  id: string
  date: string | null
  vendor: string | null
  invoice_no: string | null
  invoice_type: string | null
  amount: number | null
  tax: number | null
  total: number | null
  category: string
  project_tag: string | null
  note: string | null
  file_path: string
}

interface InvoiceAttachment {
  id: string
  invoice_id: string
  file_path: string
  doc_type: string
  source_name: string | null
}

interface ReportFilter {
  startDate?: string
  endDate?: string
  projectTag?: string
  categories?: string[]
}

interface ReportSettings {
  exporterName?: string
  companyName?: string
}

function buildWhereClause(filter: ReportFilter): string {
  const conditions: string[] = []
  if (filter.startDate) conditions.push(`date >= '${filter.startDate}'`)
  if (filter.endDate) conditions.push(`date <= '${filter.endDate}'`)
  if (filter.projectTag) conditions.push(`project_tag = '${filter.projectTag}'`)
  if (filter.categories && filter.categories.length > 0) {
    const cats = filter.categories.map((c) => `'${c}'`).join(',')
    conditions.push(`category IN (${cats})`)
  }
  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
}

function getInvoices(filter: ReportFilter): Invoice[] {
  const db = getDb()
  const where = buildWhereClause(filter)
  const result = db.exec(
    `SELECT id, date, vendor, invoice_no, invoice_type, amount, tax, total,
            category, project_tag, note, file_path
     FROM invoices ${where} ORDER BY date ASC`
  )
  if (!result.length || !result[0].values.length) return []

  return result[0].values.map((row) => ({
    id: row[0] as string,
    date: row[1] as string | null,
    vendor: row[2] as string | null,
    invoice_no: row[3] as string | null,
    invoice_type: row[4] as string | null,
    amount: row[5] as number | null,
    tax: row[6] as number | null,
    total: row[7] as number | null,
    category: row[8] as string,
    project_tag: row[9] as string | null,
    note: row[10] as string | null,
    file_path: row[11] as string
  }))
}

function getAttachmentsByInvoiceIds(invoiceIds: string[]): Map<string, InvoiceAttachment[]> {
  if (!invoiceIds.length) return new Map()

  const db = getDb()
  const ids = invoiceIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',')
  const result = db.exec(
    `SELECT id, invoice_id, file_path, doc_type, source_name
     FROM invoice_attachments
     WHERE invoice_id IN (${ids})
     ORDER BY created_at ASC`
  )

  const map = new Map<string, InvoiceAttachment[]>()
  if (!result.length || !result[0].values.length) return map

  result[0].values.forEach((row) => {
    const attachment: InvoiceAttachment = {
      id: row[0] as string,
      invoice_id: row[1] as string,
      file_path: row[2] as string,
      doc_type: row[3] as string,
      source_name: row[4] as string | null
    }
    const list = map.get(attachment.invoice_id) || []
    list.push(attachment)
    map.set(attachment.invoice_id, list)
  })

  return map
}

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || '未命名'
}

function buildExportFolderName(inv: Invoice, index: number): string {
  const prefix = String(index + 1).padStart(3, '0')
  const date = sanitizeFileName(inv.date || 'nodate')
  const vendor = sanitizeFileName(inv.vendor || 'unknown')
  const total = `${(inv.total || 0).toFixed(0)}元`
  return `${prefix}_${date}_${vendor}_${total}`
}

export async function exportReport(
  filter: ReportFilter,
  settings: ReportSettings
): Promise<{ success: boolean; path?: string; error?: string }> {
  const savePath = dialog.showSaveDialogSync({
    defaultPath: `报销单_${new Date().toISOString().slice(0, 10)}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  })
  if (!savePath) return { success: false, error: '已取消' }

  try {
    const invoices = getInvoices(filter)
    const wb = new ExcelJS.Workbook()

    // Sheet 1: Detail
    const detailSheet = wb.addWorksheet('明细')
    detailSheet.columns = [
      { header: '序号', key: 'idx', width: 6 },
      { header: '日期', key: 'date', width: 14 },
      { header: '商家/供应商', key: 'vendor', width: 24 },
      { header: '发票号码', key: 'invoice_no', width: 20 },
      { header: '发票类型', key: 'invoice_type', width: 18 },
      { header: '税前金额', key: 'amount', width: 12 },
      { header: '税额', key: 'tax', width: 10 },
      { header: '合计金额', key: 'total', width: 12 },
      { header: '费用分类', key: 'category', width: 12 },
      { header: '项目', key: 'project_tag', width: 16 },
      { header: '备注', key: 'note', width: 20 }
    ]

    // Header styling
    const headerRow = detailSheet.getRow(1)
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } }
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.alignment = { horizontal: 'center' }
    })

    invoices.forEach((inv, i) => {
      detailSheet.addRow({
        idx: i + 1,
        date: inv.date || '',
        vendor: inv.vendor || '',
        invoice_no: inv.invoice_no || '',
        invoice_type: inv.invoice_type || '',
        amount: inv.amount ?? '',
        tax: inv.tax ?? '',
        total: inv.total ?? '',
        category: inv.category,
        project_tag: inv.project_tag || '',
        note: inv.note || ''
      })
    })

    // Total row
    const totalRow = detailSheet.addRow({
      idx: '',
      date: '',
      vendor: '合计',
      invoice_no: '',
      invoice_type: '',
      amount: invoices.reduce((s, i) => s + (i.amount || 0), 0),
      tax: invoices.reduce((s, i) => s + (i.tax || 0), 0),
      total: invoices.reduce((s, i) => s + (i.total || 0), 0),
      category: '',
      project_tag: '',
      note: ''
    })
    totalRow.eachCell((cell) => {
      cell.font = { bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }
    })

    // Sheet 2: Category summary
    const summarySheet = wb.addWorksheet('分类汇总')
    summarySheet.columns = [
      { header: '费用分类', key: 'category', width: 16 },
      { header: '笔数', key: 'count', width: 8 },
      { header: '合计金额', key: 'total', width: 14 }
    ]

    const summaryHeader = summarySheet.getRow(1)
    summaryHeader.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } }
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.alignment = { horizontal: 'center' }
    })

    const categoryMap = new Map<string, { count: number; total: number }>()
    for (const inv of invoices) {
      const existing = categoryMap.get(inv.category) || { count: 0, total: 0 }
      categoryMap.set(inv.category, {
        count: existing.count + 1,
        total: existing.total + (inv.total || 0)
      })
    }

    for (const [category, stats] of categoryMap) {
      summarySheet.addRow({ category, count: stats.count, total: stats.total })
    }

    summarySheet.addRow({
      category: '合计',
      count: invoices.length,
      total: invoices.reduce((s, i) => s + (i.total || 0), 0)
    }).eachCell((cell) => {
      cell.font = { bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }
    })

    // Cover info
    if (settings.exporterName || settings.companyName) {
      const coverSheet = wb.addWorksheet('封面', {})
      coverSheet.addRow([settings.companyName || ''])
      coverSheet.addRow(['报销申请单'])
      coverSheet.addRow([`报销人：${settings.exporterName || ''}`])
      coverSheet.addRow([`报销日期：${new Date().toLocaleDateString('zh-CN')}`])
      coverSheet.addRow([`合计金额：¥${invoices.reduce((s, i) => s + (i.total || 0), 0).toFixed(2)}`])
    }

    await wb.xlsx.writeFile(savePath)
    return { success: true, path: savePath }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function exportZip(
  filter: ReportFilter,
  settings: ReportSettings
): Promise<{ success: boolean; path?: string; error?: string }> {
  const savePath = dialog.showSaveDialogSync({
    defaultPath: `报销包_${new Date().toISOString().slice(0, 10)}.zip`,
    filters: [{ name: 'ZIP', extensions: ['zip'] }]
  })
  if (!savePath) return { success: false, error: '已取消' }

  try {
    const invoices = getInvoices(filter)
    const attachmentsByInvoice = getAttachmentsByInvoiceIds(invoices.map((inv) => inv.id))

    // First create the Excel report in a temp file
    const tempDir = require('os').tmpdir()
    const tempExcel = path.join(tempDir, `report_${Date.now()}.xlsx`)

    const wb = new ExcelJS.Workbook()
    const sheet = wb.addWorksheet('明细')
    sheet.columns = [
      { header: '序号', key: 'idx', width: 6 },
      { header: '日期', key: 'date', width: 14 },
      { header: '商家', key: 'vendor', width: 24 },
      { header: '合计金额', key: 'total', width: 12 },
      { header: '费用分类', key: 'category', width: 12 }
    ]
    invoices.forEach((inv, i) => {
      sheet.addRow({ idx: i + 1, date: inv.date, vendor: inv.vendor, total: inv.total, category: inv.category })
    })
    await wb.xlsx.writeFile(tempExcel)

    // Create ZIP
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(savePath)
      const archive = archiver('zip', { zlib: { level: 9 } })

      output.on('close', resolve)
      archive.on('error', reject)
      archive.pipe(output)

      // Add Excel
      archive.file(tempExcel, { name: '报销汇总.xlsx' })

      // Add PDFs grouped by category
      invoices.forEach((inv, index) => {
        if (!fs.existsSync(inv.file_path)) return
        const cat = sanitizeFileName(inv.category)
        const folderName = buildExportFolderName(inv, index)
        const baseDir = `发票/${cat}/${folderName}`
        archive.file(inv.file_path, { name: `${baseDir}/发票.pdf` })

        const attachments = attachmentsByInvoice.get(inv.id) || []
        attachments.forEach((attachment, attachmentIndex) => {
          if (!fs.existsSync(attachment.file_path)) return
          const sourceStem = attachment.source_name
            ? sanitizeFileName(path.basename(attachment.source_name, path.extname(attachment.source_name)))
            : `附件_${attachmentIndex + 1}`
          archive.file(attachment.file_path, {
            name: `${baseDir}/行程单_${attachmentIndex + 1}_${sourceStem}.pdf`
          })
        })
      })

      archive.finalize()
    })

    fs.unlinkSync(tempExcel)
    return { success: true, path: savePath }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
