import React, { useState } from 'react'
import { useInvoiceStore } from '../stores/invoiceStore'
import { InvoiceCategory } from '../types/invoice'

interface Props {
  onClose: () => void
}

const CATEGORIES: InvoiceCategory[] = ['城市间交通', '交通', '住宿', '餐饮外卖']

export default function ReportModal({ onClose }: Props): React.JSX.Element {
  const { settings, projects, invoices } = useInvoiceStore()
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [projectTag, setProjectTag] = useState('')
  const [selectedCats, setSelectedCats] = useState<InvoiceCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [exportType, setExportType] = useState<'excel' | 'zip'>('excel')

  function toggleCat(cat: InvoiceCategory): void {
    setSelectedCats((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    )
  }

  function buildFilter(): Record<string, unknown> {
    return {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      projectTag: projectTag || undefined,
      categories: selectedCats.length > 0 ? selectedCats : undefined
    }
  }

  // Estimate matching invoice count
  const matchCount = invoices.filter((inv) => {
    if (startDate && inv.date && inv.date < startDate) return false
    if (endDate && inv.date && inv.date > endDate) return false
    if (projectTag && inv.projectTag !== projectTag) return false
    if (selectedCats.length > 0 && !selectedCats.includes(inv.category as InvoiceCategory)) return false
    return true
  })

  const totalAmount = matchCount.reduce((s, i) => s + (i.total || 0), 0)

  async function handleExport(): Promise<void> {
    setLoading(true)
    const filter = buildFilter()
    const exportSettings = {
      exporterName: settings.exporterName,
      companyName: settings.companyName
    }

    let result
    if (exportType === 'excel') {
      result = await window.api.exportReport(filter, exportSettings)
    } else {
      result = await window.api.exportZip(filter, exportSettings)
    }

    setLoading(false)

    if (result.success) {
      alert(`导出成功！\n文件已保存到：${result.path}`)
      onClose()
    } else if (result.error !== '已取消') {
      alert(`导出失败: ${result.error}`)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">生成报销单</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Export type */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">导出格式</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setExportType('excel')}
                className={`py-2.5 text-sm border rounded-lg transition-colors ${
                  exportType === 'excel'
                    ? 'bg-green-50 border-green-400 text-green-700 font-medium'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Excel 报销单
              </button>
              <button
                onClick={() => setExportType('zip')}
                className={`py-2.5 text-sm border rounded-lg transition-colors ${
                  exportType === 'zip'
                    ? 'bg-blue-50 border-blue-400 text-blue-700 font-medium'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                ZIP 打包（含PDF）
              </button>
            </div>
          </div>

          {/* Date range */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">日期范围</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-gray-400">至</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Project */}
          {projects.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">出差项目</label>
              <select
                value={projectTag}
                onChange={(e) => setProjectTag(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">全部项目</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Categories */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">费用分类</label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => toggleCat(cat)}
                  className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                    selectedCats.includes(cat)
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            {selectedCats.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">不选则包含全部分类</p>
            )}
          </div>

          {/* Preview */}
          <div className="bg-blue-50 rounded-lg px-4 py-3">
            <div className="text-sm text-blue-800">
              将导出 <span className="font-bold">{matchCount.length}</span> 张发票，
              合计 <span className="font-bold">¥{totalAmount.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100">
          <button
            onClick={handleExport}
            disabled={loading || matchCount.length === 0}
            className="w-full py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                导出中...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                导出{exportType === 'excel' ? ' Excel 报销单' : ' ZIP 打包'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
