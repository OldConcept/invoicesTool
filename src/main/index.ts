import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import { initDb, getDb, saveDb } from './handlers/dbHandler'
import { importPdfs, importFolder, getPdfBase64, deletePdfFiles, ImportedItem } from './handlers/fileHandler'
import { runOcr, scanFolder, setPythonPath, stopOcrProcess, cancelScanProcess } from './handlers/ocrHandler'
import { exportReport, exportZip } from './handlers/exportHandler'
import { v4 as uuidv4 } from 'uuid'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  await initDb()
  createWindow()
  registerIpcHandlers()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopOcrProcess()
  cancelScanProcess()
  if (process.platform !== 'darwin') app.quit()
})

function toNullableString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s : null
}

function toNullableNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

type ImportProgressPayload = {
  phase: 'import' | 'ocr' | 'done'
  done: number
  total: number
  imported: number
  skipped: number
  ocrProcessed: number
  ocrFailed: number
}

async function autoOcrImportedItems(
  items: ImportedItem[],
  pythonPath: string,
  onProgress?: (progress: { done: number; total: number; ocrProcessed: number; ocrFailed: number }) => void
): Promise<{ ocrProcessed: number; ocrFailed: number }> {
  if (!items.length) return { ocrProcessed: 0, ocrFailed: 0 }

  setPythonPath(pythonPath)
  const db = getDb()
  let ocrProcessed = 0
  let ocrFailed = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const result = await runOcr(item.filePath)
    if (!result.success || !result.data) {
      ocrFailed++
      onProgress?.({ done: i + 1, total: items.length, ocrProcessed, ocrFailed })
      // Python 环境不可用时不重复尝试后续文件，避免导入等待过久
      if (result.error?.includes('无法启动 Python')) {
        ocrFailed += items.length - i - 1
        onProgress?.({ done: items.length, total: items.length, ocrProcessed, ocrFailed })
        break
      }
      continue
    }

    const data = result.data
    const category = toNullableString(data.category) || '餐饮外卖'
    const ocrRaw = JSON.stringify(data)

    db.run(
      `UPDATE invoices
       SET invoice_no = ?,
           date = ?,
           vendor = ?,
           vendor_tax_id = ?,
           amount = ?,
           tax = ?,
           total = ?,
           category = ?,
           invoice_type = ?,
           ocr_raw = ?
       WHERE id = ?`,
      [
        toNullableString(data.invoice_no),
        toNullableString(data.date),
        toNullableString(data.vendor),
        toNullableString(data.vendor_tax_id),
        toNullableNumber(data.amount),
        toNullableNumber(data.tax),
        toNullableNumber(data.total),
        category,
        toNullableString(data.invoice_type),
        ocrRaw,
        item.id
      ]
    )
    ocrProcessed++
    onProgress?.({ done: i + 1, total: items.length, ocrProcessed, ocrFailed })
  }

  if (ocrProcessed > 0) saveDb()
  return { ocrProcessed, ocrFailed }
}

