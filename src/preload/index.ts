import { contextBridge, ipcRenderer } from 'electron'

type ImportProgressPayload = {
  phase: 'import' | 'ocr' | 'done'
  done: number
  total: number
  imported: number
  skipped: number
  ocrProcessed: number
  ocrFailed: number
}

const api = {
  // 文件操作
  selectPdfFiles: (): Promise<string[]> => ipcRenderer.invoke('select-pdf-files'),
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('select-folder'),
  importPdfs: (
    paths: string[]
  ): Promise<{ success: boolean; imported: number; skipped: number; ocrProcessed: number; ocrFailed: number }> =>
    ipcRenderer.invoke('import-pdfs', paths),
  importFolder: (
    folderPath: string
  ): Promise<{ success: boolean; imported: number; skipped: number; ocrProcessed: number; ocrFailed: number }> =>
    ipcRenderer.invoke('import-folder', folderPath),
  onImportProgress: (callback: (progress: ImportProgressPayload) => void): (() => void) => {
    const listener = (_event: unknown, payload: ImportProgressPayload): void => callback(payload)
    ipcRenderer.on('import-progress', listener)
    return () => ipcRenderer.off('import-progress', listener)
  },
  scanFolder: (
    folderPath: string,
    mode?: 'fast' | 'balanced' | 'accurate'
  ): Promise<{ total: number; invoices: string[]; trip_itineraries: string[]; non_invoices: string[] }> =>
    ipcRenderer.invoke('scan-folder', folderPath, mode),
  importBatchFiles: (
    invoicePaths: string[],
    tripItineraryPaths: string[]
  ): Promise<{
    success: boolean
    imported: number
    skipped: number
    ocrProcessed: number
    ocrFailed: number
    attachmentImported: number
    attachmentSkipped: number
    attachmentUnmatched: number
    attachmentFailed: number
    unmatchedDetails: Array<{
      filePath: string
      detectedAmount: number | null
      detectedDate: string | null
      detectedVendor: string | null
      reason: string
      suggestions: Array<{
        invoiceId: string
        vendor: string | null
        date: string | null
        total: number | null
        score: number
      }>
    }>
  }> => ipcRenderer.invoke('import-batch-files', invoicePaths, tripItineraryPaths),
  cancelScan: (): Promise<{ success: boolean }> => ipcRenderer.invoke('cancel-scan'),
  getPdfData: (filePath: string): Promise<string> => ipcRenderer.invoke('get-pdf-data', filePath),
  getInvoiceAttachments: (invoiceId: string) => ipcRenderer.invoke('get-invoice-attachments', invoiceId),
  importInvoiceAttachments: (
    invoiceId: string,
    paths: string[]
  ): Promise<{ imported: number; skipped: number }> =>
    ipcRenderer.invoke('import-invoice-attachments', invoiceId, paths),
  deleteInvoiceAttachment: (id: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('delete-invoice-attachment', id),

  // 发票 CRUD
  getInvoices: (filter?: {
    search?: string
    category?: string
    projectTag?: string
    startDate?: string
    endDate?: string
  }) => ipcRenderer.invoke('get-invoices', filter),
  getInvoice: (id: string) => ipcRenderer.invoke('get-invoice', id),
  updateInvoice: (id: string, data: Record<string, unknown>) =>
    ipcRenderer.invoke('update-invoice', id, data),
  deleteInvoices: (ids: string[]) => ipcRenderer.invoke('delete-invoices', ids),

  // OCR
  runOcr: (
    filePath: string
  ): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> =>
    ipcRenderer.invoke('run-ocr', filePath),

  // 项目标签
  getProjects: () => ipcRenderer.invoke('get-projects'),
  createProject: (name: string, color: string) =>
    ipcRenderer.invoke('create-project', name, color),
  deleteProject: (id: string) => ipcRenderer.invoke('delete-project', id),

  // 导出
  exportReport: (filter: Record<string, unknown>, settings: Record<string, unknown>) =>
    ipcRenderer.invoke('export-report', filter, settings),
  exportZip: (filter: Record<string, unknown>, settings: Record<string, unknown>) =>
    ipcRenderer.invoke('export-zip', filter, settings),

  // 设置
  getSettings: (): Promise<Record<string, string>> => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Record<string, string>) =>
    ipcRenderer.invoke('save-settings', settings),

  // 工具
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  showItemInFolder: (path: string) => ipcRenderer.invoke('show-item-in-folder', path)
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
