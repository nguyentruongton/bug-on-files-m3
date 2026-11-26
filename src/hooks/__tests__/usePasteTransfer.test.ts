import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import React, { useEffect } from 'react';
import type { Root } from 'react-dom/client';
import type { IFile } from '../../types/files';
import type { PasteResult } from '../../utils/pasteRunner';
import type { TransferCompletionInfo } from '../usePaste';

class MockNode {
  nodeType = 1;
  parentNode: MockNode | null = null;
  childNodes: MockNode[] = [];
  ownerDocument: MockDocument | null = null;
  textContent: string | null = null;

  appendChild<T extends MockNode>(child: T): T {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild<T extends MockNode>(child: T): T {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  insertBefore<T extends MockNode>(newNode: T, refNode: MockNode | null): T {
    if (!refNode) {
      return this.appendChild(newNode);
    }
    if (newNode.parentNode) {
      newNode.parentNode.removeChild(newNode);
    }
    const idx = this.childNodes.indexOf(refNode);
    if (idx === -1) {
      return this.appendChild(newNode);
    }
    newNode.parentNode = this;
    this.childNodes.splice(idx, 0, newNode);
    return newNode;
  }

  contains(other: MockNode | null): boolean {
    let cur = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }
}

function bubbleEvent(
  startNode: MockNode,
  ev: { type: string; target?: unknown; currentTarget?: unknown; defaultPrevented?: boolean; preventDefault?: () => void; stopPropagation?: () => void }
): boolean {
  if (ev.target == null) {
    try {
      Object.defineProperty(ev, 'target', { value: startNode, configurable: true });
    } catch {
      // Ignore read-only native Event.target
    }
  }
  ev.preventDefault ??= () => {
    ev.defaultPrevented = true;
  };
  ev.stopPropagation ??= () => {};
  let cur: MockNode | null = startNode;
  while (cur) {
    if (cur instanceof MockElement) {
      try {
        Object.defineProperty(ev, 'currentTarget', { value: cur, configurable: true });
      } catch {
        // Ignore read-only native Event.currentTarget
      }
      for (const cb of cur.listeners.get(ev.type) ?? []) {
        cb(ev);
      }
    }
    cur = cur.parentNode;
  }
  return !ev.defaultPrevented;
}

class MockElement extends MockNode {
  tagName: string;
  nodeName: string;
  attributes = new Map<string, string>();
  listeners = new Map<string, Set<(ev: unknown) => void>>();
  style: Record<string, unknown> & {
    setProperty: (name: string, value: string) => void;
    removeProperty: (name: string) => void;
  };
  className = '';
  classList = {
    add: () => {},
    remove: () => {},
    contains: () => false,
    toggle: () => false,
  };

  constructor(tagName: string, ownerDocument: MockDocument | null = null) {
    super();
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.ownerDocument = ownerDocument;
    const styleObj: Record<string, unknown> & {
      setProperty: (name: string, value: string) => void;
      removeProperty: (name: string) => void;
    } = {
      setProperty: (name: string, value: string) => {
        styleObj[name] = value;
      },
      removeProperty: (name: string) => {
        delete styleObj[name];
      },
    };
    this.style = styleObj;
  }

  get children(): MockElement[] {
    return this.childNodes.filter((n): n is MockElement => n instanceof MockElement);
  }

  get firstElementChild(): MockElement | null {
    return this.children[0] ?? null;
  }

  insertAdjacentElement(
    position: 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend',
    element: MockElement
  ): MockElement | null {
    if (position === 'afterbegin') {
      return this.insertBefore(element, this.childNodes[0] ?? null);
    }
    if (position === 'beforeend') {
      return this.appendChild(element);
    }
    if (position === 'beforebegin' && this.parentNode) {
      return this.parentNode.insertBefore(element, this);
    }
    if (position === 'afterend' && this.parentNode) {
      const idx = this.parentNode.childNodes.indexOf(this);
      const next = idx >= 0 ? this.parentNode.childNodes[idx + 1] ?? null : null;
      return this.parentNode.insertBefore(element, next);
    }
    return null;
  }

  addEventListener(type: string, cb: (ev: unknown) => void) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb);
  }

  removeEventListener(type: string, cb: (ev: unknown) => void) {
    this.listeners.get(type)?.delete(cb);
  }

  dispatchEvent(ev: { type: string; target?: unknown; currentTarget?: unknown; defaultPrevented?: boolean; preventDefault?: () => void; stopPropagation?: () => void }): boolean {
    return bubbleEvent(this, ev);
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }

