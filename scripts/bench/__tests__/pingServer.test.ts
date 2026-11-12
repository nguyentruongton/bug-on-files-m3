import { describe, it, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  parseT0,
  calculateElapsedMs,
  getCorsHeaders,
  startPingServer,
} from '../ping-server'

describe('ping-server bench utility', () => {
  it('calculateElapsedMs correctly computes elapsed time without negative values', () => {
    expect(calculateElapsedMs(1000, 500)).toBe(500)
    expect(calculateElapsedMs(500, 1000)).toBe(0)
    expect(calculateElapsedMs(1000, 0)).toBe(0)
    expect(calculateElapsedMs(1000, Number.NaN)).toBe(0)
  })

  it('parseT0 parses numeric argument or file content', () => {
    expect(parseT0(12345)).toBe(12345)
    expect(parseT0('67890')).toBe(67890)

    const tmpFile = path.join(os.tmpdir(), `bench_t0_test_${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, '999999\n')
    try {
      expect(parseT0(undefined, tmpFile)).toBe(999999)
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
    }
  })

  it('getCorsHeaders returns wildcard origin and methods', () => {
    const headers = getCorsHeaders()
    expect(headers['Access-Control-Allow-Origin']).toBe('*')
    expect(headers['Access-Control-Allow-Methods']).toContain('GET')
    expect(headers['Access-Control-Allow-Methods']).toContain('OPTIONS')
  })

  it('startPingServer responds to ping, executes onPing, and writes resultFile', async () => {
    const tmpResult = path.join(os.tmpdir(), `bench_res_test_${Date.now()}.txt`)
    const port = 8799
    let recordedElapsed = -1

    const t0 = Date.now() - 150
    const serverInstance = await startPingServer({
      port,
      t0Ms: t0,
      resultFile: tmpResult,
      onPing: (elapsed) => {
        recordedElapsed = elapsed
      },
    })

    try {
      // Send OPTIONS preflight
      const optRes = await fetch(`http://127.0.0.1:${port}/ready`, { method: 'OPTIONS' })
      expect(optRes.status).toBe(204)
      expect(optRes.headers.get('access-control-allow-origin')).toBe('*')

      // Send GET ping
      const getRes = await fetch(`http://127.0.0.1:${port}/ready`)
      expect(getRes.status).toBe(200)
      const text = await getRes.text()
      expect(text).toContain('ready startup_ms=')

      expect(recordedElapsed).toBeGreaterThanOrEqual(140)

      // Allow file write
      await new Promise((r) => setTimeout(r, 50))
      expect(fs.existsSync(tmpResult)).toBe(true)
      const content = fs.readFileSync(tmpResult, 'utf-8')
      expect(content).toContain(`startup_ms=${recordedElapsed}`)
    } finally {
      await serverInstance.close()
      if (fs.existsSync(tmpResult)) fs.unlinkSync(tmpResult)
    }
  })
})
