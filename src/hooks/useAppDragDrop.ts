import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { DragDropEventPayload } from '../api/types';
import type { IFile } from '../types/files';
import {
  computeAutoScrollDelta,
  filterActionablePathsForDir,
  resolveDropTargetFromElement,
  toCssClientPoint,
  type DropElementLike,
  type ResolvedDropTarget,
} from '../utils/dropTargetUtils';
import { processInboundDrop } from '../utils/explorerTabUtils';
import type { PasteResult } from '../utils/pasteRunner';

const SPRING_LOAD_DELAY_MS = 550;
const SAFETY_TIMEOUT_MS = 15_000;

export interface UseAppDragDropOptions {
  tabs: Array<{ id: string; path: string }>;
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  transferFiles: (
    files: IFile[],
    operation: 'copy' | 'cut',
    destDir: string
  ) => Promise<PasteResult>;
  onTrashItems: (items: IFile[]) => void;
  onExternalImportComplete: (destDir: string, count: number) => void;
  showToast: (msg: string, type: 'info' | 'error' | 'success') => void;
}

interface InternalDragSession {
  items: IFile[];
  paths: string[];
  sourceDir: string;
}

interface ScrollContainerElement extends DropElementLike {
  getBoundingClientRect?: () => { top: number; bottom: number };
  scrollBy?: (x: number, y: number) => void;
  scrollTop?: number;
}

interface AutoScrollState {
  element: ScrollContainerElement;
  pointerY: number;
}

function areDropTargetsEqual(
  a: ResolvedDropTarget | null,
  b: ResolvedDropTarget | null
): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'trash') return true;
  if (a.kind === 'tab' && b.kind === 'tab') {
    return a.tabId === b.tabId && a.path === b.path;
  }
  if (a.kind === 'folder' && b.kind === 'folder') {
    return a.path === b.path && a.source === b.source;
  }
  return false;
}

function isDirectoryTabPath(path: string): boolean {
  return Boolean(path) && !path.startsWith('app://') && !path.startsWith('search://');
}

function hitTestElement(x: number, y: number): DropElementLike | null {
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
    return null;
  }
  return document.elementFromPoint(x, y) as unknown as DropElementLike | null;
}

function buildTabsMap(tabs: Array<{ id: string; path: string }>): Map<string, { path: string }> {
  return new Map(tabs.map((tab) => [tab.id, { path: tab.path }]));
}

/**
 * Coordinates native outbound drags, inbound external drops, internal target resolution,
 * 550ms spring-loaded tab switching, and edge auto-scrolling at the app root.
 */
