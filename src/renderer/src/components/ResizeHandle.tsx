import React, { useCallback, useRef } from 'react'

interface Props {
  onResize: (delta: number) => void
}

export default function ResizeHandle({ onResize }: Props): React.JSX.Element {
  const dragging = useRef(false)
  const lastX = useRef(0)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      lastX.current = e.clientX

      const onMove = (ev: MouseEvent): void => {
        if (!dragging.current) return
        onResize(ev.clientX - lastX.current)
        lastX.current = ev.clientX
      }

      const onUp = (): void => {
        dragging.current = false
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [onResize]
  )

  return (
    <div
      onMouseDown={onMouseDown}
      className="w-1 flex-shrink-0 cursor-col-resize group relative hover:bg-blue-400 transition-colors z-10"
      style={{ background: 'transparent' }}
    >
      {/* Wider invisible hit area */}
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  )
}
