import type { IFile } from '../types/files';
import { normalizePath } from './navigationHistory';
import { isSameOrDescendant } from './pasteRunner';

export const DROP_ACTIVE_CLASS = 'ring-2 ring-inset ring-m3-primary bg-m3-primary-container/35';

export type ResolvedDropTarget =
  | { kind: 'folder'; path: string; source: 'filelist' | 'sidebar' | 'explorer-root' }
  | { kind: 'tab'; tabId: string; path: string }
  | { kind: 'trash'; source: 'sidebar' }
  | { kind: 'trash'; source: 'tab'; tabId: string };

export interface DropElementLike {
  closest(selector: string): DropElementLike | null;
  getAttribute(name: string): string | null;
}

function isValidAbsPath(pathStr: string): boolean {
  return Boolean(pathStr) && pathStr.startsWith('/') && !pathStr.includes('\0');
}

function isValidDestDir(destDir: string): boolean {
  return (
    Boolean(destDir) &&
    !destDir.startsWith('app://') &&
    !destDir.startsWith('search://') &&
    isValidAbsPath(destDir)
  );
}

function getParentDirPath(filePath: string): string {
  const norm = normalizePath(filePath);
  const lastSlash = norm.lastIndexOf('/');
  return lastSlash > 0 ? norm.slice(0, lastSlash) : '/';
}

/**
 * Returns all selected files in `sortedFiles` order when `clickedFile` is part of the selection;
 * otherwise returns only `[clickedFile]`.
 */
export function collectOutboundDragItems(
  clickedFile: IFile,
  sortedFiles: IFile[],
  selectedFiles: Set<string>
): IFile[] {
  if (!selectedFiles.has(clickedFile.path)) {
    return [clickedFile];
  }
  const ordered = sortedFiles.filter((file) => selectedFiles.has(file.path));
  return ordered.length > 0 ? ordered : [clickedFile];
}

/**
 * Filters `paths` down to the items that can actually be moved or copied into `destDir`.
 * Excludes invalid paths, self/ancestor recursion conflicts, and same-parent items.
 */
export function filterActionablePathsForDir(
  paths: string[],
  destDir: string,
  mode: 'move' | 'copy'
): string[] {
  // Both move and copy skip same-parent drops; mode is kept for API symmetry with canDropPathsIntoDir.
  void mode;
  if (!isValidDestDir(destDir)) {
    return [];
  }
  const normDest = normalizePath(destDir);
  return paths.filter((rawPath) => {
    if (!isValidAbsPath(rawPath)) {
      return false;
    }
    const normSrc = normalizePath(rawPath);
    if (isSameOrDescendant(normSrc, normDest)) {
      return false;
    }
    return getParentDirPath(normSrc) !== normDest;
  });
}

/**
 * Returns whether dropping `paths` onto `destDir` is permitted.
 * Rejects the entire batch if any path is invalid or an ancestor/self of `destDir`,
 * while allowing mixed batches where only some items are already in `destDir`.
 */
export function canDropPathsIntoDir(
  paths: string[],
  destDir: string,
  mode: 'move' | 'copy'
): boolean {
  void mode;
  if (paths.length === 0 || !isValidDestDir(destDir)) {
    return false;
  }
  const normDest = normalizePath(destDir);
  let hasActionable = false;
  for (const rawPath of paths) {
    if (!isValidAbsPath(rawPath)) {
      return false;
    }
    const normSrc = normalizePath(rawPath);
    if (isSameOrDescendant(normSrc, normDest)) {
      return false;
    }
    if (getParentDirPath(normSrc) !== normDest) {
      hasActionable = true;
    }
  }
  return hasActionable;
}

function canDropToTrash(draggedPaths: string[], mode: 'move' | 'copy'): boolean {
  return mode === 'move' && draggedPaths.length > 0 && draggedPaths.every(isValidAbsPath);
}