  focus() {}
  blur() {}

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 };
  }

  querySelectorAll(selector: string): MockElement[] {
    const out: MockElement[] = [];
    const targetTag = selector.toUpperCase();
    const visit = (node: MockNode) => {
      if (node instanceof MockElement && node.tagName === targetTag) {
        out.push(node);
      }
      for (const child of node.childNodes) {
        visit(child);
      }
    };
    visit(this);
    return out;
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

class MockHTMLElement extends MockElement {}
class MockHTMLIFrameElement extends MockHTMLElement {}
class MockSVGElement extends MockElement {}

class MockText extends MockNode {
  override nodeType = 3;
  data: string;
  constructor(data: string, ownerDocument: MockDocument | null = null) {
    super();
    this.data = data;
    this.textContent = data;
    this.ownerDocument = ownerDocument;
  }
}

class MockComment extends MockNode {
  override nodeType = 8;
}

class MockDocumentFragment extends MockNode {
  override nodeType = 11;
}

class MockDocument extends MockNode {
  override nodeType = 9;
  defaultView: MockWindow | null = null;
  documentElement: MockElement;
  head: MockElement;
  body: MockElement;
  activeElement: MockElement | null = null;
  listeners = new Map<string, Set<(ev: unknown) => void>>();

  constructor() {
    super();
    this.documentElement = new MockHTMLElement('HTML', this);
    this.head = new MockHTMLElement('HEAD', this);
    this.body = new MockHTMLElement('BODY', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }

  createElement(tag: string): MockElement {
    return new MockHTMLElement(tag, this);
  }

  createElementNS(_ns: string, tag: string): MockElement {
    return new MockSVGElement(tag, this);
  }

  createTextNode(text: string): MockText {
    return new MockText(text, this);
  }

  createComment(): MockComment {
    return new MockComment();
  }

  createDocumentFragment(): MockDocumentFragment {
    return new MockDocumentFragment();
  }

  createTreeWalker() {
    return { nextNode: () => null };
  }

  addEventListener(type: string, cb: (ev: unknown) => void) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb);
  }

  removeEventListener(type: string, cb: (ev: unknown) => void) {
    this.listeners.get(type)?.delete(cb);
  }

  dispatchEvent(ev: { type: string; defaultPrevented?: boolean }): boolean {
    for (const cb of this.listeners.get(ev.type) ?? []) {
      cb(ev);
    }
    return !ev.defaultPrevented;
  }

  querySelectorAll(selector: string): MockElement[] {
    return this.documentElement.querySelectorAll(selector);
  }

  querySelector(selector: string): MockElement | null {
    return this.documentElement.querySelector(selector);
  }

  getElementById(): MockElement | null {
    return null;
  }
}

interface MockWindow {
  document: MockDocument;
  Node: typeof MockNode;
  Element: typeof MockElement;
  HTMLElement: typeof MockHTMLElement;
  HTMLIFrameElement: typeof MockHTMLIFrameElement;
  SVGElement: typeof MockSVGElement;
  addEventListener: () => void;
  removeEventListener: () => void;
  getComputedStyle: () => Record<string, string>;
  matchMedia: () => { matches: boolean; addEventListener: () => void; removeEventListener: () => void };
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  requestAnimationFrame: (cb: (ts: number) => void) => number;
  cancelAnimationFrame: () => void;
}

function getNodeText(node: MockNode): string {
  if (node instanceof MockText) return node.data;
  if (node.childNodes.length === 0 && node.textContent) return node.textContent;
  return node.childNodes.map(getNodeText).join('');
}