function registerIpcHandlers(): void {
  // File operations
  ipcMain.handle('select-pdf-files', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    return result.filePaths
  })

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.filePaths[0] || null
  })

  ipcMain.handle('import-pdfs', async (event, paths: string[]) => {
    let importSnapshot = { done: 0, total: 0, imported: 0, skipped: 0 }
    const emit = (payload: ImportProgressPayload): void => {
      event.sender.send('import-progress', payload)
    }

    const result = importPdfs(paths, (p) => {
      importSnapshot = p
      emit({
        phase: 'import',
        done: p.done,
        total: p.total,
        imported: p.imported,
        skipped: p.skipped,
        ocrProcessed: 0,
        ocrFailed: 0
      })
    })
    const db = getDb()
    const settingResult = db.exec("SELECT value FROM settings WHERE key = 'pythonPath'")
    const pythonPath =
      settingResult.length && settingResult[0].values.length
        ? (settingResult[0].values[0][0] as string)
        : 'python3'
    const ocr = await autoOcrImportedItems(result.importedItems, pythonPath, (p) => {
      emit({
        phase: 'ocr',
        done: p.done,
        total: p.total,
        imported: result.imported,
        skipped: result.skipped,
        ocrProcessed: p.ocrProcessed,
        ocrFailed: p.ocrFailed
      })
    })
    emit({
      phase: 'done',
      done: importSnapshot.total || result.imported + result.skipped,
      total: importSnapshot.total || result.imported + result.skipped,
      imported: result.imported,
      skipped: result.skipped,
      ocrProcessed: ocr.ocrProcessed,
      ocrFailed: ocr.ocrFailed
    })
    return { success: true, imported: result.imported, skipped: result.skipped, ...ocr }
  })

  ipcMain.handle('import-folder', async (event, folderPath: string) => {
    let importSnapshot = { done: 0, total: 0, imported: 0, skipped: 0 }
    const emit = (payload: ImportProgressPayload): void => {
      event.sender.send('import-progress', payload)
    }

    const result = importFolder(folderPath, (p) => {
      importSnapshot = p
      emit({
        phase: 'import',
        done: p.done,
        total: p.total,
        imported: p.imported,
        skipped: p.skipped,
        ocrProcessed: 0,
        ocrFailed: 0
      })
    })
    const db = getDb()
    const settingResult = db.exec("SELECT value FROM settings WHERE key = 'pythonPath'")
    const pythonPath =
      settingResult.length && settingResult[0].values.length
        ? (settingResult[0].values[0][0] as string)
        : 'python3'
    const ocr = await autoOcrImportedItems(result.importedItems, pythonPath, (p) => {
      emit({
        phase: 'ocr',
        done: p.done,
        total: p.total,
        imported: result.imported,
        skipped: result.skipped,
        ocrProcessed: p.ocrProcessed,
        ocrFailed: p.ocrFailed
      })
    })
    emit({
      phase: 'done',
      done: importSnapshot.total || result.imported + result.skipped,
      total: importSnapshot.total || result.imported + result.skipped,
      imported: result.imported,
      skipped: result.skipped,
      ocrProcessed: ocr.ocrProcessed,
      ocrFailed: ocr.ocrFailed
    })
    return { success: true, imported: result.imported, skipped: result.skipped, ...ocr }
  })

  ipcMain.handle('get-pdf-data', (_event, filePath: string) => {
    return getPdfBase64(filePath)
  })

  // Invoice CRUD
  ipcMain.handle(
    'get-invoices',
    (
      _event,
      filter?: {
        search?: string
        category?: string
        projectTag?: string
        startDate?: string
        endDate?: string
      }
    ) => {
      const db = getDb()
      const conditions: string[] = []
      if (filter?.search) {
        const s = filter.search.replace(/'/g, "''")
        conditions.push(`(vendor LIKE '%${s}%' OR note LIKE '%${s}%' OR invoice_no LIKE '%${s}%')`)
      }
      if (filter?.category) conditions.push(`category = '${filter.category}'`)
      if (filter?.projectTag) conditions.push(`project_tag = '${filter.projectTag}'`)
      if (filter?.startDate) conditions.push(`date >= '${filter.startDate}'`)
      if (filter?.endDate) conditions.push(`date <= '${filter.endDate}'`)

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const result = db.exec(
        `SELECT id, file_path, file_hash, invoice_no, date, vendor, vendor_tax_id,
                amount, tax, total, category, project_tag, note, invoice_type, ocr_raw, created_at
         FROM invoices ${where} ORDER BY date DESC, created_at DESC`
      )

      if (!result.length || !result[0].values.length) return []

      return result[0].values.map((row) => ({
        id: row[0],
        filePath: row[1],
        fileHash: row[2],
        invoiceNo: row[3],
        date: row[4],
        vendor: row[5],
        vendorTaxId: row[6],
        amount: row[7],
        tax: row[8],
        total: row[9],
        category: row[10],
        projectTag: row[11],
        note: row[12],
        invoiceType: row[13],
        ocrRaw: row[14],
        createdAt: row[15]
      }))
    }
  )

  ipcMain.handle('get-invoice', (_event, id: string) => {
    const db = getDb()
    const result = db.exec(
      `SELECT id, file_path, file_hash, invoice_no, date, vendor, vendor_tax_id,
              amount, tax, total, category, project_tag, note, invoice_type, ocr_raw, created_at
       FROM invoices WHERE id = '${id}'`
    )
    if (!result.length || !result[0].values.length) return null
    const row = result[0].values[0]
    return {
      id: row[0], filePath: row[1], fileHash: row[2], invoiceNo: row[3],
      date: row[4], vendor: row[5], vendorTaxId: row[6],
      amount: row[7], tax: row[8], total: row[9],
      category: row[10], projectTag: row[11], note: row[12], invoiceType: row[13],
      ocrRaw: row[14], createdAt: row[15]
    }
  })

  ipcMain.handle('update-invoice', (_event, id: string, data: Record<string, unknown>) => {
    const db = getDb()
    const fieldMap: Record<string, string> = {
      invoiceNo: 'invoice_no', date: 'date', vendor: 'vendor', vendorTaxId: 'vendor_tax_id',
      amount: 'amount', tax: 'tax', total: 'total', category: 'category',
      projectTag: 'project_tag', note: 'note', invoiceType: 'invoice_type', ocrRaw: 'ocr_raw'
    }

    const sets = Object.entries(data)
      .filter(([key]) => fieldMap[key])
      .map(([key, val]) => {
        const col = fieldMap[key]
        if (val === null) return `${col} = NULL`
        if (typeof val === 'number') return `${col} = ${val}`
        return `${col} = '${String(val).replace(/'/g, "''")}'`
      })
      .join(', ')

    if (sets) {
      db.run(`UPDATE invoices SET ${sets} WHERE id = '${id}'`)
      saveDb()
    }
    return { success: true }
  })

  ipcMain.handle('delete-invoices', (_event, ids: string[]) => {
    deletePdfFiles(ids)
    return { success: true }
  })

  ipcMain.handle('scan-folder', async (_event, folderPath: string, mode?: 'fast' | 'balanced' | 'accurate') => {
    const db = getDb()
    const result = db.exec("SELECT value FROM settings WHERE key = 'pythonPath'")
    const pythonPath =
      result.length && result[0].values.length ? (result[0].values[0][0] as string) : 'python3'
    return scanFolder(folderPath, pythonPath, mode || 'fast')
  })
  ipcMain.handle('cancel-scan', () => {
    cancelScanProcess()
    return { success: true }
  })

  // OCR
  ipcMain.handle('run-ocr', async (_event, filePath: string) => {
    const db = getDb()
    const result = db.exec("SELECT value FROM settings WHERE key = 'pythonPath'")
    const pythonPath =
      result.length && result[0].values.length ? (result[0].values[0][0] as string) : 'python3'
    return runOcr(filePath, pythonPath)
  })

  // Projects
  ipcMain.handle('get-projects', () => {
    const db = getDb()
    const result = db.exec('SELECT id, name, color FROM projects ORDER BY name')
    if (!result.length || !result[0].values.length) return []
    return result[0].values.map((row) => ({ id: row[0], name: row[1], color: row[2] }))
  })

  ipcMain.handle('create-project', (_event, name: string, color: string) => {
    const db = getDb()
    const id = uuidv4()
    db.run(`INSERT OR IGNORE INTO projects (id, name, color) VALUES ('${id}', '${name.replace(/'/g, "''")}', '${color}')`)
    saveDb()
    return { success: true, id }
  })

  ipcMain.handle('delete-project', (_event, id: string) => {
    const db = getDb()
    db.run(`DELETE FROM projects WHERE id = '${id}'`)
    saveDb()
    return { success: true }
  })

  // Export
  ipcMain.handle('export-report', async (_event, filter, settings) => {
    return exportReport(filter, settings)
  })

  ipcMain.handle('export-zip', async (_event, filter, settings) => {
    return exportZip(filter, settings)
  })

  // Settings
  ipcMain.handle('get-settings', () => {
    const db = getDb()
    const result = db.exec('SELECT key, value FROM settings')
    if (!result.length || !result[0].values.length) return {}
    const settings: Record<string, string> = {}
    result[0].values.forEach((row) => {
      settings[row[0] as string] = row[1] as string
    })
    return settings
  })

  ipcMain.handle('save-settings', (_event, settings: Record<string, string>) => {
    const db = getDb()
    for (const [key, value] of Object.entries(settings)) {
      db.run(
        `INSERT OR REPLACE INTO settings (key, value) VALUES ('${key}', '${String(value).replace(/'/g, "''")}')`
      )
    }
    saveDb()
    if (settings.pythonPath !== undefined) {
      setPythonPath(settings.pythonPath)
    }
    return { success: true }
  })

  // Shell
  ipcMain.handle('open-external', (_event, url: string) => shell.openExternal(url))
  ipcMain.handle('show-item-in-folder', (_event, filePath: string) =>
    shell.showItemInFolder(filePath)
  )
}
