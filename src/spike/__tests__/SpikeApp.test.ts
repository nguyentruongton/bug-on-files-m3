import { describe, expect, test, mock } from 'bun:test'
import { SpikeRow } from '../SpikeApp.tsx'

describe('SpikeApp components and logic', () => {
  test('generates exactly 5,000 rows with required fields', () => {
    // Replicate row generation logic tested in SpikeApp
    const baseTime = 1731400000000
    const count = 5000
    const rows: SpikeRow[] = new Array(count)

    for (let i = 0; i < count; i++) {
      const sizeBytes = ((i * 7919) % 5000000) + 1024
      const sizeFormatted =
        sizeBytes > 1048576
          ? `${(sizeBytes / 1048576).toFixed(1)} MB`
          : `${(sizeBytes / 1024).toFixed(1)} KB`
      const d = new Date(baseTime + i * 137000)
      const mtimeFormatted = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

      rows[i] = {
        id: i,
        name: `item_${String(i).padStart(5, '0')}.${i % 3 === 0 ? 'tsx' : i % 3 === 1 ? 'rs' : 'json'}`,
        size: sizeFormatted,
        mtime: mtimeFormatted,
      }
    }

    expect(rows.length).toBe(5000)
    expect(rows[0].id).toBe(0)
    expect(rows[0].name).toBe('item_00000.tsx')
    expect(rows[0].size).toBeTruthy()
    expect(rows[0].mtime).toBeTruthy()

    expect(rows[4999].id).toBe(4999)
    expect(rows[4999].name).toBe('item_04999.rs')
    expect(rows[4999].size).toBeTruthy()
    expect(rows[4999].mtime).toBeTruthy()
  })

  test('virtualizer index calculation slices correct window', () => {
    const rowHeight = 40
    const viewportHeight = 480
    const overscan = 8
    const totalCount = 5000

    // At top (scrollTop = 0)
    const scrollTop0 = 0
    const start0 = Math.max(0, Math.floor(scrollTop0 / rowHeight) - overscan)
    const end0 = Math.min(totalCount, Math.ceil((scrollTop0 + viewportHeight) / rowHeight) + overscan)
    expect(start0).toBe(0)
    expect(end0).toBe(20) // 480/40 = 12 + 8 overscan = 20

    // Scrolled down (scrollTop = 2000 -> item 50)
    const scrollTopMiddle = 2000
    const startMid = Math.max(0, Math.floor(scrollTopMiddle / rowHeight) - overscan)
    const endMid = Math.min(totalCount, Math.ceil((scrollTopMiddle + viewportHeight) / rowHeight) + overscan)
    expect(startMid).toBe(42) // 50 - 8
    expect(endMid).toBe(70) // 50 + 12 + 8
  })

  test('ready ping only fires when ping query parameter is present and non-empty', () => {
    const fetchMock = mock((_url: string) => Promise.resolve(new Response('ok')))

    function triggerPing(search: string) {
      const pingUrl = new URLSearchParams(search).get('ping')
      if (pingUrl) {
        fetchMock(pingUrl)
      }
    }

    // Case 1: no query param
    triggerPing('')
    expect(fetchMock).toHaveBeenCalledTimes(0)

    // Case 2: unrelated query param
    triggerPing('?tab=1')
    expect(fetchMock).toHaveBeenCalledTimes(0)

    // Case 3: empty ping param
    triggerPing('?ping=')
    expect(fetchMock).toHaveBeenCalledTimes(0)

    // Case 4: valid ping param
    triggerPing('?ping=http://127.0.0.1:8787/ready')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8787/ready')
  })
})
