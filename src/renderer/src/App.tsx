import React, { useEffect, useState, useCallback } from 'react'
import TopBar from './components/TopBar'
import FilterPanel from './components/FilterPanel'
import InvoiceList from './components/InvoiceList'
import PdfPreview from './components/PdfPreview'
import EditPanel from './components/EditPanel'
import ResizeHandle from './components/ResizeHandle'
import { useInvoiceStore } from './stores/invoiceStore'

const FILTER_MIN = 140
const FILTER_MAX = 360
const LIST_MIN = 200
const LIST_MAX = 480
const EDIT_MIN = 220
const EDIT_MAX = 480

export default function App(): React.JSX.Element {
  const { loadInvoices, loadProjects, loadSettings } = useInvoiceStore()

  const [filterWidth, setFilterWidth] = useState(192)
  const [listWidth, setListWidth] = useState(288)
  const [editWidth, setEditWidth] = useState(288)

  useEffect(() => {
    loadSettings()
    loadProjects()
    loadInvoices()
  }, [])

  const resizeFilter = useCallback((delta: number) => {
    setFilterWidth((w) => Math.min(FILTER_MAX, Math.max(FILTER_MIN, w + delta)))
  }, [])

  const resizeList = useCallback((delta: number) => {
    setListWidth((w) => Math.min(LIST_MAX, Math.max(LIST_MIN, w + delta)))
  }, [])

  const resizeEdit = useCallback((delta: number) => {
    setEditWidth((w) => Math.min(EDIT_MAX, Math.max(EDIT_MIN, w - delta)))
  }, [])

  return (
    <div className="flex flex-col h-screen bg-white overflow-hidden">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Filter panel */}
        <div style={{ width: filterWidth, flexShrink: 0 }}>
          <FilterPanel />
        </div>

        <ResizeHandle onResize={resizeFilter} />

        {/* Invoice list */}
        <div style={{ width: listWidth, flexShrink: 0 }} className="border-r border-gray-200">
          <InvoiceList />
        </div>

        <ResizeHandle onResize={resizeList} />

        {/* PDF preview */}
        <div className="flex-1 min-w-0">
          <PdfPreview />
        </div>

        <ResizeHandle onResize={resizeEdit} />

        {/* Edit panel */}
        <div style={{ width: editWidth, flexShrink: 0 }} className="border-l border-gray-200">
          <EditPanel />
        </div>
      </div>
    </div>
  )
}
