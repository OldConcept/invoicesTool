import { create } from 'zustand'
import { Invoice, Project, AppSettings, InvoiceCategory } from '../types/invoice'

interface FilterState {
  search: string
  category: InvoiceCategory | ''
  projectTag: string
  startDate: string
  endDate: string
}

interface InvoiceStore {
  invoices: Invoice[]
  selectedIds: Set<string>
  activeInvoiceId: string | null
  projects: Project[]
  settings: AppSettings
  filter: FilterState
  loading: boolean
  ocrLoading: Set<string>
  batchOcrProgress: { done: number; total: number } | null

  // Actions
  loadInvoices: () => Promise<void>
  loadProjects: () => Promise<void>
  loadSettings: () => Promise<void>
  setFilter: (filter: Partial<FilterState>) => void
  setActiveInvoice: (id: string | null) => void
  toggleSelect: (id: string) => void
  selectAll: () => void
  clearSelection: () => void
  updateInvoice: (id: string, data: Partial<Invoice>) => Promise<void>
  deleteSelected: () => Promise<void>
  saveSettings: (settings: Partial<AppSettings>) => Promise<void>
  runOcr: (invoice: Invoice) => Promise<void>
  runOcrBatch: () => Promise<void>
}

export const useInvoiceStore = create<InvoiceStore>((set, get) => ({
  invoices: [],
  selectedIds: new Set(),
  activeInvoiceId: null,
  projects: [],
  settings: { pythonPath: '', dataDir: '', exporterName: '', companyName: '' },
  filter: { search: '', category: '', projectTag: '', startDate: '', endDate: '' },
  loading: false,
  ocrLoading: new Set(),
  batchOcrProgress: null,

  loadInvoices: async () => {
    set({ loading: true })
    const { filter } = get()
    const invoices = await window.api.getInvoices({
      search: filter.search || undefined,
      category: filter.category || undefined,
      projectTag: filter.projectTag || undefined,
      startDate: filter.startDate || undefined,
      endDate: filter.endDate || undefined
    })
    set({ invoices: invoices as Invoice[], loading: false })
  },

  loadProjects: async () => {
    const projects = await window.api.getProjects()
    set({ projects: projects as Project[] })
  },

  loadSettings: async () => {
    const raw = await window.api.getSettings()
    set({
      settings: {
        pythonPath: raw.pythonPath || '',
        dataDir: raw.dataDir || '',
        exporterName: raw.exporterName || '',
        companyName: raw.companyName || ''
      }
    })
  },

  setFilter: (partial) => {
    set((s) => ({ filter: { ...s.filter, ...partial } }))
    // Debounced reload is handled in component
  },

  setActiveInvoice: (id) => set({ activeInvoiceId: id }),

  toggleSelect: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds)
      next.has(id) ? next.delete(id) : next.add(id)
      return { selectedIds: next }
    }),

  selectAll: () =>
    set((s) => ({ selectedIds: new Set(s.invoices.map((i) => i.id)) })),

  clearSelection: () => set({ selectedIds: new Set() }),

  updateInvoice: async (id, data) => {
    await window.api.updateInvoice(id, data as Record<string, unknown>)
    set((s) => ({
      invoices: s.invoices.map((inv) => (inv.id === id ? { ...inv, ...data } : inv))
    }))
  },

  deleteSelected: async () => {
    const ids = [...get().selectedIds]
    if (!ids.length) return
    await window.api.deleteInvoices(ids)
    set((s) => ({
      invoices: s.invoices.filter((inv) => !ids.includes(inv.id)),
      selectedIds: new Set(),
      activeInvoiceId: s.activeInvoiceId && ids.includes(s.activeInvoiceId) ? null : s.activeInvoiceId
    }))
  },

  saveSettings: async (partial) => {
    const current = get().settings
    const next = { ...current, ...partial }
    await window.api.saveSettings(next as Record<string, string>)
    set({ settings: next })
  },

  runOcr: async (invoice) => {
    set((s) => ({ ocrLoading: new Set([...s.ocrLoading, invoice.id]) }))

    const result = await window.api.runOcr(invoice.filePath)

    if (result.success && result.data) {
      const d = result.data as Record<string, unknown>
      await get().updateInvoice(invoice.id, {
        invoiceNo: d.invoice_no as string || null,
        date: d.date as string || null,
        vendor: d.vendor as string || null,
        vendorTaxId: d.vendor_tax_id as string || null,
        amount: d.amount as number || null,
        tax: d.tax as number || null,
        total: d.total as number || null,
        category: (d.category as InvoiceCategory) || '餐饮外卖',
        invoiceType: d.invoice_type as Invoice['invoiceType'] || null,
        ocrRaw: JSON.stringify(d)
      })
    } else {
      alert(`OCR 失败: ${result.error}`)
    }

    // 必须在 updateInvoice 之后再移除 loading，
    // 这样 EditPanel 的 useEffect([isOcrLoading]) 触发时已能读到最新数据
    set((s) => {
      const next = new Set(s.ocrLoading)
      next.delete(invoice.id)
      return { ocrLoading: next }
    })
  },

  runOcrBatch: async () => {
    const { invoices, selectedIds } = get()
    const targets = invoices.filter((inv) => selectedIds.has(inv.id))
    if (!targets.length) return

    const total = targets.length
    set({ batchOcrProgress: { done: 0, total } })

    // Process 2 at a time to avoid overwhelming Python/CPU
    const CONCURRENCY = 2
    let done = 0
    const failures: string[] = []

    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const batch = targets.slice(i, i + CONCURRENCY)
      await Promise.all(
        batch.map(async (invoice) => {
          set((s) => ({ ocrLoading: new Set([...s.ocrLoading, invoice.id]) }))

          const result = await window.api.runOcr(invoice.filePath)

          if (result.success && result.data) {
            const d = result.data as Record<string, unknown>
            await get().updateInvoice(invoice.id, {
              invoiceNo: (d.invoice_no as string) || null,
              date: (d.date as string) || null,
              vendor: (d.vendor as string) || null,
              vendorTaxId: (d.vendor_tax_id as string) || null,
              amount: (d.amount as number) || null,
              tax: (d.tax as number) || null,
              total: (d.total as number) || null,
              category: (d.category as InvoiceCategory) || '餐饮外卖',
              invoiceType: d.invoice_type as Invoice['invoiceType'] || null,
              ocrRaw: JSON.stringify(d)
            })
          } else {
            failures.push(`${invoice.vendor || invoice.id}: ${result.error}`)
          }

          set((s) => {
            const next = new Set(s.ocrLoading)
            next.delete(invoice.id)
            return { ocrLoading: next }
          })

          done++
          set({ batchOcrProgress: { done, total } })
        })
      )
    }

    set({ batchOcrProgress: null })

    if (failures.length) {
      alert(`批量识别完成，${total - failures.length} 张成功，${failures.length} 张失败：\n${failures.join('\n')}`)
    }
  }
}))
