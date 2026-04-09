import React from 'react'
import { useInvoiceStore } from '../stores/invoiceStore'
import { Invoice, InvoiceCategory } from '../types/invoice'

const CATEGORY_COLORS: Record<InvoiceCategory, string> = {
  城市间交通: 'bg-sky-100 text-sky-700',
  打车: 'bg-blue-100 text-blue-700',
  住宿: 'bg-purple-100 text-purple-700',
  餐饮外卖: 'bg-orange-100 text-orange-700',
}

function InvoiceCard({
  invoice,
  isActive,
  isSelected,
  onSelect,
  onClick
}: {
  invoice: Invoice
  isActive: boolean
  isSelected: boolean
  onSelect: (e: React.MouseEvent) => void
  onClick: () => void
}): React.JSX.Element {
  const { ocrLoading, runOcr } = useInvoiceStore()
  const isOcrLoading = ocrLoading.has(invoice.id)

  return (
    <div
      onClick={onClick}
      className={`relative p-3 border-b border-gray-100 cursor-pointer transition-colors hover:bg-gray-50 ${
        isActive ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
      } ${isSelected ? 'bg-blue-50' : ''}`}
    >
      <div className="flex items-start gap-2">
        {/* Checkbox */}
        <div
          onClick={onSelect}
          className={`mt-0.5 w-4 h-4 flex-shrink-0 rounded border-2 flex items-center justify-center cursor-pointer transition-colors ${
            isSelected
              ? 'bg-blue-500 border-blue-500'
              : 'border-gray-300 hover:border-blue-400'
          }`}
        >
          {isSelected && (
            <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Vendor + amount */}
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="text-sm font-medium text-gray-900 truncate">
              {invoice.vendor || '未知商家'}
            </span>
            <span className="text-sm font-semibold text-gray-900 flex-shrink-0">
              {invoice.total != null ? `¥${invoice.total.toFixed(2)}` : '—'}
            </span>
          </div>

          {/* Date + category */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {invoice.date && (
              <span className="text-xs text-gray-400">{invoice.date}</span>
            )}
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                CATEGORY_COLORS[invoice.category as InvoiceCategory] || 'bg-gray-100 text-gray-500'
              }`}
            >
              {invoice.category}
            </span>
            {invoice.projectTag && (
              <span className="text-xs text-gray-400 truncate">#{invoice.projectTag}</span>
            )}
          </div>

          {/* Invoice no or note */}
          {(invoice.invoiceNo || invoice.note) && (
            <div className="mt-0.5 text-xs text-gray-400 truncate">
              {invoice.invoiceNo ? `发票号: ${invoice.invoiceNo}` : invoice.note}
            </div>
          )}
        </div>

        {/* OCR status */}
        <div className="flex-shrink-0 flex flex-col items-end gap-1">
          {isOcrLoading ? (
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          ) : !invoice.vendor && !invoice.date && !invoice.total ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                runOcr(invoice)
              }}
              className="text-xs text-blue-500 hover:text-blue-700 whitespace-nowrap"
              title="自动识别"
            >
              识别
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function InvoiceList(): React.JSX.Element {
  const {
    invoices,
    activeInvoiceId,
    selectedIds,
    loading,
    setActiveInvoice,
    toggleSelect,
    selectAll,
    clearSelection
  } = useInvoiceStore()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
      </div>
    )
  }

  if (invoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3 p-6">
        <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <div className="text-center">
          <p className="font-medium text-gray-500">暂无发票</p>
          <p className="text-sm mt-1">点击顶部「导入发票」开始添加 PDF</p>
        </div>
      </div>
    )
  }

  const allSelected = invoices.length > 0 && selectedIds.size === invoices.length

  return (
    <div className="flex flex-col h-full">
      {/* List header */}
      <div className="flex items-center px-3 py-2 border-b border-gray-100 bg-gray-50">
        <div
          onClick={() => allSelected ? clearSelection() : selectAll()}
          className={`w-4 h-4 mr-2 rounded border-2 flex items-center justify-center cursor-pointer ${
            allSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300 hover:border-blue-400'
          }`}
        >
          {allSelected && (
            <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <span className="text-xs text-gray-500">{invoices.length} 张发票</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {invoices.map((invoice) => (
          <InvoiceCard
            key={invoice.id}
            invoice={invoice}
            isActive={invoice.id === activeInvoiceId}
            isSelected={selectedIds.has(invoice.id)}
            onSelect={(e) => {
              e.stopPropagation()
              toggleSelect(invoice.id)
            }}
            onClick={() => setActiveInvoice(invoice.id)}
          />
        ))}
      </div>
    </div>
  )
}
