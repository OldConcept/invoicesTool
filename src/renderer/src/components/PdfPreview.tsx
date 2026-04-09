import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { useInvoiceStore } from '../stores/invoiceStore'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

const ZOOM_STEP = 0.25
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3

export default function PdfPreview(): React.JSX.Element {
  const { invoices, activeInvoiceId } = useInvoiceStore()
  const invoice = invoices.find((i) => i.id === activeInvoiceId) || null

  const [pdfData, setPdfData] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [containerWidth, setContainerWidth] = useState(400)
  const [dragging, setDragging] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (scrollRef.current) {
      scrollRef.current.removeEventListener('wheel', scrollRef.current._wheelHandler as EventListener)
    }
    scrollRef.current = node
    if (node) {
      setContainerWidth(node.clientWidth - 32)
      const onWheel = (e: WheelEvent): void => {
        if (!e.ctrlKey && !e.metaKey) return
        e.preventDefault()
        setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN,
          parseFloat((z - e.deltaY * 0.001).toFixed(2))
        )))
      }
      ;(node as HTMLDivElement & { _wheelHandler?: unknown })._wheelHandler = onWheel
      node.addEventListener('wheel', onWheel, { passive: false })
    }
  }, [])

  useEffect(() => {
    if (!invoice) {
      setPdfData(null)
      return
    }
    setLoading(true)
    setCurrentPage(1)
    setZoom(1)
    window.api.getPdfData(invoice.filePath).then((base64: string) => {
      setPdfData(base64)
      setLoading(false)
    }).catch(() => {
      setPdfData(null)
      setLoading(false)
    })
  }, [invoice?.id])

  // Mouse drag to pan — listeners on window so fast moves never drop
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    const el = scrollRef.current
    if (!el) return
    e.preventDefault()

    const startX = e.clientX
    const startY = e.clientY
    const startScrollLeft = el.scrollLeft
    const startScrollTop = el.scrollTop
    setDragging(true)

    const onMove = (ev: MouseEvent): void => {
      el.scrollLeft = startScrollLeft - (ev.clientX - startX)
      el.scrollTop  = startScrollTop  - (ev.clientY - startY)
    }
    const onUp = (): void => {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])


  if (!invoice) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 bg-gray-50">
        <svg className="w-12 h-12 text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        <p className="text-sm">选择发票预览 PDF</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
      </div>
    )
  }

  if (!pdfData) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 text-gray-400">
        <p className="text-sm">无法加载 PDF</p>
        <p className="text-xs mt-1">{invoice.filePath}</p>
      </div>
    )
  }

  const pageWidth = Math.floor(containerWidth * zoom)

  return (
    <div className="flex flex-col h-full bg-gray-100">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-white border-b border-gray-200">
        {/* Page controls */}
        <div className="flex items-center gap-1">
          {numPages > 1 && (
            <>
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="p-1 text-gray-500 hover:text-gray-700 disabled:opacity-30"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="text-xs text-gray-500 w-12 text-center">{currentPage} / {numPages}</span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                disabled={currentPage >= numPages}
                className="p-1 text-gray-500 hover:text-gray-700 disabled:opacity-30"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, parseFloat((z - ZOOM_STEP).toFixed(2))))}
            disabled={zoom <= ZOOM_MIN}
            className="p-1 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30"
            title="缩小"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0zm-6 0H8" />
            </svg>
          </button>

          <button
            onClick={() => setZoom(1)}
            className="text-xs text-gray-600 hover:text-gray-900 w-10 text-center tabular-nums"
            title="重置缩放"
          >
            {Math.round(zoom * 100)}%
          </button>

          <button
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, parseFloat((z + ZOOM_STEP).toFixed(2))))}
            disabled={zoom >= ZOOM_MAX}
            className="p-1 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30"
            title="放大"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0zm-6 0h-2m1-1v2" />
            </svg>
          </button>
        </div>
      </div>

      {/* PDF content */}
      <div
        id="pdf-scroll-area"
        ref={containerRef}
        className="flex-1 overflow-auto p-4 select-none"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onMouseDown={onMouseDown}
      >
        <div style={{ minWidth: 'fit-content', margin: '0 auto', width: 'fit-content' }}>
        <Document
          file={`data:application/pdf;base64,${pdfData}`}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          loading={
            <div className="flex items-center justify-center p-8">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
            </div>
          }
        >
          <Page
            pageNumber={currentPage}
            width={pageWidth}
            renderAnnotationLayer={true}
            renderTextLayer={true}
            className="shadow-md"
          />
        </Document>
        </div>
      </div>
    </div>
  )
}