/**
 * Resolves the highest-priority drop target from a hit-tested DOM element.
 * Stops and returns `null` when a higher-priority target (e.g. trash or subfolder row)
 * is hovered but invalid for the current drag rather than falling through to an ancestor.
 */
export function resolveDropTargetFromElement(
  el: DropElementLike | null,
  draggedPaths: string[],
  mode: 'move' | 'copy',
  tabsById: Map<string, { path: string }>
): ResolvedDropTarget | null {
  if (!el) {
    return null;
  }

  const trashEl = el.closest('[data-drop-trash="true"]');
  if (trashEl) {
    return canDropToTrash(draggedPaths, mode) ? { kind: 'trash', source: 'sidebar' } : null;
  }

  const tabEl = el.closest('[data-drop-tab-id]');
  if (tabEl) {
    const tabId = tabEl.getAttribute('data-drop-tab-id');
    if (!tabId) {
      return null;
    }
    const tab = tabsById.get(tabId);
    if (!tab) {
      return null;
    }
    if (tab.path === 'app://trash') {
      return canDropToTrash(draggedPaths, mode) ? { kind: 'trash', source: 'tab', tabId } : null;
    }
    if (tab.path === 'app://dashboard') {
      return null;
    }
    return canDropPathsIntoDir(draggedPaths, tab.path, mode)
      ? { kind: 'tab', tabId, path: tab.path }
      : null;
  }

  const folderEl = el.closest('[data-drop-folder-path]');
  if (folderEl) {
    const folderPath = folderEl.getAttribute('data-drop-folder-path');
    if (!folderPath || !canDropPathsIntoDir(draggedPaths, folderPath, mode)) {
      return null;
    }
    const source = folderEl.closest('[data-drop-sidebar="true"]') ? 'sidebar' : 'filelist';
    return { kind: 'folder', path: folderPath, source };
  }

  const rootEl = el.closest('[data-drop-explorer-root="true"]');
  if (rootEl) {
    if (rootEl.getAttribute('data-search-active') === 'true') {
      return null;
    }
    const explorerPath = rootEl.getAttribute('data-explorer-path');
    if (!explorerPath || !canDropPathsIntoDir(draggedPaths, explorerPath, mode)) {
      return null;
    }
    return { kind: 'folder', path: explorerPath, source: 'explorer-root' };
  }

  return null;
}

/**
 * Converts a drag event position into CSS client coordinates.
 * `wry` forwards GTK3 widget-logical coordinates verbatim, so values are not divided by `devicePixelRatio`.
 */
export function toCssClientPoint(position: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Number.isFinite(position.x) ? position.x : 0,
    y: Number.isFinite(position.y) ? position.y : 0,
  };
}

/**
 * Computes the vertical scroll delta for edge auto-scrolling inside a scroll container.
 */
export function computeAutoScrollDelta(
  pointerY: number,
  rectTop: number,
  rectBottom: number,
  edgeZonePx = 48,
  maxSpeedPx = 12
): number {
  if (
    !Number.isFinite(pointerY) ||
    !Number.isFinite(rectTop) ||
    !Number.isFinite(rectBottom) ||
    !Number.isFinite(edgeZonePx) ||
    !Number.isFinite(maxSpeedPx)
  ) {
    return 0;
  }
  const height = rectBottom - rectTop;
  if (height <= 0 || edgeZonePx <= 0 || maxSpeedPx <= 0) {
    return 0;
  }
  if (pointerY < rectTop || pointerY > rectBottom) {
    return 0;
  }

  const effectiveZone = Math.min(edgeZonePx, height / 2);
  const distFromTop = pointerY - rectTop;
  if (distFromTop < effectiveZone) {
    const intensity = (effectiveZone - distFromTop) / effectiveZone;
    return -(intensity * maxSpeedPx);
  }

  const distFromBottom = rectBottom - pointerY;
  if (distFromBottom < effectiveZone) {
    const intensity = (effectiveZone - distFromBottom) / effectiveZone;
    return intensity * maxSpeedPx;
  }

  return 0;
}
