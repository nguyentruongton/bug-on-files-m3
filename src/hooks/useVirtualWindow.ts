import { useEffect, useLayoutEffect, useMemo, useState, type RefObject } from 'react';

const useIsomorphicLayoutEffect =
    typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface VirtualRange {
    startIndex: number;
    endIndex: number;
    topSpacerHeight: number;
    bottomSpacerHeight: number;
    totalHeight: number;
}

export interface UseVirtualWindowOptions {
    containerRef: RefObject<HTMLElement | null>;
    itemCount: number;
    getItemHeight: (index: number) => number;
    overscan?: number;
    topOffset?: number;
    fallbackHeight?: number;
    gapPx?: number;
    rebindKey?: unknown;
}

export interface UseVirtualWindowResult extends VirtualRange {
    offsets: number[];
}

const DEFAULT_GAP_PX = 2;

function findFirstIntersectingIndex(offsets: number[], targetOffset: number): number {
    const itemCount = offsets.length - 1;
    let low = 0;
    let high = itemCount - 1;
    let ans = itemCount - 1;

    while (low <= high) {
        const mid = (low + high) >>> 1;
        if (offsets[mid + 1] > targetOffset) {
            ans = mid;
            high = mid - 1;
        } else {
            low = mid + 1;
        }
    }

    return ans;
}

function findLastIntersectingIndex(offsets: number[], endOffset: number): number {
    const itemCount = offsets.length - 1;
    let low = 0;
    let high = itemCount - 1;
    let ans = 0;

    while (low <= high) {
        const mid = (low + high) >>> 1;
        if (offsets[mid] < endOffset) {
            ans = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return ans;
}

export function calculateVirtualRange(
    offsets: number[],
    totalHeight: number,
    scrollTop: number,
    viewportHeight: number,
    overscan = 6,
    fallbackHeight = 600,
    gapPx = DEFAULT_GAP_PX
): VirtualRange {
    const itemCount = Math.max(0, offsets.length - 1);
    if (itemCount === 0 || totalHeight <= 0) {
        return {
            startIndex: 0,
            endIndex: -1,
            topSpacerHeight: 0,
            bottomSpacerHeight: 0,
            totalHeight: 0,
        };
    }

    const effectiveViewport = viewportHeight > 0 ? viewportHeight : fallbackHeight;
    const safeOverscan = Math.max(0, overscan);
    const maxScroll = Math.max(0, totalHeight - effectiveViewport);
    const visibleStart = Math.max(0, Math.min(scrollTop, maxScroll));
    const visibleEnd = visibleStart + effectiveViewport;

    const rawStart = findFirstIntersectingIndex(offsets, visibleStart);
    const rawEnd = Math.max(rawStart, findLastIntersectingIndex(offsets, visibleEnd));

    const startIndex = Math.max(0, rawStart - safeOverscan);
    const endIndex = Math.min(itemCount - 1, rawEnd + safeOverscan);

    const topSpacerHeight = startIndex > 0 ? Math.max(0, offsets[startIndex] - gapPx) : 0;
    const bottomSpacerHeight =
        endIndex < itemCount - 1 ? Math.max(0, totalHeight - offsets[endIndex + 1]) : 0;

    return {
        startIndex,
        endIndex,
        topSpacerHeight,
        bottomSpacerHeight,
        totalHeight,
    };
}

export function useVirtualWindow({
    containerRef,
    itemCount,
    getItemHeight,
    overscan = 6,
    topOffset = 0,
    fallbackHeight = 600,
    gapPx = DEFAULT_GAP_PX,
    rebindKey,
}: UseVirtualWindowOptions): UseVirtualWindowResult {
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);

    useIsomorphicLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const syncMeasurements = () => {
            setScrollTop(el.scrollTop);
            setViewportHeight(el.clientHeight);
        };

        const handleScroll = () => {
            setScrollTop(el.scrollTop);
        };

        syncMeasurements();
        el.addEventListener('scroll', handleScroll, { passive: true });

        const resizeObserver =
            typeof ResizeObserver !== 'undefined'
                ? new ResizeObserver(() => {
                      setViewportHeight(el.clientHeight);
                  })
                : null;
        resizeObserver?.observe(el);

        return () => {
            el.removeEventListener('scroll', handleScroll);
            resizeObserver?.disconnect();
        };
    }, [containerRef, rebindKey]);

    const { offsets, totalHeight } = useMemo(() => {
        const nextOffsets = new Array<number>(itemCount + 1);
        nextOffsets[0] = 0;
        for (let i = 0; i < itemCount; i++) {
            nextOffsets[i + 1] = nextOffsets[i] + getItemHeight(i);
        }
        const total = itemCount > 0 ? Math.max(0, nextOffsets[itemCount] - gapPx) : 0;
        return { offsets: nextOffsets, totalHeight: total };
    }, [itemCount, getItemHeight, gapPx]);

    const adjustedScrollTop = Math.max(0, scrollTop - topOffset);
    const adjustedViewportHeight =
        viewportHeight > 0 ? Math.max(1, viewportHeight - topOffset) : 0;

    const range = useMemo(
        () =>
            calculateVirtualRange(
                offsets,
                totalHeight,
                adjustedScrollTop,
                adjustedViewportHeight,
                overscan,
                fallbackHeight,
                gapPx
            ),
        [offsets, totalHeight, adjustedScrollTop, adjustedViewportHeight, overscan, fallbackHeight, gapPx]
    );

    return {
        ...range,
        offsets,
    };
}
