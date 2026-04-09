import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { getDb, saveDb } from './dbHandler'

export interface ImportedItem {
  id: string
  filePath: string
}

export interface InvoiceAttachmentItem {
  id: string
  invoiceId: string
  filePath: string
  docType: 'trip_itinerary'
  sourceName: string | null
  createdAt: string
}

export interface ImportResult {
  imported: number
  skipped: number
  importedItems: ImportedItem[]
}

export interface ImportStageProgress {
  done: number
  total: number
  imported: number
  skipped: number
}

function getInvoiceDir(): string {
  const dir = path.join(app.getPath('userData'), 'invoices')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getAttachmentDir(): string {
  const dir = path.join(app.getPath('userData'), 'attachments')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function hashFile(filePath: string): string {
  const buffer = fs.readFileSync(filePath)
  return crypto.createHash('md5').update(buffer).digest('hex')
}

function isPdf(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.pdf'
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''")
}

export function importPdfs(
  srcPaths: string[],
  onProgress?: (progress: ImportStageProgress) => void
): ImportResult {
  const db = getDb()
  const invoiceDir = getInvoiceDir()
  let imported = 0
  let skipped = 0
  const importedItems: ImportedItem[] = []
  let done = 0
  const total = srcPaths.filter((p) => isPdf(p)).length

  for (const srcPath of srcPaths) {
    if (!isPdf(srcPath)) continue
    done++
    try {
      const hash = hashFile(srcPath)

      // Check for duplicate
      const existing = db.exec(`SELECT id FROM invoices WHERE file_hash = '${hash}'`)
      if (existing.length > 0 && existing[0].values.length > 0) {
        skipped++
        onProgress?.({ done, total, imported, skipped })
        continue
      }

      const id = uuidv4()
      const fileName = `${id}.pdf`
      const destPath = path.join(invoiceDir, fileName)
      fs.copyFileSync(srcPath, destPath)

      const originalName = path.basename(srcPath, '.pdf')
      const now = new Date().toISOString()

      db.run(
        `INSERT INTO invoices (id, file_path, file_hash, vendor, category, created_at)
         VALUES (?, ?, ?, ?, '餐饮外卖', ?)`,
        [id, destPath, hash, originalName, now]
      )

      imported++
      importedItems.push({ id, filePath: destPath })
    } catch (err) {
      console.error('Failed to import', srcPath, err)
      skipped++
    }
    onProgress?.({ done, total, imported, skipped })
  }

  saveDb()
  return { imported, skipped, importedItems }
}

export function importFolder(
  folderPath: string,
  onProgress?: (progress: ImportStageProgress) => void
): ImportResult {
  const files = fs.readdirSync(folderPath)
  const pdfPaths = files
    .filter((f) => isPdf(f))
    .map((f) => path.join(folderPath, f))
  return importPdfs(pdfPaths, onProgress)
}

export function getPdfBase64(filePath: string): string {
  const buffer = fs.readFileSync(filePath)
  return buffer.toString('base64')
}

export function importInvoiceAttachments(
  invoiceId: string,
  srcPaths: string[]
): { imported: number; skipped: number; attachments: InvoiceAttachmentItem[] } {
  const db = getDb()
  const safeInvoiceId = escapeSql(invoiceId)
  const invoiceExists = db.exec(`SELECT id FROM invoices WHERE id = '${safeInvoiceId}'`)
  if (!invoiceExists.length || !invoiceExists[0].values.length) {
    throw new Error('关联发票不存在')
  }

  const attachmentDir = getAttachmentDir()
  let imported = 0
  let skipped = 0
  const attachments: InvoiceAttachmentItem[] = []

  for (const srcPath of srcPaths) {
    if (!isPdf(srcPath)) continue
    try {
      const hash = hashFile(srcPath)
      const duplicate = db.exec(
        `SELECT id FROM invoices WHERE file_hash = '${hash}'
         UNION
         SELECT id FROM invoice_attachments WHERE file_hash = '${hash}'`
      )
      if (duplicate.length > 0 && duplicate[0].values.length > 0) {
        skipped++
        continue
      }

      const id = uuidv4()
      const destPath = path.join(attachmentDir, `${id}.pdf`)
      const sourceName = path.basename(srcPath)
      const createdAt = new Date().toISOString()

      fs.copyFileSync(srcPath, destPath)
      db.run(
        `INSERT INTO invoice_attachments (id, invoice_id, file_path, file_hash, doc_type, source_name, created_at)
         VALUES (?, ?, ?, ?, 'trip_itinerary', ?, ?)`,
        [id, invoiceId, destPath, hash, sourceName, createdAt]
      )

      imported++
      attachments.push({
        id,
        invoiceId,
        filePath: destPath,
        docType: 'trip_itinerary',
        sourceName,
        createdAt
      })
    } catch (err) {
      console.error('Failed to import attachment', srcPath, err)
      skipped++
    }
  }

  saveDb()
  return { imported, skipped, attachments }
}

export function getInvoiceAttachments(invoiceId: string): InvoiceAttachmentItem[] {
  const db = getDb()
  const safeInvoiceId = escapeSql(invoiceId)
  const result = db.exec(
    `SELECT id, invoice_id, file_path, doc_type, source_name, created_at
     FROM invoice_attachments
     WHERE invoice_id = '${safeInvoiceId}'
     ORDER BY created_at ASC`
  )

  if (!result.length || !result[0].values.length) return []

  return result[0].values.map((row) => ({
    id: row[0] as string,
    invoiceId: row[1] as string,
    filePath: row[2] as string,
    docType: row[3] as 'trip_itinerary',
    sourceName: row[4] as string | null,
    createdAt: row[5] as string
  }))
}

export function deleteInvoiceAttachment(id: string): void {
  const db = getDb()
  const safeId = escapeSql(id)
  const result = db.exec(`SELECT file_path FROM invoice_attachments WHERE id = '${safeId}'`)

  if (result.length > 0 && result[0].values.length > 0) {
    const filePath = result[0].values[0][0] as string
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }

  db.run(`DELETE FROM invoice_attachments WHERE id = '${safeId}'`)
  saveDb()
}

export function deletePdfFiles(ids: string[]): void {
  const db = getDb()

  for (const id of ids) {
    const safeId = escapeSql(id)
    const result = db.exec(`SELECT file_path FROM invoices WHERE id = '${safeId}'`)
    if (result.length > 0 && result[0].values.length > 0) {
      const filePath = result[0].values[0][0] as string
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    }

    const attachments = db.exec(
      `SELECT file_path FROM invoice_attachments WHERE invoice_id = '${safeId}'`
    )
    if (attachments.length > 0 && attachments[0].values.length > 0) {
      for (const row of attachments[0].values) {
        const filePath = row[0] as string
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
      }
    }

    db.run(`DELETE FROM invoice_attachments WHERE invoice_id = '${safeId}'`)
    db.run(`DELETE FROM invoices WHERE id = '${safeId}'`)
  }

  saveDb()
}
