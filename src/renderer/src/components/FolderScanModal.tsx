import React from 'react'

type ScanResult = {
  total: number
  invoices: string[]
  trip_itineraries: string[]
  non_invoices: string[]
}

type ImportProgress = {
  phase: 'import' | 'ocr' | 'attachment' | 'done'
  done: number
  total: number
  imported: number
  skipped: number
  ocrProcessed: number
  ocrFailed: number
}

interface Props {
  folderPath: string
  scanning: boolean
  importing?: boolean
  importProgress?: ImportProgress | null
  result: ScanResult | null
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}

export default function FolderScanModal({
  folderPath,
  scanning,
  importing = false,
  importProgress = null,
  result,
  error,
  onConfirm,
  onCancel
}: Props): React.JSX.Element {
  const folderName = folderPath.split('/').pop() || folderPath
  const importPercent =
    importProgress && importProgress.total > 0
      ? Math.min(100, Math.round((importProgress.done / importProgress.total) * 100))
      : 0
  const importStageText =
    importProgress?.phase === 'import'
      ? `导入中 ${importProgress.done}/${importProgress.total}`
      : importProgress?.phase === 'ocr'
        ? `识别中 ${importProgress.done}/${importProgress.total}`
        : importProgress?.phase === 'attachment'
          ? `绑定行程单 ${importProgress.done}/${importProgress.total}`
        : importProgress?.phase === 'done'
          ? '导入完成'
          : '处理中...'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <h2 className="text-sm font-semibold text-gray-800">扫描目录</h2>
          </div>
          <button
            onClick={onCancel}
            disabled={importing}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Folder path */}
        <div className="px-5 pt-3 pb-0">
          <p className="text-xs text-gray-500 truncate" title={folderPath}>
            <span className="font-medium text-gray-700">{folderName}</span>
            <span className="ml-1 text-gray-400">{folderPath.slice(0, -(folderName.length + 1)) || '/'}</span>
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {scanning && (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-500">正在递归扫描 PDF 文件...</p>
              <p className="text-xs text-gray-400">极速模式：优先扫码 + 文本提取（不跑深度识别）</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center gap-2 py-6">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-red-600 text-center">{error}</p>
              <p className="text-xs text-gray-400">请确认 Python 已正确配置（设置 → Python 路径）</p>
            </div>
          )}

          {result && !scanning && (
            <div className="flex flex-col gap-4">
              {importing && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-3">
                  <div className="flex items-center justify-between text-xs text-blue-700 mb-2">
                    <span>{importStageText}</span>
                    <span>{importPercent}%</span>
                  </div>
                  <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${importPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Summary cards */}
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-gray-700">{result.total}</div>
                  <div className="text-xs text-gray-500 mt-0.5">PDF 文件</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-blue-700">{result.invoices.length}</div>
                  <div className="text-xs text-blue-500 mt-0.5">识别为发票</div>
                </div>
                <div className="bg-cyan-50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-cyan-700">{result.trip_itineraries.length}</div>
                  <div className="text-xs text-cyan-500 mt-0.5">打车行程单</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-gray-400">{result.non_invoices.length}</div>
                  <div className="text-xs text-gray-400 mt-0.5">非发票跳过</div>
                </div>
              </div>

              {result.invoices.length === 0 && (
                <div className="text-center py-4 text-sm text-gray-500">
                  未在该目录下找到发票 PDF
                </div>
              )}

              {result.invoices.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1.5">将导入的发票</p>
                  <div className="border border-gray-100 rounded-lg overflow-hidden max-h-52 overflow-y-auto">
                    {result.invoices.map((p, i) => (
                      <div
                        key={p}
                        className={`flex items-center gap-2 px-3 py-2 text-xs ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                      >
                        <svg className="w-3.5 h-3.5 flex-shrink-0 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="truncate text-gray-600" title={p}>{p.split('/').pop()}</span>
                        <span className="flex-shrink-0 text-gray-300 truncate text-right" style={{ maxWidth: '120px' }} title={p}>
                          {p.split('/').slice(-3, -1).join('/')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.trip_itineraries.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1.5">将尝试自动绑定的打车行程单</p>
                  <div className="border border-gray-100 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                    {result.trip_itineraries.map((p, i) => (
                      <div
                        key={p}
                        className={`flex items-center gap-2 px-3 py-2 text-xs ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                      >
                        <svg className="w-3.5 h-3.5 flex-shrink-0 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="truncate text-gray-600" title={p}>{p.split('/').pop()}</span>
                        <span className="flex-shrink-0 text-gray-300 truncate text-right" style={{ maxWidth: '120px' }} title={p}>
                          {p.split('/').slice(-3, -1).join('/')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50">
          <button
            onClick={onCancel}
            disabled={importing}
            className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            取消
          </button>
          {!importing && result && (result.invoices.length > 0 || result.trip_itineraries.length > 0) && (
            <button
              onClick={onConfirm}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
            >
              导入 {result.invoices.length} 张发票{result.trip_itineraries.length > 0 ? ` + ${result.trip_itineraries.length} 份行程单` : ''}
            </button>
          )}
          {importing && (
            <button
              disabled
              className="px-4 py-1.5 bg-blue-400 text-white text-sm rounded-md cursor-not-allowed"
            >
              正在导入识别...
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
