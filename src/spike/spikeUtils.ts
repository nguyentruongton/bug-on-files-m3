export interface SpikeRow {
  id: number
  name: string
  size: string
  mtime: string
}

export function generateRows(count: number, baseTime = 1731400000000): SpikeRow[] {
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
  return rows
}

export function calculateVirtualWindow(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  totalCount: number,
  overscan: number,
): { startIndex: number; endIndex: number; translateY: number } {
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const endIndex = Math.min(
    totalCount,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
  )
  const translateY = startIndex * rowHeight
  return { startIndex, endIndex, translateY }
}

export async function triggerReadyPing(
  search: string,
  fetchFn: (url: string) => Promise<unknown> = fetch,
): Promise<boolean> {
  const pingUrl = new URLSearchParams(search).get('ping')
  if (pingUrl) {
    try {
      await fetchFn(pingUrl)
      return true
    } catch (err) {
      console.warn('Ready ping failed:', err)
      return false
    }
  }
  return false
}
