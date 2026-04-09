import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import path from 'path'
import { app } from 'electron'

const SCRIPT_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'scripts', 'ocr.py')
  : path.join(app.getAppPath(), 'scripts', 'ocr.py')

type OcrResult = { success: boolean; data?: Record<string, unknown>; error?: string }
type PendingResolver = (result: OcrResult) => void

// ---------------------------------------------------------------------------
// Persistent OCR process
// ---------------------------------------------------------------------------

let proc: ChildProcessWithoutNullStreams | null = null
let pythonExe = 'python3'
let ready = false
let buffer = ''
const pending = new Map<string, PendingResolver>()
let reqCounter = 0

function startProcess(): Promise<void> {
  return new Promise((resolve, reject) => {
    proc = spawn(pythonExe, [SCRIPT_PATH, '--server'], {
      env: { ...process.env, PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True' }
    })

    // Parse newline-delimited JSON from stdout
    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''           // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const msg = JSON.parse(trimmed)

          if (msg._ready) {
            ready = true
            resolve()
            return
          }

          if (msg._init_error) {
            reject(new Error(msg._init_error))
            return
          }

          // Regular result
          const id: string = msg.id ?? ''
          const resolver = pending.get(id)
          if (resolver) {
            pending.delete(id)
            if (msg.error) {
              resolver({ success: false, error: msg.error })
            } else {
              resolver({ success: true, data: msg })
            }
          }
        } catch {
          // ignore unparseable lines
        }
      }
    })

    proc.on('error', (err) => {
      ready = false
      proc = null
      // Reject all pending
      for (const [, resolver] of pending) {
        resolver({ success: false, error: `Python 进程错误: ${err.message}` })
      }
      pending.clear()
      reject(err)
    })

    proc.on('close', (code) => {
      ready = false
      proc = null
      // Reject any still-pending requests
      for (const [, resolver] of pending) {
        resolver({ success: false, error: `Python 进程意外退出（码 ${code}）` })
      }
      pending.clear()
    })

    // Timeout: if model loading takes too long
    setTimeout(() => {
      if (!ready) {
        reject(new Error('OCR 进程启动超时（60s），请检查 PaddleOCR 是否正确安装'))
      }
    }, 60_000)
  })
}

async function ensureReady(): Promise<void> {
  if (proc && ready) return
  if (proc) {
    // Still starting up — wait a bit and retry
    await new Promise((r) => setTimeout(r, 500))
    return ensureReady()
  }
  await startProcess()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Call this when settings change so the new python path takes effect. */
export function setPythonPath(p: string): void {
  const next = p || 'python3'
  if (next !== pythonExe) {
    pythonExe = next
    stopOcrProcess()   // will restart with new path on next call
  }
}

export function stopOcrProcess(): void {
  if (proc) {
    proc.kill()
    proc = null
    ready = false
    buffer = ''
    pending.clear()
  }
}

export function scanFolder(
  folderPath: string,
  pythonPath: string = 'python3'
): Promise<{ total: number; invoices: string[]; non_invoices: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, [SCRIPT_PATH, '--scan', folderPath], {
      env: { ...process.env, PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True' }
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('close', (code) => {
      try {
        const result = JSON.parse(stdout.trim())
        if (result.error) reject(new Error(result.error))
        else resolve(result)
      } catch {
        reject(new Error(stderr || `scan exited with code ${code}`))
      }
    })
    child.on('error', reject)
    // Allow up to 2 minutes for large directories
    setTimeout(() => reject(new Error('扫描超时（120s）')), 120_000)
  })
}

export async function runOcr(filePath: string): Promise<OcrResult> {
  // Special "test" invocation from settings page
  if (filePath === '__test__') {
    try {
      await ensureReady()
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  try {
    await ensureReady()
  } catch (err) {
    return {
      success: false,
      error: `无法启动 Python: ${err instanceof Error ? err.message : String(err)}\n请在设置中确认 Python 路径正确，并已安装 paddleocr`
    }
  }

  return new Promise((resolve) => {
    const id = String(++reqCounter)
    pending.set(id, resolve)

    const req = JSON.stringify({ id, path: filePath }) + '\n'
    proc!.stdin.write(req)

    // Per-request timeout (30s per invoice)
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        resolve({ success: false, error: '识别超时（30s），发票可能过于复杂' })
      }
    }, 30_000)
  })
}
