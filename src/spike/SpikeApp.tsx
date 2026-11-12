import { useState, useEffect, useRef, useMemo } from 'react'
import {
  MD3ThemeProvider,
  Button,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
  ShapeMedia,
  FAST_SPATIAL_SPRING,
} from '@bug-on/m3-expressive'
import { motion } from 'motion/react'
import {
  type SpikeRow,
  calculateVirtualWindow,
  generateRows,
  triggerReadyPing,
} from './spikeUtils.ts'

export type { SpikeRow }

const ROW_HEIGHT = 40
const VIEWPORT_HEIGHT = 480
const OVERSCAN = 8

function VirtualList({ items }: { items: SpikeRow[] }) {
  const [scrollTop, setScrollTop] = useState(0)
  const totalHeight = items.length * ROW_HEIGHT

  const { startIndex, endIndex, translateY } = calculateVirtualWindow(
    scrollTop,
    VIEWPORT_HEIGHT,
    ROW_HEIGHT,
    items.length,
    OVERSCAN,
  )
  const visibleItems = items.slice(startIndex, endIndex)

  return (
    <div
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="overflow-y-auto border border-outline-variant rounded-m3-md bg-surface-container-low"
      style={{ height: `${VIEWPORT_HEIGHT}px` }}
      data-testid="virtual-list-container"
    >
      <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            transform: `translateY(${translateY}px)`,
          }}
        >
          {visibleItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between px-4 text-sm border-b border-surface-container hover:bg-surface-container transition-colors"
              style={{ height: `${ROW_HEIGHT}px` }}
              data-testid={`row-${item.id}`}
            >
              <span className="font-mono text-on-surface truncate w-1/2">{item.name}</span>
              <span className="text-on-surface-variant text-xs w-1/4 text-right">{item.size}</span>
              <span className="text-on-surface-variant text-xs font-mono w-1/4 text-right">
                {item.mtime}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SpikeContent() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [springCount, setSpringCount] = useState(0)
  const pingSentRef = useRef(false)
  const rows = useMemo(() => generateRows(5000), [])

  useEffect(() => {
    if (pingSentRef.current) return
    pingSentRef.current = true

    triggerReadyPing(window.location.search)
  }, [])

  return (
    <div className="min-h-screen bg-background text-on-background p-6 flex flex-col gap-6 max-w-5xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-outline-variant pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Material 3 Expressive Spike</h1>
          <p className="text-sm text-on-surface-variant">
            Virtual list benchmark (5,000 items) + M3 Expressive Components
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Library Button opening Library Dialog */}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button colorStyle="filled">Open M3 Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Material 3 Expressive Dialog</DialogTitle>
              </DialogHeader>
              <DialogBody>
                <p className="text-on-surface-variant text-sm">
                  This dialog is rendered using <code>@bug-on/m3-expressive</code> compound dialog
                  components with spring animation and dynamic tokens.
                </p>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button colorStyle="text">Close</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {/* Interactive Animated Shape and Physics Spring Row */}
      <section className="flex flex-wrap items-center gap-8 p-4 bg-surface-container rounded-m3-lg border border-outline-variant">
        <div className="flex items-center gap-4">
          {/* Animated Shape Morphing Element from @bug-on/m3-expressive */}
          <ShapeMedia
            shape="circle"
            morphTo="flower"
            morphOn="hover"
            width={72}
            height={72}
            className="bg-primary flex items-center justify-center text-on-primary cursor-pointer shadow-md select-none"
            aria-label="Morphing shape"
          >
            <span className="text-xs font-semibold">Hover</span>
          </ShapeMedia>
          <div>
            <div className="text-sm font-medium">ShapeMedia Morph</div>
            <div className="text-xs text-on-surface-variant">
              Hover to morph shape: circle &rarr; flower
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Physics Spring Element using FAST_SPATIAL_SPRING from library */}
          <motion.button
            type="button"
            onClick={() => setSpringCount((c) => c + 1)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.92 }}
            animate={{ rotate: springCount * 45 }}
            transition={FAST_SPATIAL_SPRING}
            className="h-[72px] px-5 rounded-m3-md bg-secondary-container text-on-secondary-container flex flex-col items-center justify-center font-medium shadow-sm cursor-pointer select-none border border-outline-variant"
          >
            <span className="text-xs font-semibold">Spring Motion</span>
            <span className="text-xs text-on-surface-variant">Clicks: {springCount}</span>
          </motion.button>
          <div>
            <div className="text-sm font-medium">FAST_SPATIAL_SPRING</div>
            <div className="text-xs text-on-surface-variant">Click or hover to trigger physics spring</div>
          </div>
        </div>
      </section>

      {/* Virtualized List of 5,000 items */}
      <section className="flex flex-col gap-2 flex-1">
        <div className="flex items-center justify-between text-xs text-on-surface-variant px-1 font-medium">
          <span>Virtual List: 5,000 rows (fixed 40px height)</span>
          <span>Columns: Name &bull; Size &bull; Modified</span>
        </div>
        <VirtualList items={rows} />
      </section>
    </div>
  )
}

export function SpikeApp() {
  return (
    <MD3ThemeProvider defaultMode="system" sourceColor="#6750A4" variant="expressive">
      <SpikeContent />
    </MD3ThemeProvider>
  )
}
