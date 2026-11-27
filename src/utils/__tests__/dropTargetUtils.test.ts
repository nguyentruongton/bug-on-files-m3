import { describe, expect, test } from 'bun:test';
import type { IFile } from '../../types/files';
import {
  type DropElementLike,
  canDropPathsIntoDir,
  collectOutboundDragItems,
  computeAutoScrollDelta,
  filterActionablePathsForDir,
  resolveDropTargetFromElement,
  toCssClientPoint,
} from '../dropTargetUtils';

function makeFile(path: string, isDirectory = false): IFile {
  const name = path.split('/').filter(Boolean).pop() ?? path;
  return {
    name,
    path,
    isDirectory,
    size: isDirectory ? 0 : 128,
    mtime: new Date('2026-11-26T10:00:00Z'),
  };
}

interface MockNode {
  attrs?: Record<string, string>;
  parent?: MockNode | null;
}

function makeElement(node: MockNode): DropElementLike {
  const matchesSelector = (target: MockNode, selector: string): boolean => {
    const attrs = target.attrs ?? {};
    if (selector === '[data-drop-trash="true"]') {
      return attrs['data-drop-trash'] === 'true';
    }
    if (selector === '[data-drop-tab-id]') {
      return typeof attrs['data-drop-tab-id'] === 'string';
    }
    if (selector === '[data-drop-folder-path]') {
      return typeof attrs['data-drop-folder-path'] === 'string';
    }
    if (selector === '[data-drop-sidebar="true"]') {
      return attrs['data-drop-sidebar'] === 'true';
    }
    if (selector === '[data-drop-explorer-root="true"]') {
      return attrs['data-drop-explorer-root'] === 'true';
    }
    return false;
  };

  const wrap = (current: MockNode): DropElementLike => ({
    closest(selector: string): DropElementLike | null {
      let cursor: MockNode | null | undefined = current;
      while (cursor) {
        if (matchesSelector(cursor, selector)) {
          return wrap(cursor);
        }
        cursor = cursor.parent;
      }
      return null;
    },
    getAttribute(name: string): string | null {
      return current.attrs?.[name] ?? null;
    },
  });

  return wrap(node);
}

describe('collectOutboundDragItems', () => {
  const f1 = makeFile('/home/u/a.txt');
  const f2 = makeFile('/home/u/b.txt');
  const f3 = makeFile('/home/u/c.txt');
  const sortedFiles = [f1, f2, f3];

  test('returns all selected items in sortedFiles order when clickedFile is selected', () => {
    const selected = new Set<string>([f3.path, f1.path]);
    const result = collectOutboundDragItems(f3, sortedFiles, selected);
    expect(result).toEqual([f1, f3]);
  });

  test('returns only [clickedFile] when clickedFile is not in selectedFiles', () => {
    const selected = new Set<string>([f1.path, f3.path]);
    const result = collectOutboundDragItems(f2, sortedFiles, selected);
    expect(result).toEqual([f2]);
  });

  test('falls back to [clickedFile] when selectedFiles is empty', () => {
    const result = collectOutboundDragItems(f2, sortedFiles, new Set());
    expect(result).toEqual([f2]);
  });
});

