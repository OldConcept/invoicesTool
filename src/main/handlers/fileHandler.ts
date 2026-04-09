import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { getDb, saveDb } from './dbHandler'

function getInvoiceDir(): string {
  const dir = path.join(app.getPath('userData'), 'invoices')
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

export function importPdfs(srcPaths: string[]): { imported: number; skipped: number } {
  const db = getDb()
  const invoiceDir = getInvoiceDir()
  let imported = 0
  let skipped = 0

  for (const srcPath of srcPaths) {
    if (!isPdf(srcPath)) continue
    try {
      const hash = hashFile(srcPath)

      // Check for duplicate
      const existing = db.exec(`SELECT id FROM invoices WHERE file_hash = '${hash}'`)
      if (existing.length > 0 && existing[0].values.length > 0) {
        skipped++
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
    } catch (err) {
      console.error('Failed to import', srcPath, err)
    }
  }

  saveDb()
  return { imported, skipped }
}

export function importFolder(folderPath: string): { imported: number; skipped: number } {
  const files = fs.readdirSync(folderPath)
  const pdfPaths = files
    .filter((f) => isPdf(f))
    .map((f) => path.join(folderPath, f))
  return importPdfs(pdfPaths)
}

export function getPdfBase64(filePath: string): string {
  const buffer = fs.readFileSync(filePath)
  return buffer.toString('base64')
}

export function deletePdfFiles(ids: string[]): void {
  const db = getDb()

  for (const id of ids) {
    const result = db.exec(`SELECT file_path FROM invoices WHERE id = '${id}'`)
    if (result.length > 0 && result[0].values.length > 0) {
      const filePath = result[0].values[0][0] as string
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    }
    db.run(`DELETE FROM invoices WHERE id = '${id}'`)
  }

  saveDb()
}
