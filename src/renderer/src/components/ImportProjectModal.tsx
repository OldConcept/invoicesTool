import React, { useEffect, useState } from 'react'
import { Project } from '../types/invoice'

interface Props {
  count: number
  projects: Project[]
  onCreateProject: (name: string, color: string) => Promise<void>
  onConfirm: (projectTag: string | null) => void
  onClose: () => void
}

export default function ImportProjectModal({
  count,
  projects,
  onCreateProject,
  onConfirm,
  onClose
}: Props): React.JSX.Element {
  const [projectTag, setProjectTag] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectColor, setNewProjectColor] = useState('#3B82F6')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    setProjectTag('')
  }, [count])

  async function handleCreateProject(): Promise<void> {
    const name = newProjectName.trim()
    if (!name) return
    setCreating(true)
    try {
      await onCreateProject(name, newProjectColor)
      setProjectTag(name)
      setNewProjectName('')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">导入项目绑定</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-sm text-gray-600">
            本次将导入 <span className="font-semibold text-gray-900">{count}</span> 份发票，是否统一绑定到某个出差项目？
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">出差项目</label>
            <select
              value={projectTag}
              onChange={(e) => setProjectTag(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">不绑定项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.name}>{project.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">新增项目并选中</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleCreateProject()}
                placeholder="新项目名称"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="color"
                value={newProjectColor}
                onChange={(e) => setNewProjectColor(e.target.value)}
                className="w-10 h-10 border border-gray-200 rounded-lg cursor-pointer"
              />
              <button
                onClick={() => void handleCreateProject()}
                disabled={creating || !newProjectName.trim()}
                className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                {creating ? '新增中...' : '新增'}
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(projectTag || null)}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            开始导入
          </button>
        </div>
      </div>
    </div>
  )
}
