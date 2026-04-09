import React, { useState } from 'react'
import { useInvoiceStore } from '../stores/invoiceStore'

interface Props {
  onClose: () => void
}

export default function SettingsModal({ onClose }: Props): React.JSX.Element {
  const { settings, saveSettings, projects, loadProjects } = useInvoiceStore()
  const [form, setForm] = useState({ ...settings })
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectColor, setNewProjectColor] = useState('#3B82F6')
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  async function handleSave(): Promise<void> {
    setSaving(true)
    await saveSettings(form)
    setSaving(false)
    onClose()
  }

  async function handleAddProject(): Promise<void> {
    if (!newProjectName.trim()) return
    await window.api.createProject(newProjectName.trim(), newProjectColor)
    await loadProjects()
    setNewProjectName('')
  }

  async function handleDeleteProject(id: string): Promise<void> {
    if (!confirm('确认删除此项目标签？')) return
    await window.api.deleteProject(id)
    await loadProjects()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">设置</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          {/* Python path */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">OCR 设置（本地 Python）</h3>
            <p className="text-xs text-gray-500 mb-2">
              需要安装 Python 依赖：
            </p>
            <pre className="text-xs bg-gray-100 rounded-lg px-3 py-2 mb-3 select-text overflow-x-auto">
              pip install paddleocr paddlepaddle pymupdf
            </pre>
            <label className="block text-xs text-gray-500 mb-1">Python 可执行文件路径</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.pythonPath}
                onChange={(e) => setForm((f) => ({ ...f, pythonPath: e.target.value }))}
                placeholder="python3（留空使用系统默认）"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={async () => {
                  setTesting(true)
                  setTestResult(null)
                  const result = await window.api.runOcr('__test__')
                  setTesting(false)
                  if (result.error?.includes('无法启动') || result.error?.includes('No module')) {
                    setTestResult(`❌ ${result.error}`)
                  } else {
                    setTestResult('✅ Python 环境正常')
                  }
                }}
                disabled={testing}
                className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 whitespace-nowrap"
              >
                {testing ? '检测中...' : '检测'}
              </button>
            </div>
            {testResult && (
              <p className="mt-2 text-xs text-gray-600">{testResult}</p>
            )}
          </section>

          {/* Report settings */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">报销单信息</h3>
            <div className="flex flex-col gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">报销人姓名</label>
                <input
                  type="text"
                  value={form.exporterName}
                  onChange={(e) => setForm((f) => ({ ...f, exporterName: e.target.value }))}
                  placeholder="姓名"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">公司名称</label>
                <input
                  type="text"
                  value={form.companyName}
                  onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
                  placeholder="公司名称"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </section>

          {/* Projects */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">出差项目标签</h3>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddProject()}
                placeholder="新项目名称"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="color"
                value={newProjectColor}
                onChange={(e) => setNewProjectColor(e.target.value)}
                className="w-10 h-9 border border-gray-200 rounded-lg cursor-pointer"
              />
              <button
                onClick={handleAddProject}
                className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
              >
                添加
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {projects.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-1.5 px-2 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                    <span className="text-sm text-gray-700">{p.name}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteProject(p.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              {projects.length === 0 && (
                <p className="text-xs text-gray-400 py-2 text-center">暂无项目标签</p>
              )}
            </div>
          </section>
        </div>

        <div className="px-5 py-4 border-t border-gray-100">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  )
}
