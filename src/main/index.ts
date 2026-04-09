import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import { initDb, getDb, saveDb } from './handlers/dbHandler'
import {
  importPdfs,
  importFolder,
  importInvoiceAttachments,
  getInvoiceAttachments,
  deleteInvoiceAttachment,
  getPdfBase64,
  deletePdfFiles,
  ImportedItem
} from './handlers/fileHandler'
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
  phase: 'import' | 'ocr' | 'attachment' | 'done'
  done: number
  total: number
  imported: number
  skipped: number
  ocrProcessed: number
  ocrFailed: number
}

type BatchImportResult = {
  success: boolean
  imported: number
  skipped: number
  ocrProcessed: number
  ocrFailed: number
  attachmentImported: number
  attachmentSkipped: number
  attachmentUnmatched: number
  attachmentFailed: number
  unmatchedDetails: UnmatchedTripItineraryDetail[]
}

type SuggestedTaxiInvoice = {
  invoiceId: string
  vendor: string | null
  date: string | null
  total: number | null
  score: number
}

type UnmatchedTripItineraryDetail = {
  filePath: string
  detectedAmount: number | null
  detectedDate: string | null
  detectedVendor: string | null
  reason: string
  suggestions: SuggestedTaxiInvoice[]
}

type TaxiInvoiceCandidate = {
  id: string
  date: string | null
  amount: number | null
  total: number | null
  vendor: string | null
  category: string | null
  invoiceType: string | null
  preferred: boolean
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

function normalizeVendorToken(value: string | null): string {
  if (!value) return ''
  return value
    .replace(/\s+/g, '')
    .replace(/[()（）【】\-_.,，。]/g, '')
    .toLowerCase()
}

function detectRideProvider(value: string | null): string | null {
  const normalized = normalizeVendorToken(value)
  if (!normalized) return null

  const providers = ['滴滴', '美团', '高德', '曹操', '首汽', '嘀嗒', 't3']
  return providers.find((provider) => normalized.includes(provider.toLowerCase())) || null
}

function normalizeDateString(value: string): string | null {
  const compactMatch = value.match(/\b(20\d{2})(\d{2})(\d{2})\b/)
  if (compactMatch) {
    return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`
  }

  const match = value.match(/(20\d{2})[年\-/\.](\d{1,2})[月\-/\.](\d{1,2})/)
  if (!match) return null
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function collectDateCandidates(data: Record<string, unknown>): string[] {
  const dates = new Set<string>()
  const explicitDate = toNullableString(data.date)
  if (explicitDate) {
    const normalized = normalizeDateString(explicitDate)
    if (normalized) dates.add(normalized)
  }

  if (Array.isArray(data._ocr_lines)) {
    data._ocr_lines
      .filter((line): line is string => typeof line === 'string')
      .forEach((line) => {
        const normalized = normalizeDateString(line)
        if (normalized) dates.add(normalized)
      })
  }

  return [...dates]
}

function dateDistanceDays(a: string, b: string): number {
  const tsA = Date.parse(`${a}T00:00:00Z`)
  const tsB = Date.parse(`${b}T00:00:00Z`)
  if (Number.isNaN(tsA) || Number.isNaN(tsB)) return Number.POSITIVE_INFINITY
  return Math.abs(Math.round((tsA - tsB) / 86400000))
}

function loadTaxiInvoiceCandidates(preferredIds: Set<string>): TaxiInvoiceCandidate[] {
  const db = getDb()
  const result = db.exec(
    `SELECT id, date, amount, total, vendor, category, invoice_type
     FROM invoices
     WHERE (total IS NOT NULL OR amount IS NOT NULL)
       AND (
         category = '打车'
         OR invoice_type = '出租车票'
         OR vendor LIKE '%滴滴%'
         OR vendor LIKE '%美团%'
         OR vendor LIKE '%高德%'
         OR vendor LIKE '%曹操%'
         OR vendor LIKE '%T3%'
         OR vendor LIKE '%首汽%'
         OR vendor LIKE '%嘀嗒%'
       )
     ORDER BY created_at DESC`
  )

  if (!result.length || !result[0].values.length) return []

  return result[0].values.map((row) => ({
    id: row[0] as string,
    date: row[1] as string | null,
    amount: row[2] as number | null,
    total: row[3] as number | null,
    vendor: row[4] as string | null,
    category: row[5] as string | null,
    invoiceType: row[6] as string | null,
    preferred: preferredIds.has(row[0] as string)
  }))
}

function scoreTripItineraryCandidates(
  data: Record<string, unknown>,
  candidates: TaxiInvoiceCandidate[]
): Array<{ candidate: TaxiInvoiceCandidate; score: number; minDiff: number }> {
  const itineraryMoney = toNullableNumber(data.total) ?? toNullableNumber(data.amount)
  if (itineraryMoney == null) return []

  const dateCandidates = collectDateCandidates(data)
  const vendor = toNullableString(data.vendor)
  const ocrLines = Array.isArray(data._ocr_lines)
    ? data._ocr_lines.filter((line): line is string => typeof line === 'string').join(' ')
    : ''
  const providerHint = detectRideProvider(vendor) || detectRideProvider(ocrLines)

  return candidates
    .map((candidate) => {
      const monies = [candidate.total, candidate.amount].filter(
        (value): value is number => typeof value === 'number' && Number.isFinite(value)
      )
      if (!monies.length) return null

      const minDiff = Math.min(...monies.map((value) => Math.abs(value - itineraryMoney)))
      if (minDiff > 0.1) return null

      let score = 0
      if (minDiff <= 0.01) score += 100
      else if (minDiff <= 0.05) score += 70
      else score += 40

      if (candidate.preferred) score += 45
      if (candidate.category === '打车') score += 8
      if (candidate.invoiceType === '出租车票') score += 6

      if (providerHint) {
        const candidateProvider = detectRideProvider(candidate.vendor)
        if (candidateProvider === providerHint) score += 18
      }

      if (candidate.date && dateCandidates.length > 0) {
        const minDateDistance = Math.min(
          ...dateCandidates.map((date) => dateDistanceDays(candidate.date as string, date))
        )
        if (minDateDistance === 0) score += 30
        else if (minDateDistance === 1) score += 18
        else if (minDateDistance <= 3) score += 8
      }

      return { candidate, score, minDiff }
    })
    .filter((item): item is { candidate: TaxiInvoiceCandidate; score: number; minDiff: number } => item !== null)
    .sort((a, b) => b.score - a.score || a.minDiff - b.minDiff)
}

function matchTripItineraryInvoice(
  data: Record<string, unknown>,
  candidates: TaxiInvoiceCandidate[]
): string | null {
  const scoredMatches = scoreTripItineraryCandidates(data, candidates)
  if (!scoredMatches.length) return null

  const exactMoneyMatches = scoredMatches.filter((item) => item.minDiff <= 0.01)
  if (exactMoneyMatches.length === 1) {
    return exactMoneyMatches[0].candidate.id
  }

  const best = scoredMatches[0]
  const second = scoredMatches[1]
  if (!second) {
    return best.candidate.id
  }

  if (best.score - second.score >= 20) {
    return best.candidate.id
  }

  return null
}

async function autoImportTripItineraries(
  paths: string[],
  pythonPath: string,
  preferredInvoiceIds: Set<string>,
  onProgress?: (progress: {
    done: number
    total: number
    attachmentImported: number
    attachmentSkipped: number
    attachmentUnmatched: number
    attachmentFailed: number
  }) => void
): Promise<{
  attachmentImported: number
  attachmentSkipped: number
  attachmentUnmatched: number
  attachmentFailed: number
  unmatchedDetails: UnmatchedTripItineraryDetail[]
}> {
  if (!paths.length) {
    return {
      attachmentImported: 0,
      attachmentSkipped: 0,
      attachmentUnmatched: 0,
      attachmentFailed: 0,
      unmatchedDetails: []
    }
  }

  setPythonPath(pythonPath)
  let attachmentImported = 0
  let attachmentSkipped = 0
  let attachmentUnmatched = 0
  let attachmentFailed = 0
  const unmatchedDetails: UnmatchedTripItineraryDetail[] = []

  for (let i = 0; i < paths.length; i++) {
    const filePath = paths[i]
    try {
      const result = await runOcr(filePath)
      if (!result.success || !result.data) {
        attachmentFailed++
        onProgress?.({
          done: i + 1,
          total: paths.length,
          attachmentImported,
          attachmentSkipped,
          attachmentUnmatched,
          attachmentFailed
        })
        continue
      }

      const candidates = loadTaxiInvoiceCandidates(preferredInvoiceIds)
      const matchedInvoiceId = matchTripItineraryInvoice(
        result.data,
        candidates
      )
      if (!matchedInvoiceId) {
        attachmentUnmatched++
        const scoredMatches = scoreTripItineraryCandidates(result.data, candidates).slice(0, 3)
        unmatchedDetails.push({
          filePath,
          detectedAmount: toNullableNumber(result.data.total) ?? toNullableNumber(result.data.amount),
          detectedDate: collectDateCandidates(result.data)[0] || null,
          detectedVendor: toNullableString(result.data.vendor),
          reason: scoredMatches.length ? '存在多个接近候选，未自动绑定' : '未找到可匹配的打车发票',
          suggestions: scoredMatches.map((item) => ({
            invoiceId: item.candidate.id,
            vendor: item.candidate.vendor,
            date: item.candidate.date,
            total: item.candidate.total ?? item.candidate.amount,
            score: item.score
          }))
        })
        onProgress?.({
          done: i + 1,
          total: paths.length,
          attachmentImported,
          attachmentSkipped,
          attachmentUnmatched,
          attachmentFailed
        })
        continue
      }

      const importResult = importInvoiceAttachments(matchedInvoiceId, [filePath])
      attachmentImported += importResult.imported
      attachmentSkipped += importResult.skipped
    } catch {
      attachmentFailed++
    }

    onProgress?.({
      done: i + 1,
      total: paths.length,
      attachmentImported,
      attachmentSkipped,
      attachmentUnmatched,
      attachmentFailed
    })
  }

  return {
    attachmentImported,
    attachmentSkipped,
    attachmentUnmatched,
    attachmentFailed,
    unmatchedDetails
  }
}

async function runInvoiceImportPipeline(
  event: Electron.IpcMainInvokeEvent,
  invoicePaths: string[],
  tripItineraryPaths: string[] = []
): Promise<BatchImportResult> {
  let importSnapshot = { done: 0, total: 0, imported: 0, skipped: 0 }
  const emit = (payload: ImportProgressPayload): void => {
    event.sender.send('import-progress', payload)
  }

  const result = importPdfs(invoicePaths, (p) => {
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

  const preferredInvoiceIds = new Set(result.importedItems.map((item) => item.id))
  const attachmentSummary = await autoImportTripItineraries(
    tripItineraryPaths,
    pythonPath,
    preferredInvoiceIds,
    (p) => {
      emit({
        phase: 'attachment',
        done: p.done,
        total: p.total,
        imported: result.imported + p.attachmentImported,
        skipped: result.skipped + p.attachmentSkipped,
        ocrProcessed: ocr.ocrProcessed,
        ocrFailed: ocr.ocrFailed
      })
    }
  )

  emit({
    phase: 'done',
    done: tripItineraryPaths.length || importSnapshot.total || result.imported + result.skipped,
    total: tripItineraryPaths.length || importSnapshot.total || result.imported + result.skipped,
    imported: result.imported + attachmentSummary.attachmentImported,
    skipped: result.skipped + attachmentSummary.attachmentSkipped,
    ocrProcessed: ocr.ocrProcessed,
    ocrFailed: ocr.ocrFailed
  })

  return {
    success: true,
    imported: result.imported,
    skipped: result.skipped,
    ocrProcessed: ocr.ocrProcessed,
    ocrFailed: ocr.ocrFailed,
    attachmentImported: attachmentSummary.attachmentImported,
    attachmentSkipped: attachmentSummary.attachmentSkipped,
    attachmentUnmatched: attachmentSummary.attachmentUnmatched,
    attachmentFailed: attachmentSummary.attachmentFailed,
    unmatchedDetails: attachmentSummary.unmatchedDetails
  }
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
    const pipelineResult = await runInvoiceImportPipeline(event, paths)
    return {
      success: pipelineResult.success,
      imported: pipelineResult.imported,
      skipped: pipelineResult.skipped,
      ocrProcessed: pipelineResult.ocrProcessed,
      ocrFailed: pipelineResult.ocrFailed
    }
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

  ipcMain.handle('import-batch-files', async (event, invoicePaths: string[], tripItineraryPaths: string[]) => {
    return runInvoiceImportPipeline(event, invoicePaths, tripItineraryPaths)
  })

  ipcMain.handle('get-pdf-data', (_event, filePath: string) => {
    return getPdfBase64(filePath)
  })

  ipcMain.handle('get-invoice-attachments', (_event, invoiceId: string) => {
    return getInvoiceAttachments(invoiceId)
  })

  ipcMain.handle('import-invoice-attachments', (_event, invoiceId: string, paths: string[]) => {
    return importInvoiceAttachments(invoiceId, paths)
  })

  ipcMain.handle('delete-invoice-attachment', (_event, id: string) => {
    deleteInvoiceAttachment(id)
    return { success: true }
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
        `SELECT i.id, i.file_path, i.file_hash, i.invoice_no, i.date, i.vendor, i.vendor_tax_id,
                i.amount, i.tax, i.total, i.category, i.project_tag, i.note, i.invoice_type, i.ocr_raw, i.created_at,
                (SELECT COUNT(1) FROM invoice_attachments ia WHERE ia.invoice_id = i.id) AS attachment_count
         FROM invoices i ${where ? where.replace('WHERE ', 'WHERE ') : ''} ORDER BY i.date DESC, i.created_at DESC`
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
        createdAt: row[15],
        attachmentCount: row[16]
      }))
    }
  )

  ipcMain.handle('get-invoice', (_event, id: string) => {
    const db = getDb()
    const result = db.exec(
      `SELECT i.id, i.file_path, i.file_hash, i.invoice_no, i.date, i.vendor, i.vendor_tax_id,
              i.amount, i.tax, i.total, i.category, i.project_tag, i.note, i.invoice_type, i.ocr_raw, i.created_at,
              (SELECT COUNT(1) FROM invoice_attachments ia WHERE ia.invoice_id = i.id) AS attachment_count
       FROM invoices i WHERE i.id = '${id}'`
    )
    if (!result.length || !result[0].values.length) return null
    const row = result[0].values[0]
    return {
      id: row[0], filePath: row[1], fileHash: row[2], invoiceNo: row[3],
      date: row[4], vendor: row[5], vendorTaxId: row[6],
      amount: row[7], tax: row[8], total: row[9],
      category: row[10], projectTag: row[11], note: row[12], invoiceType: row[13],
      ocrRaw: row[14], createdAt: row[15], attachmentCount: row[16]
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
