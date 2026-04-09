import React, { useEffect, useRef } from 'react'
import { useInvoiceStore } from '../stores/invoiceStore'
import { InvoiceCategory } from '../types/invoice'

const CATEGORIES: InvoiceCategory[] = ['城市间交通', '打车', '住宿', '餐饮外卖']

const CATEGORY_COLORS: Record<InvoiceCategory, string> = {
  城市间交通: 'bg-sky-100 text-sky-700',
  打车: 'bg-blue-100 text-blue-700',
  住宿: 'bg-purple-100 text-purple-700',
  餐饮外卖: 'bg-orange-100 text-orange-700',
}

export default function FilterPanel(): React.JSX.Element {
  const { filter, setFilter, loadInvoices, invoices, projects } = useInvoiceStore()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function triggerLoad(): void {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => loadInvoices(), 200)
  }

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>): void {
    setFilter({ search: e.target.value })
    triggerLoad()
  }

  function handleCategory(cat: InvoiceCategory | ''): void {
    setFilter({ category: cat })
    triggerLoad()
  }

  function handleProject(tag: string): void {
    setFilter({ projectTag: tag })
    triggerLoad()
  }

  function handleDate(field: 'startDate' | 'endDate', value: string): void {
    setFilter({ [field]: value })
    triggerLoad()
  }

  function clearFilters(): void {
    setFilter({ search: '', category: '', projectTag: '', startDate: '', endDate: '' })
    triggerLoad()
  }

  // Stats
  const total = invoices.reduce((s, i) => s + (i.total || 0), 0)
  const byCategory = CATEGORIES.map((cat) => ({
    cat,
    count: invoices.filter((i) => i.category === cat).length,
    sum: invoices.filter((i) => i.category === cat).reduce((s, i) => s + (i.total || 0), 0)
  })).filter((c) => c.count > 0)

  const hasFilter = filter.search || filter.category || filter.projectTag || filter.startDate || filter.endDate

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-gray-50 border-r border-gray-200">
      {/* Search */}
      <div className="p-3">
        <div className="relative">
          <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="搜索商家、备注..."
            value={filter.search}
            onChange={handleSearch}
            className="w-full pl-8 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Date range */}
      <div className="px-3 pb-3">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">日期范围</div>
        <div className="flex gap-1.5">
          <input
            type="date"
            value={filter.startDate}
            onChange={(e) => handleDate('startDate', e.target.value)}
            className="flex-1 text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-gray-400 self-center text-xs">至</span>
          <input
            type="date"
            value={filter.endDate}
            onChange={(e) => handleDate('endDate', e.target.value)}
            className="flex-1 text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Category */}
      <div className="px-3 pb-3">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">费用分类</div>
        <div className="flex flex-col gap-1">
          <button
            onClick={() => handleCategory('')}
            className={`text-left text-sm px-2 py-1.5 rounded-md transition-colors ${
              !filter.category ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            全部分类
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => handleCategory(cat)}
              className={`text-left text-sm px-2 py-1.5 rounded-md transition-colors ${
                filter.category === cat ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Projects */}
      {projects.length > 0 && (
        <div className="px-3 pb-3">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">出差项目</div>
          <div className="flex flex-col gap-1">
            <button
              onClick={() => handleProject('')}
              className={`text-left text-sm px-2 py-1.5 rounded-md transition-colors ${
                !filter.projectTag ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              全部项目
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => handleProject(p.name)}
                className={`text-left text-sm px-2 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
                  filter.projectTag === p.name ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: p.color }}
                />
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Clear filters */}
      {hasFilter && (
        <div className="px-3 pb-3">
          <button
            onClick={clearFilters}
            className="w-full text-sm text-blue-600 hover:text-blue-700 py-1"
          >
            清除筛选
          </button>
        </div>
      )}

      <div className="flex-1" />

      {/* Summary */}
      <div className="p-3 border-t border-gray-200 bg-white">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">统计摘要</div>
        <div className="text-lg font-bold text-gray-900">¥{total.toFixed(2)}</div>
        <div className="text-xs text-gray-500 mb-2">{invoices.length} 张发票</div>
        <div className="flex flex-col gap-1">
          {byCategory.map(({ cat, count, sum }) => (
            <div key={cat} className="flex items-center justify-between text-xs">
              <span className={`px-1.5 py-0.5 rounded text-xs ${CATEGORY_COLORS[cat as InvoiceCategory]}`}>{cat}</span>
              <span className="text-gray-500">{count}张 ¥{sum.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