describe('canDropPathsIntoDir & filterActionablePathsForDir', () => {
  test('rejects empty paths, virtual destinations, relative paths, and NUL paths', () => {
    expect(canDropPathsIntoDir([], '/home/u/Dest', 'move')).toBe(false);
    expect(canDropPathsIntoDir(['/home/u/a.txt'], '', 'move')).toBe(false);
    expect(canDropPathsIntoDir(['/home/u/a.txt'], 'app://trash', 'move')).toBe(false);
    expect(canDropPathsIntoDir(['/home/u/a.txt'], 'app://dashboard', 'copy')).toBe(false);
    expect(canDropPathsIntoDir(['/home/u/a.txt'], 'search://docs', 'move')).toBe(false);
    expect(canDropPathsIntoDir(['relative/a.txt'], '/home/u/Dest', 'move')).toBe(false);
    expect(canDropPathsIntoDir(['/home/u/a\0.txt'], '/home/u/Dest', 'copy')).toBe(false);

    expect(filterActionablePathsForDir(['relative/a.txt', '/home/u/a\0.txt'], '/home/u/Dest', 'copy')).toEqual([]);
    expect(filterActionablePathsForDir(['/home/u/a.txt'], 'app://trash', 'move')).toEqual([]);
    expect(filterActionablePathsForDir(['/home/u/a.txt'], 'search://docs', 'move')).toEqual([]);
  });

  test('rejects self and descendant drops for any dragged directory', () => {
    expect(canDropPathsIntoDir(['/home/u/Docs'], '/home/u/Docs', 'move')).toBe(false);
    expect(canDropPathsIntoDir(['/home/u/Docs'], '/home/u/Docs/Sub', 'move')).toBe(false);
    expect(canDropPathsIntoDir(['/home/u/Docs/', '/home/u/other.txt'], '/home/u/Docs/Sub/', 'copy')).toBe(false);
    expect(filterActionablePathsForDir(['/home/u/Docs', '/home/u/other.txt'], '/home/u/Docs/Sub', 'move')).toEqual([
      '/home/u/other.txt',
    ]);
  });

  test('rejects when every path already has destDir as its parent', () => {
    expect(canDropPathsIntoDir(['/home/u/a.txt', '/home/u/b.txt'], '/home/u', 'move')).toBe(false);
    expect(canDropPathsIntoDir(['/home/u/a.txt'], '/home/u/', 'move')).toBe(false);
    expect(canDropPathsIntoDir(['/home/u/a.txt'], '/home/u', 'copy')).toBe(false);
    expect(filterActionablePathsForDir(['/home/u/a.txt'], '/home/u/', 'move')).toEqual([]);
  });

  test('allows mixed valid + same-folder batch and filters out only same-folder items (Review Focus #1)', () => {
    const paths = ['/home/u/Docs/a.txt', '/home/u/a.txt'];
    expect(canDropPathsIntoDir(paths, '/home/u', 'move')).toBe(true);
    expect(filterActionablePathsForDir(paths, '/home/u', 'move')).toEqual(['/home/u/Docs/a.txt']);

    expect(canDropPathsIntoDir(paths, '/home/u', 'copy')).toBe(true);
    expect(filterActionablePathsForDir(paths, '/home/u', 'copy')).toEqual(['/home/u/Docs/a.txt']);
  });

  test('allows dropping paths from another directory into root /', () => {
    expect(canDropPathsIntoDir(['/home/u/a.txt'], '/', 'move')).toBe(true);
    expect(filterActionablePathsForDir(['/home/u/a.txt', '/top.txt'], '/', 'move')).toEqual(['/home/u/a.txt']);
  });
});

describe('resolveDropTargetFromElement', () => {
  const tabsById = new Map<string, { path: string }>([
    ['tab-docs', { path: '/home/u/Docs' }],
    ['tab-trash', { path: 'app://trash' }],
    ['tab-dash', { path: 'app://dashboard' }],
    ['tab-search', { path: 'search://query' }],
  ]);

  test('returns null when element is null', () => {
    expect(resolveDropTargetFromElement(null, ['/home/u/a.txt'], 'move', tabsById)).toBeNull();
  });

  test('resolves [data-drop-trash="true"] only for move mode', () => {
    const sidebarTrash = makeElement({
      attrs: { 'data-drop-trash': 'true' },
      parent: { attrs: { 'data-drop-sidebar': 'true' } },
    });

    expect(resolveDropTargetFromElement(sidebarTrash, ['/home/u/a.txt'], 'move', tabsById)).toEqual({
      kind: 'trash',
      source: 'sidebar',
    });
    expect(resolveDropTargetFromElement(sidebarTrash, ['/home/u/a.txt'], 'copy', tabsById)).toBeNull();
    expect(resolveDropTargetFromElement(sidebarTrash, [], 'move', tabsById)).toBeNull();
  });

  test('resolves [data-drop-tab-id] for directory, trash, and dashboard tabs', () => {
    const dirTab = makeElement({ attrs: { 'data-drop-tab-id': 'tab-docs' } });
    const trashTab = makeElement({ attrs: { 'data-drop-tab-id': 'tab-trash' } });
    const dashTab = makeElement({ attrs: { 'data-drop-tab-id': 'tab-dash' } });
    const searchTab = makeElement({ attrs: { 'data-drop-tab-id': 'tab-search' } });
    const unknownTab = makeElement({ attrs: { 'data-drop-tab-id': 'tab-missing' } });

    expect(resolveDropTargetFromElement(dirTab, ['/home/u/a.txt'], 'move', tabsById)).toEqual({
      kind: 'tab',
      tabId: 'tab-docs',
      path: '/home/u/Docs',
    });
    expect(resolveDropTargetFromElement(dirTab, ['/home/u/Docs/a.txt'], 'move', tabsById)).toBeNull();

    expect(resolveDropTargetFromElement(trashTab, ['/home/u/a.txt'], 'move', tabsById)).toEqual({
      kind: 'trash',
      source: 'tab',
      tabId: 'tab-trash',
    });
    expect(resolveDropTargetFromElement(trashTab, ['/home/u/a.txt'], 'copy', tabsById)).toBeNull();

    expect(resolveDropTargetFromElement(dashTab, ['/home/u/a.txt'], 'move', tabsById)).toBeNull();
    expect(resolveDropTargetFromElement(searchTab, ['/home/u/a.txt'], 'move', tabsById)).toBeNull();
    expect(resolveDropTargetFromElement(unknownTab, ['/home/u/a.txt'], 'move', tabsById)).toBeNull();
  });

  test('resolves [data-drop-folder-path] as sidebar or filelist', () => {
    const sidebarFolder = makeElement({
      attrs: { 'data-drop-folder-path': '/home/u/Music' },
      parent: { attrs: { 'data-drop-sidebar': 'true' } },
    });
    const fileListFolder = makeElement({
      attrs: { 'data-drop-folder-path': '/home/u/Music' },
      parent: {
        attrs: {
          'data-drop-explorer-root': 'true',
          'data-explorer-path': '/home/u',
          'data-search-active': 'false',
        },
      },
    });

    expect(resolveDropTargetFromElement(sidebarFolder, ['/home/u/a.txt'], 'move', tabsById)).toEqual({
      kind: 'folder',
      path: '/home/u/Music',
      source: 'sidebar',
    });
    expect(resolveDropTargetFromElement(fileListFolder, ['/home/u/a.txt'], 'copy', tabsById)).toEqual({
      kind: 'folder',
      path: '/home/u/Music',
      source: 'filelist',
    });
    // Invalid folder target does not fall through to explorer-root
    expect(resolveDropTargetFromElement(fileListFolder, ['/home/u/Music'], 'move', tabsById)).toBeNull();
  });

  test('resolves [data-drop-explorer-root="true"] only when search is inactive and drop is valid', () => {
    const explorerRoot = makeElement({
      attrs: {
        'data-drop-explorer-root': 'true',
        'data-explorer-path': '/home/u/Target',
        'data-search-active': 'false',
      },
    });
    const searchRoot = makeElement({
      attrs: {
        'data-drop-explorer-root': 'true',
        'data-explorer-path': '/home/u/Target',
        'data-search-active': 'true',
      },
    });

    expect(resolveDropTargetFromElement(explorerRoot, ['/home/u/a.txt'], 'copy', tabsById)).toEqual({
      kind: 'folder',
      path: '/home/u/Target',
      source: 'explorer-root',
    });
    expect(resolveDropTargetFromElement(explorerRoot, ['/home/u/Target/a.txt'], 'move', tabsById)).toBeNull();
    expect(resolveDropTargetFromElement(searchRoot, ['/home/u/a.txt'], 'move', tabsById)).toBeNull();
  });
});

