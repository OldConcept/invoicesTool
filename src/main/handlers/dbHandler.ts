import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import initSqlJs, { Database, SqlJsStatic } from 'sql.js'

let db: Database | null = null
let SQL: SqlJsStatic | null = null

function getDbPath(): string {
  const dataDir = path.join(app.getPath('userData'), 'data')
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  return path.join(dataDir, 'invoices.sqlite')
}

function saveDb(): void {
  if (!db) return
  const dbPath = getDbPath()
  const data = db.export()
  fs.writeFileSync(dbPath, Buffer.from(data))
}

export async function initDb(): Promise<void> {
  SQL = await initSqlJs()
  const dbPath = getDbPath()

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id             TEXT PRIMARY KEY,
      file_path      TEXT NOT NULL,
      file_hash      TEXT UNIQUE,
      invoice_no     TEXT,
      date           TEXT,
      vendor         TEXT,
      vendor_tax_id  TEXT,
      amount         REAL,
      tax            REAL,
      total          REAL,
      category       TEXT DEFAULT '餐饮外卖',
      project_tag    TEXT,
      note           TEXT,
      invoice_type   TEXT,
      ocr_raw        TEXT,
      created_at     TEXT NOT NULL
    )
  `)

  // 迁移：为已存在的表添加 vendor_tax_id 列
  try {
    db.run(`ALTER TABLE invoices ADD COLUMN vendor_tax_id TEXT`)
  } catch {
    // 列已存在，忽略
  }

  // 迁移：将旧分类（餐饮/办公/通讯/其他）统一归入新分类"餐饮外卖"
  db.run(`UPDATE invoices SET category = '餐饮外卖'
          WHERE category IN ('餐饮', '办公', '通讯', '其他')`)

  // 迁移：旧"交通"中的铁路/机票类 → "城市间交通"（根据 vendor 或 invoice_type 判断）
  db.run(`UPDATE invoices SET category = '城市间交通'
          WHERE category = '交通'
            AND (invoice_type = '行程单'
              OR vendor LIKE '%铁路%'
              OR vendor LIKE '%航空%'
              OR vendor LIKE '%机场%'
              OR note LIKE '%高铁%'
              OR note LIKE '%火车%'
              OR note LIKE '%机票%')`)

  // 迁移：剩余旧"交通"（打车类）→ "打车"
  db.run(`UPDATE invoices SET category = '打车' WHERE category = '交通'`)

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id    TEXT PRIMARY KEY,
      name  TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#3B82F6'
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `)

  saveDb()
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

export { saveDb }
