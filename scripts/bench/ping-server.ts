import http from 'node:http'
import fs from 'node:fs'

export interface PingServerOptions {
  port?: number
  hostname?: string
  t0Ms?: number
  t0File?: string
  resultFile?: string
  timeoutMs?: number
  closeExit?: boolean
  onPing?: (elapsedMs: number) => void
}

export function parseT0(t0Ms?: number | string, t0File?: string, fallbackNow = Date.now()): number {
  if (t0File && fs.existsSync(t0File)) {
    try {
      const content = fs.readFileSync(t0File, 'utf-8').trim()
      const parsed = Number.parseInt(content, 10)
      if (!Number.isNaN(parsed) && parsed > 0) {
        return parsed
      }
    } catch {
      // Fall through to other sources
    }
  }

  if (t0Ms !== undefined) {
    const parsed = typeof t0Ms === 'number' ? t0Ms : Number.parseInt(t0Ms, 10)
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }

  return fallbackNow
}

export function calculateElapsedMs(nowMs: number, t0Ms: number): number {
  if (Number.isNaN(t0Ms) || t0Ms <= 0) {
    return 0
  }
  return Math.max(0, Math.round(nowMs - t0Ms))
}

export function getCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'text/plain; charset=utf-8',
  }
}

export function startPingServer(options: PingServerOptions = {}): Promise<{
  server: http.Server
  port: number
  close: () => Promise<void>
}> {
  const port = options.port ?? (process.env.BENCH_PORT ? Number.parseInt(process.env.BENCH_PORT, 10) : 8787)
  const hostname = options.hostname ?? '127.0.0.1'
  const timeoutMs = options.timeoutMs ?? 30000
  let initialT0 = parseT0(options.t0Ms ?? process.env.BENCH_T0_MS, options.t0File ?? process.env.BENCH_T0_FILE)

  return new Promise((resolve, reject) => {
    let resolved = false
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null

    const server = http.createServer((req, res) => {
      const headers = getCorsHeaders()

      if (req.method === 'OPTIONS') {
        res.writeHead(204, headers)
        res.end()
        return
      }

      // Re-check t0File in case T0 was written after server startup
      const finalT0 = parseT0(
        options.t0Ms ?? process.env.BENCH_T0_MS,
        options.t0File ?? process.env.BENCH_T0_FILE,
        initialT0,
      )
      const now = Date.now()
      const elapsed = calculateElapsedMs(now, finalT0)

      res.writeHead(200, headers)
      res.end(`ready startup_ms=${elapsed}`)

      const resultFile = options.resultFile ?? process.env.BENCH_RESULT_FILE
      if (resultFile) {
        try {
          fs.writeFileSync(resultFile, `startup_ms=${elapsed}\n`, 'utf-8')
        } catch (err) {
          console.error(`Failed to write result file ${resultFile}:`, err)
        }
      }

      if (options.onPing) {
        options.onPing(elapsed)
      }

      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
      }

      // Allow response to flush, then close server
      setTimeout(() => {
        server.close(() => {
          if (options.closeExit) {
            process.exit(0)
          }
        })
      }, 50)
    })

    server.on('error', (err) => {
      if (!resolved) {
        resolved = true
        reject(err)
      }
    })

    server.listen(port, hostname, () => {
      resolved = true
      if (timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          server.close()
        }, timeoutMs)
      }

      resolve({
        server,
        port,
        close: () =>
          new Promise<void>((res) => {
            if (timeoutTimer) clearTimeout(timeoutTimer)
            server.close(() => res())
          }),
      })
    })
  })
}

// Standalone execution
if (import.meta.main) {
  const args = process.argv.slice(2)
  let port = 8787
  let t0Arg: number | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = Number.parseInt(args[++i], 10)
    } else if (args[i] === '--t0' && args[i + 1]) {
      t0Arg = Number.parseInt(args[++i], 10)
    }
  }

  startPingServer({
    port,
    t0Ms: t0Arg,
    closeExit: true,
    onPing: (elapsed) => {
      console.log(`startup_ms=${elapsed}`)
    },
  })
    .then(() => {
      console.log(`READY_LISTENING port=${port}`)
    })
    .catch((err) => {
      console.error('Failed to start ping server:', err)
      process.exit(1)
    })
}