export function useAppDragDrop(options: UseAppDragDropOptions): {
  isDragging: boolean;
  activeDropTarget: ResolvedDropTarget | null;
  startOutboundDrag: (items: IFile[], sourceDir: string) => Promise<void>;
} {
  const [isDragging, setIsDragging] = useState(false);
  const [activeDropTarget, setActiveDropTarget] = useState<ResolvedDropTarget | null>(null);

  const activeDropTargetRef = useRef<ResolvedDropTarget | null>(null);
  const internalSessionRef = useRef<InternalDragSession | null>(null);
  const lastInboundPathsRef = useRef<string[]>([]);
  const springLoadRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    tabId: string | null;
  }>({ timer: null, tabId: null });
  const autoScrollRafRef = useRef<number | null>(null);
  const autoScrollStateRef = useRef<AutoScrollState | null>(null);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const clearSafetyTimer = useCallback(() => {
    if (safetyTimerRef.current !== null) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  }, []);

  const clearSpringLoadTimer = useCallback(() => {
    if (springLoadRef.current.timer !== null) {
      clearTimeout(springLoadRef.current.timer);
    }
    springLoadRef.current = { timer: null, tabId: null };
  }, []);

  const stopAutoScroll = useCallback(() => {
    autoScrollStateRef.current = null;
    if (autoScrollRafRef.current !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(autoScrollRafRef.current);
      }
      autoScrollRafRef.current = null;
    }
  }, []);

  const updateActiveDropTarget = useCallback((next: ResolvedDropTarget | null) => {
    if (areDropTargetsEqual(activeDropTargetRef.current, next)) {
      return;
    }
    activeDropTargetRef.current = next;
    if (isMountedRef.current) {
      setActiveDropTarget(next);
    }
  }, []);

  const resetDragState = useCallback(() => {
    internalSessionRef.current = null;
    lastInboundPathsRef.current = [];
    clearSafetyTimer();
    clearSpringLoadTimer();
    stopAutoScroll();
    updateActiveDropTarget(null);
    if (isMountedRef.current) {
      setIsDragging(false);
    }
  }, [clearSafetyTimer, clearSpringLoadTimer, stopAutoScroll, updateActiveDropTarget]);

  const armSafetyTimer = useCallback(() => {
    clearSafetyTimer();
    safetyTimerRef.current = setTimeout(() => {
      safetyTimerRef.current = null;
      resetDragState();
    }, SAFETY_TIMEOUT_MS);
  }, [clearSafetyTimer, resetDragState]);

  const updateSpringLoad = useCallback(
    (target: ResolvedDropTarget | null) => {
      const currentOpts = optionsRef.current;
      if (
        target?.kind === 'tab' &&
        target.tabId !== currentOpts.activeTabId &&
        isDirectoryTabPath(target.path)
      ) {
        if (springLoadRef.current.tabId === target.tabId) {
          return;
        }
        clearSpringLoadTimer();
        const targetTabId = target.tabId;
        const timer = setTimeout(() => {
          springLoadRef.current = { timer: null, tabId: null };
          const latest = optionsRef.current;
          const tab = latest.tabs.find((t) => t.id === targetTabId);
          if (tab && tab.id !== latest.activeTabId && isDirectoryTabPath(tab.path)) {
            latest.onSelectTab(targetTabId);
          }
        }, SPRING_LOAD_DELAY_MS);
        springLoadRef.current = { timer, tabId: targetTabId };
        return;
      }

      clearSpringLoadTimer();
    },
    [clearSpringLoadTimer]
  );

  const updateAutoScroll = useCallback(
    (hitEl: DropElementLike | null, pointerY: number) => {
      const scrollContainer = hitEl?.closest(
        '[data-drop-scroll-container="true"]'
      ) as ScrollContainerElement | null;

      if (!scrollContainer || typeof scrollContainer.getBoundingClientRect !== 'function') {
        stopAutoScroll();
        return;
      }

      const rect = scrollContainer.getBoundingClientRect();
      const delta = computeAutoScrollDelta(pointerY, rect.top, rect.bottom);
      if (delta === 0) {
        stopAutoScroll();
        return;
      }

      autoScrollStateRef.current = { element: scrollContainer, pointerY };
      if (autoScrollRafRef.current !== null || typeof requestAnimationFrame !== 'function') {
        return;
      }

      const tick = () => {
        const state = autoScrollStateRef.current;
        if (!state || typeof state.element.getBoundingClientRect !== 'function') {
          autoScrollRafRef.current = null;
          return;
        }
        const currentRect = state.element.getBoundingClientRect();
        const step = computeAutoScrollDelta(
          state.pointerY,
          currentRect.top,
          currentRect.bottom
        );
        if (step === 0) {
          autoScrollStateRef.current = null;
          autoScrollRafRef.current = null;
          return;
        }
        if (typeof state.element.scrollBy === 'function') {
          state.element.scrollBy(0, step);
        } else if (typeof state.element.scrollTop === 'number') {
          state.element.scrollTop += step;
        }
        autoScrollRafRef.current = requestAnimationFrame(tick);
      };

      autoScrollRafRef.current = requestAnimationFrame(tick);
    },
    [stopAutoScroll]
  );

  const startOutboundDrag = useCallback(
    async (items: IFile[], sourceDir: string): Promise<void> => {
      if (items.length === 0 || !api?.startNativeDrag) {
        return;
      }

      clearSpringLoadTimer();
      stopAutoScroll();
      updateActiveDropTarget(null);

      const paths = items.map((item) => item.path);
      const session: InternalDragSession = { items, paths, sourceDir };
      internalSessionRef.current = session;
      lastInboundPathsRef.current = [];
      if (isMountedRef.current) {
        setIsDragging(true);
      }
      armSafetyTimer();

      try {
        const started = await api.startNativeDrag({
          paths,
          label: items[0].name,
          isDirectory: items.every((item) => item.isDirectory),
        });
        if (!started && internalSessionRef.current === session) {
          resetDragState();
        }
      } catch (err) {
        console.error('Failed to start native drag:', err);
        if (internalSessionRef.current === session) {
          resetDragState();
        }
      }
    },
    [armSafetyTimer, clearSpringLoadTimer, resetDragState, stopAutoScroll, updateActiveDropTarget]
  );

  useEffect(() => {
    isMountedRef.current = true;

    const handleHover = (event: DragDropEventPayload) => {
      const session = internalSessionRef.current;
      if (!session) {
        if (event.type === 'enter') {
          lastInboundPathsRef.current = event.paths ?? [];
        } else if (event.paths && event.paths.length > 0) {
          lastInboundPathsRef.current = event.paths;
        }
      }

      if (isMountedRef.current) {
        setIsDragging(true);
      }
      armSafetyTimer();

      if (!event.position) {
        updateActiveDropTarget(null);
        clearSpringLoadTimer();
        stopAutoScroll();
        return;
      }

      const mode: 'move' | 'copy' = session ? 'move' : 'copy';
      const draggedPaths = session ? session.paths : lastInboundPathsRef.current;
      const point = toCssClientPoint(event.position);
      const hitEl = hitTestElement(point.x, point.y);
      const target = resolveDropTargetFromElement(
        hitEl,
        draggedPaths,
        mode,
        buildTabsMap(optionsRef.current.tabs)
      );

      updateActiveDropTarget(target);
      updateSpringLoad(target);
      updateAutoScroll(hitEl, point.y);
    };

    const handleDrop = (event: DragDropEventPayload) => {
      const session = internalSessionRef.current;
      const fallbackTarget = activeDropTargetRef.current;
      const inboundPaths =
        event.paths && event.paths.length > 0 ? event.paths : lastInboundPathsRef.current;
      const mode: 'move' | 'copy' = session ? 'move' : 'copy';
      const draggedPaths = session ? session.paths : inboundPaths;

      let target: ResolvedDropTarget | null = null;
      if (event.position) {
        const point = toCssClientPoint(event.position);
        const hitEl = hitTestElement(point.x, point.y);
        target = resolveDropTargetFromElement(
          hitEl,
          draggedPaths,
          mode,
          buildTabsMap(optionsRef.current.tabs)
        );
      } else {
        target = fallbackTarget;
      }

      resetDragState();

      if (!target) {
        return;
      }

      const currentOpts = optionsRef.current;

      if (target.kind === 'trash') {
        if (session) {
          currentOpts.onTrashItems(session.items);
        }
        return;
      }

      if (session) {
        const actionablePaths = filterActionablePathsForDir(session.paths, target.path, 'move');
        if (actionablePaths.length === 0) {
          return;
        }
        const actionableSet = new Set(actionablePaths);
        const seen = new Set<string>();
        const actionableItems = session.items.filter((item) => {
          if (!actionableSet.has(item.path) || seen.has(item.path)) {
            return false;
          }
          seen.add(item.path);
          return true;
        });
        if (actionableItems.length === 0) {
          return;
        }
        void currentOpts.transferFiles(actionableItems, 'cut', target.path).catch((err) => {
          console.error('Internal drag transfer failed:', err);
          if (isMountedRef.current) {
            optionsRef.current.showToast('Failed to move items', 'error');
          }
        });
        return;
      }

      const actionablePaths = filterActionablePathsForDir(draggedPaths, target.path, 'copy');
      if (actionablePaths.length === 0) {
        return;
      }

      const destDir = target.path;
      void processInboundDrop(actionablePaths, destDir, false, {
        exists: (p) => api.exists(p),
        copyFile: (src, dest) => api.copyFile(src, dest),
      })
        .then((count) => {
          if (!isMountedRef.current || count <= 0) {
            return;
          }
          optionsRef.current.showToast(
            `Imported ${count} file${count === 1 ? '' : 's'}`,
            'success'
          );
          optionsRef.current.onExternalImportComplete(destDir, count);
        })
        .catch((err) => {
          console.error('Inbound drop failed:', err);
          if (isMountedRef.current) {
            optionsRef.current.showToast('Failed to import dropped files', 'error');
          }
        });
    };

    const unsubDragDrop = api?.onDragDrop?.((event) => {
      if (event.type === 'enter' || event.type === 'over') {
        handleHover(event);
      } else if (event.type === 'leave') {
        updateActiveDropTarget(null);
        clearSpringLoadTimer();
        stopAutoScroll();
        if (!internalSessionRef.current) {
          lastInboundPathsRef.current = [];
          clearSafetyTimer();
          if (isMountedRef.current) {
            setIsDragging(false);
          }
        }
      } else if (event.type === 'drop') {
        handleDrop(event);
      }
    });

    const unsubNativeDragEnd = api?.onNativeDragEnd?.(() => {
      resetDragState();
    });

    return () => {
      isMountedRef.current = false;
      unsubDragDrop?.();
      unsubNativeDragEnd?.();
      internalSessionRef.current = null;
      lastInboundPathsRef.current = [];
      activeDropTargetRef.current = null;
      clearSafetyTimer();
      clearSpringLoadTimer();
      stopAutoScroll();
    };
  }, [
    armSafetyTimer,
    clearSafetyTimer,
    clearSpringLoadTimer,
    resetDragState,
    stopAutoScroll,
    updateActiveDropTarget,
    updateAutoScroll,
    updateSpringLoad,
  ]);

  return {
    isDragging,
    activeDropTarget,
    startOutboundDrag,
  };
}
