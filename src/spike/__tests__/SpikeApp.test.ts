import { describe, expect, test, mock } from 'bun:test'
import {
  generateRows,
  calculateVirtualWindow,
  triggerReadyPing,
} from '../spikeUtils.ts'

describe('Spike production utilities', () => {
  test('generateRows produces exactly 5,000 rows with required fields', () => {
    const rows = generateRows(5000)

    expect(rows.length).toBe(5000)
    expect(rows[0].id).toBe(0)
    expect(rows[0].name).toBe('item_00000.tsx')
    expect(rows[0].size).toBe('1.0 KB')
    expect(rows[0].mtime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)

    expect(rows[4999].id).toBe(4999)
    expect(rows[4999].name).toBe('item_04999.rs')
    expect(rows[4999].size).toBe('4.4 MB')
    expect(rows[4999].mtime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)

    // Validate structure of sample elements
    for (const idx of [0, 100, 2500, 4999]) {
      const row = rows[idx]
      expect(typeof row.id).toBe('number')
      expect(typeof row.name).toBe('string')
      expect(typeof row.size).toBe('string')
      expect(typeof row.mtime).toBe('string')
      expect(row.name).toMatch(/^item_\d{5}\.(tsx|rs|json)$/)
    }
  })

  test('calculateVirtualWindow computes correct slice indices and translateY', () => {
    const rowHeight = 40
    const viewportHeight = 480
    const overscan = 8
    const totalCount = 5000

    // At top (scrollTop = 0)
    const atTop = calculateVirtualWindow(0, viewportHeight, rowHeight, totalCount, overscan)
    expect(atTop.startIndex).toBe(0)
    expect(atTop.endIndex).toBe(20) // (0 + 480) / 40 = 12 + 8 overscan = 20
    expect(atTop.translateY).toBe(0)

    // Mid-scroll (scrollTop = 2000 -> item 50)
    const midScroll = calculateVirtualWindow(2000, viewportHeight, rowHeight, totalCount, overscan)
    expect(midScroll.startIndex).toBe(42) // 50 - 8
    expect(midScroll.endIndex).toBe(70) // 50 + 12 + 8
    expect(midScroll.translateY).toBe(42 * 40)

    // At bottom of list (scrollTop = totalHeight - viewportHeight = 199520)
    const atBottom = calculateVirtualWindow(199520, viewportHeight, rowHeight, totalCount, overscan)
    expect(atBottom.endIndex).toBe(totalCount)
    expect(atBottom.startIndex).toBe(Math.max(0, Math.floor(199520 / 40) - overscan))
  })

  test('triggerReadyPing only calls fetch when ping query param is present and non-empty', async () => {
    const fetchMock = mock(() => Promise.resolve(new Response('ok')))

    // Case 1: no query param
    const res1 = await triggerReadyPing('', fetchMock)
    expect(res1).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(0)

    // Case 2: unrelated query param
    const res2 = await triggerReadyPing('?tab=1&sort=name', fetchMock)
    expect(res2).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(0)

    // Case 3: empty ping param (?ping=)
    const res3 = await triggerReadyPing('?ping=', fetchMock)
    expect(res3).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(0)

    // Case 4: valid ping param
    const res4 = await triggerReadyPing('?ping=http://127.0.0.1:8787/ready', fetchMock)
    expect(res4).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8787/ready')

    // Case 5: fetch rejection is safely caught and returns false
    const failingFetch = mock(() => Promise.reject(new Error('network error')))
    const res5 = await triggerReadyPing('?ping=http://127.0.0.1:8787/ready', failingFetch)
    expect(res5).toBe(false)
    expect(failingFetch).toHaveBeenCalledTimes(1)
  })
})