function setupDOM() {
  const doc = new MockDocument();
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const win: MockWindow = {
    document: doc,
    Node: MockNode,
    Element: MockElement,
    HTMLElement: MockHTMLElement,
    HTMLIFrameElement: MockHTMLIFrameElement,
    SVGElement: MockSVGElement,
    addEventListener: () => {},
    removeEventListener: () => {},
    getComputedStyle: () => ({}),
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0) as unknown as number,
    cancelAnimationFrame: (id?: number) => clearTimeout(id),
  };
  doc.defaultView = win;

  const g = globalThis as unknown as Record<string, unknown>;
  g.window = win;
  g.document = doc;
  g.Node = MockNode;
  g.Element = MockElement;
  g.HTMLElement = MockHTMLElement;
  g.HTMLIFrameElement = MockHTMLIFrameElement;
  g.SVGElement = MockSVGElement;
  g.NodeFilter = { SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_SKIP: 3 };
  g.navigator = { userAgent: 'node' };
  g.requestAnimationFrame = win.requestAnimationFrame;
  g.cancelAnimationFrame = win.cancelAnimationFrame;
  g.getComputedStyle = win.getComputedStyle;
  g.MutationObserver = class {
    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  g.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  return { container, doc, win };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DOM_GLOBAL_KEYS = [
  'window',
  'document',
  'Node',
  'Element',
  'HTMLElement',
  'HTMLIFrameElement',
  'SVGElement',
  'NodeFilter',
  'navigator',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'MutationObserver',
  'ResizeObserver',
] as const;

const savedGlobals = new Map<string, { present: boolean; value: unknown }>();
for (const key of DOM_GLOBAL_KEYS) {
  const g = globalThis as Record<string, unknown>;
  savedGlobals.set(key, { present: key in g, value: g[key] });
}
const hadDocumentBeforeSuite = 'document' in globalThis && globalThis.document !== undefined;

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

// Install DOM globals and patch Radix's module-load-time document check so
// Portal/FocusGuards remain functional regardless of test file execution order.
setupDOM();
mock.module('@radix-ui/react-use-layout-effect', () => ({
  useLayoutEffect: React.useLayoutEffect,
}));
const { createRoot } = await import('react-dom/client');
const { api } = await import('../../api');
const { ClipboardProvider, useClipboard } = await import('../../contexts/ClipboardContext');
const { ToastProvider } = await import('../../contexts/ToastContext');
const { usePaste } = await import('../usePaste');

async function waitFor<T>(fn: () => T | null | undefined, timeoutMs = 1000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = fn();
    if (val !== null && val !== undefined) return val;
    await delay(10);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

function makeFile(name: string, parentDir = '/src', isDirectory = false): IFile {
  const normParent = parentDir === '/' ? '' : parentDir.replace(/\/+$/, '');
  return {
    name,
    path: `${normParent}/${name}`,
    isDirectory,
    size: 128,
    mtime: new Date('2026-11-10T14:30:00Z'),
  };
}

describe('usePaste transferFiles', () => {
  let root: Root | null = null;
  let doc: MockDocument;
  const origApiMethods = {
    exists: api.exists,
    moveFile: api.moveFile,
    copyFile: api.copyFile,
    trashFile: api.trashFile,
  };

  beforeEach(() => {
    const dom = setupDOM();
    doc = dom.doc;
    root = createRoot(dom.container as unknown as globalThis.Element, {
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

  afterAll(async () => {
    await delay(20);
    restoreGlobals();
    if (!hadDocumentBeforeSuite) {
      mock.module('@radix-ui/react-use-layout-effect', () => ({
        useLayoutEffect: () => {},
      }));
    }
  });

  test('isolates ClipboardContext, tracks affectedDirs on partial skip, and blocks concurrent paste/transferFiles', async () => {
    const clipFile = makeFile('clip.txt', '/clip');
    const fileA = makeFile('a.txt', '/src/sub');
    const fileB = makeFile('b.txt', '/src/other');

    const moveCalls: Array<{ src: string; dest: string }> = [];
    const copyCalls: Array<{ src: string; dest: string }> = [];
    const existing = new Set<string>(['/dest/b.txt']);

    Object.assign(api, {
      exists: async (path: string) => existing.has(path),
      moveFile: async (src: string, dest: string) => {
        moveCalls.push({ src, dest });
        return true;
      },
      copyFile: async (src: string, dest: string) => {
        copyCalls.push({ src, dest });
        return true;
      },
      trashFile: async () => true,
    });

    const finishedCalls: number[] = [];
    const completionInfos: TransferCompletionInfo[] = [];

    let apiHandle: {
      copyToClipboard: (files: IFile[]) => void;
      getClipboard: () => ReturnType<typeof useClipboard>['clipboard'];
      paste: (destDir: string) => Promise<void>;
      transferFiles: (
        files: IFile[],
        operation: 'copy' | 'cut',
        destDir: string
      ) => Promise<PasteResult>;
    } | null = null;

    function Harness() {
      const { clipboard, copy } = useClipboard();
      const { paste, transferFiles, conflictDialog } = usePaste(
        () => {
          finishedCalls.push(1);
        },
        (info) => {
          completionInfos.push(info);
        }
      );

      useEffect(() => {
        apiHandle = {
          copyToClipboard: copy,
          getClipboard: () => clipboard,
          paste,
          transferFiles,
        };
      }, [clipboard, copy, paste, transferFiles]);

      return React.createElement(React.Fragment, null, conflictDialog);
    }

    root!.render(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(ClipboardProvider, null, React.createElement(Harness))
      )
    );
    await waitFor(() => apiHandle);

    // Seed ClipboardContext via Ctrl+C equivalent
    apiHandle!.copyToClipboard([clipFile]);
    await waitFor(() => (apiHandle!.getClipboard()?.files.length === 1 ? true : null));
    expect(apiHandle!.getClipboard()).toEqual({
      operation: 'copy',
      files: [clipFile],
    });

    // Start transferFiles where fileA succeeds and fileB hits conflict
    const transferPromise = apiHandle!.transferFiles([fileA, fileB], 'cut', '/dest');

    // Wait until ConflictDialog is rendered for fileB
    const skipButton = await waitFor(() =>
      doc.querySelectorAll('button').find((btn) => getNodeText(btn).trim() === 'Skip')
    );

    // While busy in ConflictDialog, concurrent transferFiles and paste must be ignored
    const concurrentTransfer = await apiHandle!.transferFiles([fileA], 'copy', '/other-dest');
    expect(concurrentTransfer).toEqual({
      done: 0,
      skipped: 0,
      failed: [],
      cancelled: false,
      completedSourcePaths: [],
    });
    await apiHandle!.paste('/other-dest');
    expect(copyCalls).toHaveLength(0);

    // Resolve fileB conflict as 'skip'
    skipButton.click();
    const result = await transferPromise;
    await delay(30);

    expect(result).toEqual({
      done: 1,
      skipped: 1,
      failed: [],
      cancelled: false,
      completedSourcePaths: ['/src/sub/a.txt'],
    });
    expect(moveCalls).toEqual([{ src: '/src/sub/a.txt', dest: '/dest/a.txt' }]);

    // ClipboardContext must be completely untouched
    expect(apiHandle!.getClipboard()).toEqual({
      operation: 'copy',
      files: [clipFile],
    });

    // onTransferComplete and onFinished invoked with affectedDirs containing normalized parent of fileA + destDir
    expect(finishedCalls).toHaveLength(1);
    expect(completionInfos).toHaveLength(1);
    expect(completionInfos[0].operation).toBe('cut');
    expect(completionInfos[0].destDir).toBe('/dest');
    expect(completionInfos[0].completedSourcePaths).toEqual(['/src/sub/a.txt']);
    expect(completionInfos[0].affectedDirs.sort()).toEqual(['/dest', '/src/sub']);
  });

  test('successful cut and copy via transferFiles never clear ClipboardContext and normalize affectedDirs', async () => {
    const clipCutFile = makeFile('keep-me-in-clipboard.txt', '/clip');
    const fileRoot = makeFile('root.txt', '/');
    const fileNestedA = makeFile('one.txt', '/a/b/');
    const fileNestedB = makeFile('two.txt', '/a/b');

    const moveCalls: Array<{ src: string; dest: string }> = [];
    const copyCalls: Array<{ src: string; dest: string }> = [];

    Object.assign(api, {
      exists: async () => false,
      moveFile: async (src: string, dest: string) => {
        moveCalls.push({ src, dest });
        return true;
      },
      copyFile: async (src: string, dest: string) => {
        copyCalls.push({ src, dest });
        return true;
      },
      trashFile: async () => true,
    });

    const completionInfos: TransferCompletionInfo[] = [];
    let apiHandle: {
      cutToClipboard: (files: IFile[]) => void;
      getClipboard: () => ReturnType<typeof useClipboard>['clipboard'];
      transferFiles: (
        files: IFile[],
        operation: 'copy' | 'cut',
        destDir: string
      ) => Promise<PasteResult>;
    } | null = null;

    function Harness() {
      const { clipboard, cut } = useClipboard();
      const { transferFiles, conflictDialog } = usePaste(
        () => {},
        (info) => completionInfos.push(info)
      );

      useEffect(() => {
        apiHandle = {
          cutToClipboard: cut,
          getClipboard: () => clipboard,
          transferFiles,
        };
      }, [clipboard, cut, transferFiles]);

      return React.createElement(React.Fragment, null, conflictDialog);
    }

    root!.render(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(ClipboardProvider, null, React.createElement(Harness))
      )
    );
    await waitFor(() => apiHandle);

    apiHandle!.cutToClipboard([clipCutFile]);
    await waitFor(() => (apiHandle!.getClipboard()?.operation === 'cut' ? true : null));

    // Zero-error, non-cancelled cut via transferFiles must STILL preserve ClipboardContext
    const cutResult = await apiHandle!.transferFiles([fileRoot, fileNestedA, fileNestedB], 'cut', '/target/');
    expect(cutResult).toEqual({
      done: 3,
      skipped: 0,
      failed: [],
      cancelled: false,
      completedSourcePaths: ['/root.txt', '/a/b/one.txt', '/a/b/two.txt'],
    });
    expect(moveCalls).toHaveLength(3);
    expect(apiHandle!.getClipboard()).toEqual({
      operation: 'cut',
      files: [clipCutFile],
    });
    expect(completionInfos[0].affectedDirs.sort()).toEqual(['/', '/a/b', '/target']);

    // Copy via transferFiles
    const copyResult = await apiHandle!.transferFiles([fileRoot], 'copy', '/copy-dest');
    expect(copyResult).toEqual({
      done: 1,
      skipped: 0,
      failed: [],
      cancelled: false,
      completedSourcePaths: ['/root.txt'],
    });
    expect(copyCalls).toEqual([{ src: '/root.txt', dest: '/copy-dest/root.txt' }]);
    expect(completionInfos[1].operation).toBe('copy');
    expect(completionInfos[1].affectedDirs.sort()).toEqual(['/', '/copy-dest']);
  });
});