describe('toCssClientPoint', () => {
  test('passes finite coordinates through unscaled', () => {
    expect(toCssClientPoint({ x: 320.5, y: 180.25 })).toEqual({ x: 320.5, y: 180.25 });
    expect(toCssClientPoint({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  test('sanitizes non-finite values to 0', () => {
    expect(toCssClientPoint({ x: Number.NaN, y: Number.POSITIVE_INFINITY })).toEqual({ x: 0, y: 0 });
    expect(toCssClientPoint({ x: Number.NEGATIVE_INFINITY, y: 42 })).toEqual({ x: 0, y: 42 });
  });
});

describe('computeAutoScrollDelta', () => {
  test('returns negative delta near top edge, positive near bottom edge, and 0 in middle', () => {
    expect(computeAutoScrollDelta(0, 0, 400)).toBe(-12);
    expect(computeAutoScrollDelta(24, 0, 400)).toBe(-6);
    expect(computeAutoScrollDelta(48, 0, 400)).toBe(0);
    expect(computeAutoScrollDelta(200, 0, 400)).toBe(0);
    expect(computeAutoScrollDelta(352, 0, 400)).toBe(0);
    expect(computeAutoScrollDelta(376, 0, 400)).toBe(6);
    expect(computeAutoScrollDelta(400, 0, 400)).toBe(12);
  });

  test('respects custom edgeZonePx and maxSpeedPx', () => {
    expect(computeAutoScrollDelta(10, 0, 300, 20, 10)).toBe(-5);
    expect(computeAutoScrollDelta(290, 0, 300, 20, 10)).toBe(5);
  });

  test('returns 0 for zero-height, inverted, outside, or non-finite inputs', () => {
    expect(computeAutoScrollDelta(100, 100, 100)).toBe(0);
    expect(computeAutoScrollDelta(100, 200, 100)).toBe(0);
    expect(computeAutoScrollDelta(-5, 0, 400)).toBe(0);
    expect(computeAutoScrollDelta(405, 0, 400)).toBe(0);
    expect(computeAutoScrollDelta(Number.NaN, 0, 400)).toBe(0);
  });

  test('handles containers shorter than twice edgeZonePx without overlap bias', () => {
    expect(computeAutoScrollDelta(30, 0, 60, 48, 12)).toBe(0);
    expect(computeAutoScrollDelta(0, 0, 60, 48, 12)).toBe(-12);
    expect(computeAutoScrollDelta(60, 0, 60, 48, 12)).toBe(12);
  });
});
