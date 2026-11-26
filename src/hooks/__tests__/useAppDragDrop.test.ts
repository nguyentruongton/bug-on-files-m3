import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React, { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { api } from '../../api';
import type { DragDropEventPayload, NativeDragRequest } from '../../api/types';
import type { IFile } from '../../types/files';
import type { DropElementLike, ResolvedDropTarget } from '../../utils/dropTargetUtils';
import type { PasteResult } from '../../utils/pasteRunner';
import { useAppDragDrop, type UseAppDragDropOptions } from '../useAppDragDrop';

// Minimal DOM environment for React 19 createRoot testing in Bun
class MockNode {
  nodeType = 1;
  ownerDocument: MockDocument | null = null;
}
class MockElement extends MockNode {}
class MockHTMLElement extends MockElement {}
class MockHTMLIFrameElement extends MockHTMLElement {}

interface MockDomElement {
  nodeType: number;
  tagName: string;
  ownerDocument: MockDocument | null;
  addEventListener: () => void;
  removeEventListener: () => void;
  getAttribute: (name: string) => string | null;
  setAttribute: () => void;
  removeAttribute: () => void;
  appendChild: () => void;
  removeChild: () => void;
  insertBefore: () => void;
  childNodes: unknown[];
  style: Record<string, unknown>;
}

interface MockDocument {
  nodeType: number;
  createElement: () => MockDomElement;
  createElementNS: () => MockDomElement;
  createTextNode: () => { nodeType: number; textContent: string };
  createComment: () => { nodeType: number };
  addEventListener: () => void;
  removeEventListener: () => void;
  elementFromPoint: (x: number, y: number) => DropElementLike | null;
  defaultView: MockWindow | null;
  documentElement: MockDomElement;
  body: MockDomElement;
  activeElement: null;
}

interface MockWindow {
  document: MockDocument;
  Node: typeof MockNode;
  Element: typeof MockElement;
  HTMLElement: typeof MockHTMLElement;
  HTMLIFrameElement: typeof MockHTMLIFrameElement;
  devicePixelRatio: number;
  addEventListener: () => void;
  removeEventListener: () => void;
}

const DOM_GLOBAL_KEYS = [
  'window',
  'document',
  'Node',
  'Element',
  'HTMLElement',
  'HTMLIFrameElement',
  'navigator',
  'requestAnimationFrame',
  'cancelAnimationFrame',
] as const;

const savedGlobals = new Map<string, { present: boolean; value: unknown }>();
for (const key of DOM_GLOBAL_KEYS) {
  const g = globalThis as Record<string, unknown>;
  savedGlobals.set(key, { present: key in g, value: g[key] });
}

function restoreGlobals() {
  const g = globalThis as Record<string, unknown>;
  for (const key of DOM_GLOBAL_KEYS) {
    const saved = savedGlobals.get(key);
    if (saved && saved.present) {
      g[key] = saved.value;
    } else {
      delete g[key];
    }
  }
}

interface HitMockNode {
  attrs?: Record<string, string>;
  parent?: HitMockNode | null;
  rect?: { top: number; bottom: number };
  scrollBy?: (x: number, y: number) => void;
}

function matchesSelector(node: HitMockNode, selector: string): boolean {
  const attrs = node.attrs ?? {};
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
  if (selector === '[data-drop-scroll-container="true"]') {
    return attrs['data-drop-scroll-container'] === 'true';
  }
  return false;
}

interface HitElement extends DropElementLike {
  getBoundingClientRect?: () => { top: number; bottom: number };
  scrollBy?: (x: number, y: number) => void;
}

function makeHitElement(node: HitMockNode): HitElement {
  const wrap = (current: HitMockNode): HitElement => ({
    closest(selector: string): HitElement | null {
      let cursor: HitMockNode | null | undefined = current;
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
    ...(current.rect ? { getBoundingClientRect: () => current.rect! } : {}),
    ...(current.scrollBy ? { scrollBy: current.scrollBy } : {}),
  });
  return wrap(node);
}

function setupDOM(elementFromPointImpl: (x: number, y: number) => DropElementLike | null) {
  const el: MockDomElement = {
    nodeType: 1,
    tagName: 'DIV',
    ownerDocument: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    appendChild: () => {},
    removeChild: () => {},
    insertBefore: () => {},
    childNodes: [],
    style: {},
  };
  const doc: MockDocument = {
    nodeType: 9,
    createElement: () => ({ ...el }),
    createElementNS: () => ({ ...el }),
    createTextNode: () => ({ nodeType: 3, textContent: '' }),
    createComment: () => ({ nodeType: 8 }),
    addEventListener: () => {},
    removeEventListener: () => {},
    elementFromPoint: elementFromPointImpl,
    defaultView: null,
    documentElement: el,
    body: el,
    activeElement: null,
  };
  const win: MockWindow = {
    document: doc,
    Node: MockNode,
    Element: MockElement,
    HTMLElement: MockHTMLElement,
    HTMLIFrameElement: MockHTMLIFrameElement,
    devicePixelRatio: 2,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  el.ownerDocument = doc;
  doc.defaultView = win;

  const g = globalThis as unknown as Record<string, unknown>;
  g.window = win;
  g.document = doc;
  g.Node = MockNode;
  g.Element = MockElement;
  g.HTMLElement = MockHTMLElement;
  g.HTMLIFrameElement = MockHTMLIFrameElement;
  g.navigator = { userAgent: 'node' };
  g.requestAnimationFrame = (cb: (ts: number) => void) =>
    setTimeout(() => cb(Date.now()), 16) as unknown as number;
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);

  return { el, doc, win };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(fn: () => T | null | undefined, timeoutMs = 1000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = fn();
    if (val !== null && val !== undefined) return val;
    await delay(10);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

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

function emptyPasteResult(done = 0, paths: string[] = []): PasteResult {
  return {
    done,
    skipped: 0,
    failed: [],
    cancelled: false,
    completedSourcePaths: paths,
  };
}

describe('useAppDragDrop', () => {
  let root: Root | null = null;
  let dragDropListeners: Set<(e: DragDropEventPayload) => void>;
  let nativeDragEndListeners: Set<() => void>;
  let startNativeDragCalls: NativeDragRequest[];
  let startNativeDragImpl: (req: NativeDragRequest) => Promise<boolean>;
  let existsImpl: (path: string) => Promise<boolean>;
  let copyFileCalls: Array<{ source: string; dest: string }>;
  let copyFileImpl: (source: string, dest: string) => Promise<boolean>;
  let elementFromPointCalls: Array<{ x: number; y: number }>;
  let elementAtPointImpl: (x: number, y: number) => DropElementLike | null;

  const origApiMethods = {
    startNativeDrag: api.startNativeDrag,
    onDragDrop: api.onDragDrop,
    onNativeDragEnd: api.onNativeDragEnd,
    exists: api.exists,
    copyFile: api.copyFile,
  };

  beforeEach(() => {
    dragDropListeners = new Set();
    nativeDragEndListeners = new Set();
    startNativeDragCalls = [];
    startNativeDragImpl = async () => true;
    existsImpl = async () => false;
    copyFileCalls = [];
    copyFileImpl = async () => true;
    elementFromPointCalls = [];
    elementAtPointImpl = () => null;

    const { el } = setupDOM((x, y) => {
      elementFromPointCalls.push({ x, y });
      return elementAtPointImpl(x, y);
    });

    Object.assign(api, {
      startNativeDrag: async (req: NativeDragRequest) => {
        startNativeDragCalls.push(req);
        return startNativeDragImpl(req);
      },
      onDragDrop: (cb: (e: DragDropEventPayload) => void) => {
        dragDropListeners.add(cb);
        return () => {
          dragDropListeners.delete(cb);
        };
      },
      onNativeDragEnd: (cb: () => void) => {
        nativeDragEndListeners.add(cb);
        return () => {
          nativeDragEndListeners.delete(cb);
        };
      },
      exists: async (path: string) => existsImpl(path),
      copyFile: async (source: string, dest: string) => {
        copyFileCalls.push({ source, dest });
        return copyFileImpl(source, dest);
      },
    });

    root = createRoot(el as unknown as globalThis.Element, {
      onUncaughtError: (err) => {
        throw err;
      },
      onCaughtError: (err) => {
        throw err;
      },
    });
  });

  afterEach(async () => {
    if (root) {
      root.unmount();
      root = null;
      await delay(20);
    }
    Object.assign(api, origApiMethods);
  });

  afterAll(() => {
    restoreGlobals();
  });

  function emitDragDrop(event: DragDropEventPayload) {
    for (const cb of dragDropListeners) {
      cb(event);
    }
  }

  function emitNativeDragEnd() {
    for (const cb of nativeDragEndListeners) {
      cb();
    }
  }

  function mountCoordinator(initialOptions: Partial<UseAppDragDropOptions> = {}) {
    let latestState: {
      isDragging: boolean;
      activeDropTarget: ResolvedDropTarget | null;
      startOutboundDrag: (items: IFile[], sourceDir: string) => Promise<void>;
    } | null = null;

    const defaultOptions: UseAppDragDropOptions = {
      tabs: [
        { id: 'tab-1', path: '/home/u/Source' },
        { id: 'tab-2', path: '/home/u/DestTab' },
        { id: 'tab-dash', path: 'app://dashboard' },
        { id: 'tab-trash', path: 'app://trash' },
      ],
      activeTabId: 'tab-1',
      onSelectTab: () => {},
      transferFiles: async () => emptyPasteResult(),
      onTrashItems: () => {},
      onExternalImportComplete: () => {},
      showToast: () => {},
      ...initialOptions,
    };

    function Harness({ opts }: { opts: UseAppDragDropOptions }) {
      const state = useAppDragDrop(opts);
      useEffect(() => {
        latestState = state;
      }, [state]);
      return null;
    }

    root!.render(React.createElement(Harness, { opts: defaultOptions }));

    return {
      getState: () => latestState!,
      rerender: (next: Partial<UseAppDragDropOptions>) => {
        root!.render(
          React.createElement(Harness, {
            opts: { ...defaultOptions, ...next },
          })
        );
      },
    };
  }

  test('Review Focus #2: clears isDragging and internal session immediately when startNativeDrag resolves false', async () => {
    const transferCalls: Array<{ files: IFile[]; op: 'copy' | 'cut'; destDir: string }> = [];
    const importCalls: Array<{ destDir: string; count: number }> = [];
    startNativeDragImpl = async () => false;

    const harness = mountCoordinator({
      transferFiles: async (files, op, destDir) => {
        transferCalls.push({ files, op, destDir });
        return emptyPasteResult(files.length);
      },
      onExternalImportComplete: (destDir, count) => {
        importCalls.push({ destDir, count });
      },
    });
    await waitFor(() => harness.getState());

    const item = makeFile('/home/u/Source/photo.png');
    await harness.getState().startOutboundDrag([item], '/home/u/Source');
    await waitFor(() => (!harness.getState().isDragging ? true : null));

    expect(startNativeDragCalls).toEqual([
      { paths: ['/home/u/Source/photo.png'], label: 'photo.png', isDirectory: false },
    ]);
    expect(harness.getState().isDragging).toBe(false);

    // Subsequent drop without paths must NOT treat anything as an internal session
    elementAtPointImpl = () => makeHitElement({ attrs: { 'data-drop-folder-path': '/home/u/Target' } });
    emitDragDrop({ type: 'drop', position: { x: 100, y: 100 } });
    await delay(30);

    expect(transferCalls).toHaveLength(0);
    expect(copyFileCalls).toHaveLength(0);
    expect(importCalls).toHaveLength(0);
  });

  test('Review Focus #2: clears isDragging and internal session immediately when startNativeDrag rejects', async () => {
    const transferCalls: Array<{ files: IFile[]; op: 'copy' | 'cut'; destDir: string }> = [];
    startNativeDragImpl = async () => {
      throw new Error('GTK drag rejected');
    };

    const harness = mountCoordinator({
      transferFiles: async (files, op, destDir) => {
        transferCalls.push({ files, op, destDir });
        return emptyPasteResult(files.length);
      },
    });
    await waitFor(() => harness.getState());

    const dirItem = makeFile('/home/u/Source/Folder', true);
    await harness.getState().startOutboundDrag([dirItem], '/home/u/Source');
    await waitFor(() => (!harness.getState().isDragging ? true : null));

    expect(harness.getState().isDragging).toBe(false);

    // Subsequent drop with external paths behaves as external copy, not internal move
    elementAtPointImpl = () => makeHitElement({ attrs: { 'data-drop-folder-path': '/home/u/Target' } });
    emitDragDrop({ type: 'drop', paths: ['/ext/doc.txt'], position: { x: 50, y: 50 } });
    await waitFor(() => (copyFileCalls.length > 0 ? true : null));

    expect(transferCalls).toHaveLength(0);
    expect(copyFileCalls).toEqual([{ source: '/ext/doc.txt', dest: '/home/u/Target/doc.txt' }]);
  });

  test('startOutboundDrag with empty items is a no-op', async () => {
    const harness = mountCoordinator();
    await waitFor(() => harness.getState());

    await harness.getState().startOutboundDrag([], '/home/u/Source');
    await delay(30);

    expect(startNativeDragCalls).toHaveLength(0);
    expect(harness.getState().isDragging).toBe(false);
  });

  test('Review Focus #3: leave clears activeDropTarget and timers while keeping internal session alive until onNativeDragEnd', async () => {
    const selectedTabs: string[] = [];
    const transferCalls: Array<{ files: IFile[]; op: 'copy' | 'cut'; destDir: string }> = [];
    let resolveNativeDrag!: (v: boolean) => void;
    startNativeDragImpl = () =>
      new Promise<boolean>((resolve) => {
        resolveNativeDrag = resolve;
      });

    const harness = mountCoordinator({
      onSelectTab: (tabId) => selectedTabs.push(tabId),
      transferFiles: async (files, op, destDir) => {
        transferCalls.push({ files, op, destDir });
        return emptyPasteResult(files.length);
      },
    });
    await waitFor(() => harness.getState());

    const item = makeFile('/home/u/Source/a.txt');
    const dragStartPromise = harness.getState().startOutboundDrag([item], '/home/u/Source');
    await waitFor(() => (harness.getState().isDragging ? true : null));
    resolveNativeDrag(true);
    await dragStartPromise;

    // Hover over inactive directory tab -> sets activeDropTarget & arms 550ms spring-load timer
    elementAtPointImpl = () => makeHitElement({ attrs: { 'data-drop-tab-id': 'tab-2' } });
    emitDragDrop({ type: 'over', position: { x: 220, y: 15 } });
    await waitFor(() => harness.getState().activeDropTarget);

    expect(harness.getState().activeDropTarget).toEqual({
      kind: 'tab',
      tabId: 'tab-2',
      path: '/home/u/DestTab',
    });

    // Pointer leaves window toward external app (e.g. photos0x)
    emitDragDrop({ type: 'leave' });
    await waitFor(() => (harness.getState().activeDropTarget === null ? true : null));

    expect(harness.getState().activeDropTarget).toBeNull();
    expect(harness.getState().isDragging).toBe(true);

    // Wait past 550ms to verify spring-load timer was cancelled on leave
    await delay(600);
    expect(selectedTabs).toEqual([]);

    // Internal session is still alive if user re-enters window and drops before native drag ends
    elementAtPointImpl = () => makeHitElement({ attrs: { 'data-drop-folder-path': '/home/u/DestFolder' } });
    emitDragDrop({ type: 'enter', position: { x: 140, y: 140 } });
    const reenteredTarget = await waitFor(() => harness.getState().activeDropTarget);
    expect(reenteredTarget).toEqual({
      kind: 'folder',
      path: '/home/u/DestFolder',
      source: 'filelist',
    });

    // Simulate leaving again and ending natively in external app
    emitDragDrop({ type: 'leave' });
    await waitFor(() => (harness.getState().activeDropTarget === null ? true : null));
    expect(harness.getState().isDragging).toBe(true);

    emitNativeDragEnd();
    await waitFor(() => (!harness.getState().isDragging ? true : null));

    expect(harness.getState().isDragging).toBe(false);
    expect(harness.getState().activeDropTarget).toBeNull();

    // After onNativeDragEnd, internal session is gone
    emitDragDrop({ type: 'drop', position: { x: 140, y: 140 } });
    await delay(30);
    expect(transferCalls).toHaveLength(0);
  });

  test('external drag leave clears isDragging and activeDropTarget immediately', async () => {
    const harness = mountCoordinator();
    await waitFor(() => harness.getState());

    elementAtPointImpl = () => makeHitElement({ attrs: { 'data-drop-folder-path': '/home/u/DestFolder' } });
    emitDragDrop({ type: 'enter', paths: ['/ext/pic.jpg'], position: { x: 80, y: 80 } });
    await waitFor(() => (harness.getState().isDragging && harness.getState().activeDropTarget ? true : null));

    expect(harness.getState().isDragging).toBe(true);
    expect(harness.getState().activeDropTarget).toEqual({
      kind: 'folder',
      path: '/home/u/DestFolder',
      source: 'filelist',
    });

    emitDragDrop({ type: 'leave' });
    await waitFor(() => (!harness.getState().isDragging && harness.getState().activeDropTarget === null ? true : null));

    expect(harness.getState().isDragging).toBe(false);
    expect(harness.getState().activeDropTarget).toBeNull();
  });

  test('spring-loads inactive directory tab after 550ms without resetting on repeated over events', async () => {
    const selectedTabs: string[] = [];
    const harness = mountCoordinator({
      onSelectTab: (tabId) => selectedTabs.push(tabId),
    });
    await waitFor(() => harness.getState());

    const item = makeFile('/home/u/Source/a.txt');
    await harness.getState().startOutboundDrag([item], '/home/u/Source');

    elementAtPointImpl = () => makeHitElement({ attrs: { 'data-drop-tab-id': 'tab-2' } });
    emitDragDrop({ type: 'over', position: { x: 200, y: 20 } });

    // Repeated over events at 250ms and 450ms should NOT reset the 550ms timer
    await delay(250);
    expect(selectedTabs).toEqual([]);
    emitDragDrop({ type: 'over', position: { x: 205, y: 20 } });

    await delay(200);
    expect(selectedTabs).toEqual([]);
    emitDragDrop({ type: 'over', position: { x: 210, y: 20 } });

    // Should fire ~550ms from the first over (only ~100-180ms remaining)
    await waitFor(() => (selectedTabs.length > 0 ? selectedTabs : null), 400);
    expect(selectedTabs).toEqual(['tab-2']);

    emitNativeDragEnd();
  });

  test('cancels spring-loaded tab timer when moving away or dropping early, and never fires for active tab or app://dashboard', async () => {
    const selectedTabs: string[] = [];
    const transferCalls: Array<{ files: IFile[]; op: 'copy' | 'cut'; destDir: string }> = [];
    const harness = mountCoordinator({
      onSelectTab: (tabId) => selectedTabs.push(tabId),
      transferFiles: async (files, op, destDir) => {
        transferCalls.push({ files, op, destDir });
        return emptyPasteResult(files.length);
      },
    });
    await waitFor(() => harness.getState());

    // Hover over active tab (tab-1) with a file from another folder so target resolves as { kind: 'tab', tabId: 'tab-1' }
    const otherItem = makeFile('/home/u/Other/x.txt');
    await harness.getState().startOutboundDrag([otherItem], '/home/u/Other');

    elementAtPointImpl = () => makeHitElement({ attrs: { 'data-drop-tab-id': 'tab-1' } });
    emitDragDrop({ type: 'over', position: { x: 50, y: 20 } });
    await delay(620);
    expect(selectedTabs).toEqual([]);

    // Hover over app://dashboard tab -> never switches
    elementAtPointImpl = () => makeHitElement({ attrs: { 'data-drop-tab-id': 'tab-dash' } });
    emitDragDrop({ type: 'over', position: { x: 300, y: 20 } });
    await delay(620);
    expect(selectedTabs).toEqual([]);

    // Hover over inactive tab-2, then move away before 550ms -> cancelled
    elementAtPointImpl = () => makeHitElement({ attrs: { 'data-drop-tab-id': 'tab-2' } });
    emitDragDrop({ type: 'over', position: { x: 200, y: 20 } });
    await delay(200);
    elementAtPointImpl = () => null;
    emitDragDrop({ type: 'over', position: { x: 500, y: 500 } });
    await delay(450);
    expect(selectedTabs).toEqual([]);

    // Hover over inactive tab-2 and drop early before 550ms -> transfers directly without switching tab
    elementAtPointImpl = () => makeHitElement({ attrs: { 'data-drop-tab-id': 'tab-2' } });
    emitDragDrop({ type: 'over', position: { x: 200, y: 20 } });
    await delay(100);
    emitDragDrop({ type: 'drop', position: { x: 200, y: 20 } });
    await delay(500);

    expect(selectedTabs).toEqual([]);
    expect(transferCalls).toEqual([
      { files: [otherItem], op: 'cut', destDir: '/home/u/DestTab' },
    ]);
  });

  test('internal drop on folder or tab filters actionable paths and calls transferFiles with cut', async () => {
    const transferCalls: Array<{ files: IFile[]; op: 'copy' | 'cut'; destDir: string }> = [];
    const harness = mountCoordinator({
      transferFiles: async (files, op, destDir) => {
        transferCalls.push({ files, op, destDir });
        return emptyPasteResult(files.length);
      },
    });
    await waitFor(() => harness.getState());

    const fromDocs = makeFile('/home/u/Docs/a.txt');
    const alreadyInTarget = makeFile('/home/u/DestTab/b.txt');

    // Mixed batch dropped on folder /home/u/DestTab -> only fromDocs is actionable
    await harness.getState().startOutboundDrag([fromDocs, alreadyInTarget], '/home/u/Docs');
    elementAtPointImpl = () =>
      makeHitElement({
        attrs: { 'data-drop-folder-path': '/home/u/DestTab' },
        parent: { attrs: { 'data-drop-sidebar': 'true' } },
      });

    emitDragDrop({ type: 'drop', position: { x: 40, y: 120 } });
    await waitFor(() => (transferCalls.length > 0 && !harness.getState().isDragging ? true : null));

    expect(transferCalls).toEqual([
      { files: [fromDocs], op: 'cut', destDir: '/home/u/DestTab' },
    ]);
    expect(harness.getState().isDragging).toBe(false);
    expect(harness.getState().activeDropTarget).toBeNull();

    // Drop on directory tab
    await harness.getState().startOutboundDrag([fromDocs], '/home/u/Docs');
    elementAtPointImpl = () => makeHitElement({ attrs: { 'data-drop-tab-id': 'tab-2' } });
    emitDragDrop({ type: 'drop', position: { x: 210, y: 15 } });
    await waitFor(() => (transferCalls.length > 1 ? true : null));

    expect(transferCalls).toHaveLength(2);
    expect(transferCalls[1]).toEqual({
      files: [fromDocs],
      op: 'cut',
      destDir: '/home/u/DestTab',
    });
  });

  test('internal drop on Trash (sidebar or app://trash tab) calls onTrashItems', async () => {
    const trashedBatches: IFile[][] = [];
    const transferCalls: unknown[] = [];
    const harness = mountCoordinator({
      onTrashItems: (items) => trashedBatches.push(items),
      transferFiles: async (...args) => {
        transferCalls.push(args);
        return emptyPasteResult();
      },
    });
    await waitFor(() => harness.getState());

    const f1 = makeFile('/home/u/Source/one.txt');
    const f2 = makeFile('/home/u/Source/two.txt');

    // Sidebar Trash
    await harness.getState().startOutboundDrag([f1, f2], '/home/u/Source');
    elementAtPointImpl = () =>
      makeHitElement({
        attrs: { 'data-drop-trash': 'true' },
        parent: { attrs: { 'data-drop-sidebar': 'true' } },
      });
    emitDragDrop({ type: 'drop', position: { x: 30, y: 300 } });
    await waitFor(() => (trashedBatches.length > 0 ? true : null));

    expect(trashedBatches).toEqual([[f1, f2]]);
    expect(transferCalls).toHaveLength(0);

    // Tab Trash (app://trash)
    await harness.getState().startOutboundDrag([f1], '/home/u/Source');
    elementAtPointImpl = () => makeHitElement({ attrs: { 'data-drop-tab-id': 'tab-trash' } });
    emitDragDrop({ type: 'drop', position: { x: 400, y: 20 } });
    await waitFor(() => (trashedBatches.length > 1 ? true : null));

    expect(trashedBatches).toEqual([[f1, f2], [f1]]);
    expect(transferCalls).toHaveLength(0);
  });

  test('external drop onto folder/tab runs processInboundDrop with unscaled GTK coordinates and notifies completion + toast', async () => {
    const importCompletions: Array<{ destDir: string; count: number }> = [];
    const toasts: Array<{ msg: string; type: string }> = [];
    const harness = mountCoordinator({
      onExternalImportComplete: (destDir, count) => importCompletions.push({ destDir, count }),
      showToast: (msg, type) => toasts.push({ msg, type }),
    });
    await waitFor(() => harness.getState());

    elementAtPointImpl = () => makeHitElement({ attrs: { 'data-drop-tab-id': 'tab-2' } });
    // Even with devicePixelRatio === 2, coordinates must pass through unscaled
    emitDragDrop({
      type: 'enter',
      paths: ['/ext/one.png', '/ext/two.png'],
      position: { x: 240, y: 18 },
    });
    await waitFor(() => harness.getState().activeDropTarget);
    // Over omits paths in wry; cached lastInboundPathsRef preserves target highlight
    emitDragDrop({ type: 'over', position: { x: 244, y: 20 } });
    await delay(20);

    expect(elementFromPointCalls).toEqual([
      { x: 240, y: 18 },
      { x: 244, y: 20 },
    ]);
    expect(harness.getState().activeDropTarget).toEqual({
      kind: 'tab',
      tabId: 'tab-2',
      path: '/home/u/DestTab',
    });

    emitDragDrop({
      type: 'drop',
      paths: ['/ext/one.png', '/ext/two.png'],
      position: { x: 244, y: 20 },
    });
    await waitFor(() =>
      importCompletions.length > 0 && !harness.getState().isDragging ? true : null
    );

    expect(copyFileCalls).toEqual([
      { source: '/ext/one.png', dest: '/home/u/DestTab/one.png' },
      { source: '/ext/two.png', dest: '/home/u/DestTab/two.png' },
    ]);
    expect(importCompletions).toEqual([{ destDir: '/home/u/DestTab', count: 2 }]);
    expect(toasts).toEqual([{ msg: 'Imported 2 files', type: 'success' }]);
    expect(harness.getState().isDragging).toBe(false);
    expect(harness.getState().activeDropTarget).toBeNull();
  });

  test('external drop onto Trash (sidebar or app://trash tab) does nothing', async () => {
    const trashed: IFile[][] = [];
    const importCompletions: Array<{ destDir: string; count: number }> = [];
    const toasts: Array<{ msg: string; type: string }> = [];
    const harness = mountCoordinator({
      onTrashItems: (items) => trashed.push(items),
      onExternalImportComplete: (destDir, count) => importCompletions.push({ destDir, count }),
      showToast: (msg, type) => toasts.push({ msg, type }),
    });
    await waitFor(() => harness.getState());

    // Hover and drop on sidebar Trash
    elementAtPointImpl = () =>
      makeHitElement({
        attrs: { 'data-drop-trash': 'true' },
        parent: { attrs: { 'data-drop-sidebar': 'true' } },
      });
    emitDragDrop({ type: 'enter', paths: ['/ext/secret.txt'], position: { x: 30, y: 320 } });
    await waitFor(() => (harness.getState().isDragging ? true : null));
    expect(harness.getState().activeDropTarget).toBeNull();

    emitDragDrop({ type: 'drop', paths: ['/ext/secret.txt'], position: { x: 30, y: 320 } });
    await waitFor(() => (!harness.getState().isDragging ? true : null));

    // Drop on app://trash tab
    elementAtPointImpl = () => makeHitElement({ attrs: { 'data-drop-tab-id': 'tab-trash' } });
    emitDragDrop({ type: 'drop', paths: ['/ext/secret.txt'], position: { x: 400, y: 18 } });
    await delay(30);

    expect(trashed).toHaveLength(0);
    expect(copyFileCalls).toHaveLength(0);
    expect(importCompletions).toHaveLength(0);
    expect(toasts).toHaveLength(0);
    expect(harness.getState().isDragging).toBe(false);
  });

  test('auto-scrolls [data-drop-scroll-container="true"] near edges and stops on leave', async () => {
    const scrollCalls: Array<{ x: number; y: number }> = [];
    const harness = mountCoordinator();
    await waitFor(() => harness.getState());

    const scrollContainer: HitMockNode = {
      attrs: { 'data-drop-scroll-container': 'true' },
      rect: { top: 100, bottom: 500 },
      scrollBy: (x, y) => scrollCalls.push({ x, y }),
    };
    const rowInsideContainer: HitMockNode = {
      attrs: { 'data-drop-folder-path': '/home/u/Sub' },
      parent: scrollContainer,
    };

    elementAtPointImpl = () => makeHitElement(rowInsideContainer);
    emitDragDrop({ type: 'enter', paths: ['/ext/a.txt'], position: { x: 150, y: 100 } });
    await waitFor(() => (scrollCalls.length > 0 ? true : null));

    expect(scrollCalls.length).toBeGreaterThanOrEqual(1);
    expect(scrollCalls[0].x).toBe(0);
    expect(scrollCalls[0].y).toBe(-12);

    emitDragDrop({ type: 'leave' });
    const countAtLeave = scrollCalls.length;
    await delay(50);
    expect(scrollCalls.length).toBe(countAtLeave);
  });

  test('unmount unsubscribes from api.onDragDrop and api.onNativeDragEnd', async () => {
    mountCoordinator();
    await waitFor(() => (dragDropListeners.size === 1 ? true : null));
    expect(dragDropListeners.size).toBe(1);
    expect(nativeDragEndListeners.size).toBe(1);

    root!.unmount();
    root = null;
    await waitFor(() => (dragDropListeners.size === 0 && nativeDragEndListeners.size === 0 ? true : null));

    expect(dragDropListeners.size).toBe(0);
    expect(nativeDragEndListeners.size).toBe(0);
  });
});
