import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // 文件操作
  selectPdfFiles: (): Promise<string[]> => ipcRenderer.invoke('select-pdf-files'),
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('select-folder'),
  importPdfs: (paths: string[]): Promise<{ success: boolean; imported: number; skipped: number }> =>
    ipcRenderer.invoke('import-pdfs', paths),
  importFolder: (
    folderPath: string
  ): Promise<{ success: boolean; imported: number; skipped: number }> =>
    ipcRenderer.invoke('import-folder', folderPath),
  scanFolder: (
    folderPath: string
  ): Promise<{ total: number; invoices: string[]; non_invoices: string[] }> =>
    ipcRenderer.invoke('scan-folder', folderPath),
  getPdfData: (filePath: string): Promise<string> => ipcRenderer.invoke('get-pdf-data', filePath),

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
