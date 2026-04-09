import React, { useState } from 'react'
import { UnmatchedTripItinerary } from '../types/invoice'
import { useInvoiceStore } from '../stores/invoiceStore'

interface Props {
  items: UnmatchedTripItinerary[]
  onBind: (filePath: string, invoiceId: string) => Promise<void>
  onClose: () => void
}

export default function TripItineraryReviewModal({
  items,
  onBind,
  onClose
}: Props): React.JSX.Element | null {
  const { invoices } = useInvoiceStore()
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [resolvedPaths, setResolvedPaths] = useState<Set<string>>(new Set())
  const [manualSelection, setManualSelection] = useState<Record<string, string>>({})

  const unresolvedItems = items.filter((item) => !resolvedPaths.has(item.filePath))
  if (unresolvedItems.length === 0) return null

  const taxiInvoices = invoices.filter((invoice) => {
    const vendor = (invoice.vendor || '').toLowerCase()
    return (
      invoice.category === '打车' ||
      invoice.invoiceType === '出租车票' ||
      ['滴滴', '美团', '高德', '曹操', 't3', '首汽', '嘀嗒'].some((keyword) => vendor.includes(keyword))
    )
  })

  const formatMoney = (value: number | null): string => (value == null ? '—' : `¥${value.toFixed(2)}`)
  const getFileName = (filePath: string): string => {
    const parts = filePath.split(/[/\\]/)
    return parts[parts.length - 1] || filePath
  }

  async function handleBind(filePath: string, invoiceId: string): Promise<void> {
    const key = `${filePath}:${invoiceId}`
    setPendingKey(key)
    try {
      await onBind(filePath, invoiceId)
      setResolvedPaths((prev) => new Set(prev).add(filePath))
    } finally {
      setPendingKey(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">待确认的行程单</h2>
            <p className="text-xs text-gray-500 mt-1">这些行程单没有自动绑定，点候选发票即可补绑</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {unresolvedItems.map((item) => (
            <div key={item.filePath} className="border border-gray-200 rounded-xl p-4 bg-gray-50">
              {(() => {
                const defaultManualInvoiceId =
                  manualSelection[item.filePath] ||
                  item.suggestions[0]?.invoiceId ||
                  taxiInvoices[0]?.id ||
                  ''

                return (
                  <>
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{getFileName(item.filePath)}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    识别金额 {formatMoney(item.detectedAmount)} · 日期 {item.detectedDate || '—'} · 商家 {item.detectedVendor || '—'}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => window.api.showItemInFolder(item.filePath)}
                    className="text-xs px-2.5 py-1 bg-white border border-gray-200 rounded-full text-gray-600 hover:bg-gray-50"
                  >
                    定位原文件
                  </button>
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                    {item.reason}
                  </div>
                </div>
              </div>

              {item.suggestions.length > 0 ? (
                <div className="space-y-2">
                  {item.suggestions.map((suggestion, index) => {
                    const key = `${item.filePath}:${suggestion.invoiceId}`
                    const isPending = pendingKey === key
                    return (
                      <div
                        key={suggestion.invoiceId}
                        className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-lg px-3 py-3"
                      >
                        <div className="min-w-0">
                          <div className="text-sm text-gray-900 truncate">
                            候选 {index + 1} · {suggestion.vendor || '未知商家'}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            日期 {suggestion.date || '—'} · 金额 {formatMoney(suggestion.total)} · 匹配分 {suggestion.score}
                          </div>
                        </div>
                        <button
                          onClick={() => handleBind(item.filePath, suggestion.invoiceId)}
                          disabled={isPending}
                          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                        >
                          {isPending ? '绑定中...' : '绑定到这张发票'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-xs text-gray-400">没有可推荐的候选发票，稍后可在打车发票详情里手动添加。</div>
              )}

              {taxiInvoices.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <div className="text-xs font-medium text-gray-500 mb-2">直接绑定到已导入的打车发票</div>
                  <div className="flex items-center gap-2">
                    <select
                      value={defaultManualInvoiceId}
                      onChange={(e) =>
                        setManualSelection((prev) => ({
                          ...prev,
                          [item.filePath]: e.target.value
                        }))
                      }
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {taxiInvoices.map((invoice) => (
                        <option key={invoice.id} value={invoice.id}>
                          {(invoice.date || '无日期')} · {(invoice.vendor || '未知商家')} · {formatMoney(invoice.total)}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => defaultManualInvoiceId && handleBind(item.filePath, defaultManualInvoiceId)}
                      disabled={!defaultManualInvoiceId || pendingKey === `${item.filePath}:${defaultManualInvoiceId}`}
                      className="px-3 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-black disabled:opacity-50"
                    >
                      {pendingKey === `${item.filePath}:${defaultManualInvoiceId}` ? '绑定中...' : '绑定所选发票'}
                    </button>
                  </div>
                </div>
              )}
                  </>
                )
              })()}
            </div>
          ))}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
