import React, { useState, useEffect } from 'react'
import { useInvoiceStore } from '../stores/invoiceStore'
import { Invoice, InvoiceCategory, InvoiceType } from '../types/invoice'

const CATEGORIES: InvoiceCategory[] = ['城市间交通', '打车', '住宿', '餐饮外卖']
const INVOICE_TYPES: InvoiceType[] = [
  '增值税普通发票', '增值税专用发票', '行程单', '酒店发票', '出租车票', '其他'
]

interface FormState {
  invoiceNo: string
  date: string
  vendor: string
  vendorTaxId: string
  amount: string
  tax: string
  total: string
  category: InvoiceCategory
  invoiceType: InvoiceType | ''
  projectTag: string
  note: string
}

function invoiceToForm(inv: Invoice): FormState {
  return {
    invoiceNo: inv.invoiceNo || '',
    date: inv.date || '',
    vendor: inv.vendor || '',
    vendorTaxId: inv.vendorTaxId || '',
    amount: inv.amount != null ? String(inv.amount) : '',
    tax: inv.tax != null ? String(inv.tax) : '',
    total: inv.total != null ? String(inv.total) : '',
    category: inv.category as InvoiceCategory || '其他',
    invoiceType: inv.invoiceType || '',
    projectTag: inv.projectTag || '',
    note: inv.note || ''
  }
}

export default function EditPanel(): React.JSX.Element {
  const { invoices, activeInvoiceId, updateInvoice, runOcr, ocrLoading, projects } = useInvoiceStore()
  const invoice = invoices.find((i) => i.id === activeInvoiceId) || null

  const [form, setForm] = useState<FormState | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const isOcrLoading = ocrLoading.has(activeInvoiceId || '')

  useEffect(() => {
    if (invoice) {
      setForm(invoiceToForm(invoice))
      setDirty(false)
    } else {
      setForm(null)
    }
  // Re-sync when: switching invoices OR OCR finishes (isOcrLoading flips false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id, isOcrLoading])

  if (!invoice || !form) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
        <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        <p className="text-sm">点击左侧发票查看详情</p>
      </div>
    )
  }

  function handleChange(field: keyof FormState, value: string): void {
    setForm((f) => f ? { ...f, [field]: value } : f)
    setDirty(true)
  }

  async function handleSave(): Promise<void> {
    if (!form || !invoice) return
    setSaving(true)
    await updateInvoice(invoice.id, {
      invoiceNo: form.invoiceNo || null,
      date: form.date || null,
      vendor: form.vendor || null,
      vendorTaxId: form.vendorTaxId || null,
      amount: form.amount ? parseFloat(form.amount) : null,
      tax: form.tax ? parseFloat(form.tax) : null,
      total: form.total ? parseFloat(form.total) : null,
      category: form.category,
      invoiceType: form.invoiceType || null,
      projectTag: form.projectTag || null,
      note: form.note || null
    })
    setSaving(false)
    setDirty(false)
  }

  // isOcrLoading is already derived above the early return

  function FieldLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
    return <label className="block text-xs font-medium text-gray-500 mb-1">{children}</label>
  }

  function TextInput({
    value,
    onChange,
    placeholder,
    type = 'text'
  }: {
    value: string
    onChange: (v: string) => void
    placeholder?: string
    type?: string
  }): React.JSX.Element {
    return (
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
      />
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-white">
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-800">发票详情</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => runOcr(invoice)}
              disabled={isOcrLoading}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-md hover:bg-purple-100 transition-colors disabled:opacity-50"
            >
              {isOcrLoading ? (
                <div className="w-3 h-3 border border-purple-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              )}
              AI 识别
            </button>
            <button
              onClick={() => window.api.showItemInFolder(invoice.filePath)}
              className="text-xs px-2 py-1.5 text-gray-500 hover:text-gray-700"
              title="在文件夹中显示"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-400 truncate">{invoice.filePath.split('/').slice(-1)[0]}</p>
      </div>

      <div className="p-4 flex flex-col gap-3">
        <div>
          <FieldLabel>商家 / 销售方</FieldLabel>
          <TextInput value={form.vendor} onChange={(v) => handleChange('vendor', v)} placeholder="商家名称" />
        </div>

        <div>
          <FieldLabel>销售方税号</FieldLabel>
          <TextInput value={form.vendorTaxId} onChange={(v) => handleChange('vendorTaxId', v)} placeholder="统一社会信用代码" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <FieldLabel>开票日期</FieldLabel>
            <TextInput value={form.date} onChange={(v) => handleChange('date', v)} type="date" />
          </div>
          <div>
            <FieldLabel>合计金额 (¥)</FieldLabel>
            <TextInput value={form.total} onChange={(v) => handleChange('total', v)} placeholder="0.00" type="number" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <FieldLabel>税前金额 (¥)</FieldLabel>
            <TextInput value={form.amount} onChange={(v) => handleChange('amount', v)} placeholder="0.00" type="number" />
          </div>
          <div>
            <FieldLabel>税额 (¥)</FieldLabel>
            <TextInput value={form.tax} onChange={(v) => handleChange('tax', v)} placeholder="0.00" type="number" />
          </div>
        </div>

        <div>
          <FieldLabel>费用分类</FieldLabel>
          <select
            value={form.category}
            onChange={(e) => handleChange('category', e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel>发票类型</FieldLabel>
          <select
            value={form.invoiceType}
            onChange={(e) => handleChange('invoiceType', e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">未知</option>
            {INVOICE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel>出差项目</FieldLabel>
          <select
            value={form.projectTag}
            onChange={(e) => handleChange('projectTag', e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">无</option>
            {projects.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel>发票号码</FieldLabel>
          <TextInput value={form.invoiceNo} onChange={(v) => handleChange('invoiceNo', v)} placeholder="发票号码" />
        </div>

        <div>
          <FieldLabel>备注</FieldLabel>
          <textarea
            value={form.note}
            onChange={(e) => handleChange('note', e.target.value)}
            placeholder="添加备注..."
            rows={3}
            className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white resize-none"
          />
        </div>
      </div>

      {/* Save button */}
      <div className="sticky bottom-0 p-4 border-t border-gray-100 bg-white">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="w-full py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? '保存中...' : dirty ? '保存更改' : '已保存'}
        </button>
      </div>
    </div>
  )
}
