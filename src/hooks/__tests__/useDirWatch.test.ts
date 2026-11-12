import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import React, { useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { useDirWatch } from '../useDirWatch';
import type { WatchEvent } from '../../api/types';
import { api } from '../../api';

// Setup minimal DOM environment for React 19 testing in Bun
class Node {}
class Element extends Node {}
class HTMLElement extends Element {}
class HTMLIFrameElement extends HTMLElement {}

interface MockElement {
  nodeType: number;
  tagName: string;
  ownerDocument: MockDocument | null;
  addEventListener: () => void;
  removeEventListener: () => void;
  getAttribute: () => null;
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
  createElement: () => MockElement;
  createElementNS: () => MockElement;
  createTextNode: () => { nodeType: number; textContent: string };
  createComment: () => { nodeType: number };
  addEventListener: () => void;
  removeEventListener: () => void;
  defaultView: MockWindow | null;
  documentElement: MockElement;
  body: MockElement;
  activeElement: null;
}

interface MockWindow {
  document: MockDocument;
  Node: typeof Node;
  Element: typeof Element;
  HTMLElement: typeof HTMLElement;
  HTMLIFrameElement: typeof HTMLIFrameElement;
  addEventListener: () => void;
  removeEventListener: () => void;
}

function setupDOM() {
  const el: MockElement = {
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
    defaultView: null,
    documentElement: el,
    body: el,
    activeElement: null,
  };
  const win: MockWindow = {
    document: doc,
    Node,
    Element,
    HTMLElement,
    HTMLIFrameElement,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  el.ownerDocument = doc;
  doc.defaultView = win;

  const g = globalThis as unknown as Record<string, unknown>;
  g.window = win;
  g.document = doc;
  g.Node = Node;
  g.Element = Element;
  g.HTMLElement = HTMLElement;
  g.HTMLIFrameElement = HTMLIFrameElement;
  g.navigator = { userAgent: 'node' };

  return { el, doc, win };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('useDirWatch', () => {
  let root: Root | null = null;
  let nextWatcherId = 100;
  let activeListeners: Set<(e: WatchEvent) => void>;
  let watchStartCalls: string[];
  let watchStopCalls: number[];

  beforeEach(() => {
    const { el } = setupDOM();
    root = createRoot(el as unknown as globalThis.Element);
    nextWatcherId = 100;
    activeListeners = new Set();
    watchStartCalls = [];
    watchStopCalls = [];

    const electronMock = {
      watchStart: async (dir: string) => {
        watchStartCalls.push(dir);
        return ++nextWatcherId;
      },
      watchStop: async (id: number) => {
        watchStopCalls.push(id);
      },
      onWatchEvent: (cb: (e: WatchEvent) => void) => {
        activeListeners.add(cb);
        return () => {
          activeListeners.delete(cb);
        };
      },
    };

    Object.assign(api, electronMock);
  });

  afterEach(() => {
    if (root) {
      root.unmount();
      root = null;
    }
  });

  function emitWatchEvent(event: WatchEvent) {
    for (const listener of activeListeners) {
      listener(event);
    }
  }

  test('does not start watcher when enabled is false', async () => {
    function TestComponent() {
      useDirWatch('/home/test', false, () => {});
      return null;
    }

    root!.render(React.createElement(TestComponent));
    await delay(50);

    expect(watchStartCalls.length).toBe(0);
    expect(activeListeners.size).toBe(0);
  });

  test('does not start watcher when dir is null or app://', async () => {
    function TestComponent({ dir }: { dir: string | null }) {
      useDirWatch(dir, true, () => {});
      return null;
    }

    root!.render(React.createElement(TestComponent, { dir: null }));
    await delay(50);
    expect(watchStartCalls.length).toBe(0);

    root!.render(React.createElement(TestComponent, { dir: 'app://dashboard' }));
    await delay(50);
    expect(watchStartCalls.length).toBe(0);
  });

  test('starts watcher and dispatches change/error only for matching watcher id', async () => {
    const receivedEvents: string[] = [];

    function TestComponent() {
      useDirWatch('/home/test', true, (type) => {
        receivedEvents.push(type);
      });
      return null;
    }

    root!.render(React.createElement(TestComponent));
    await delay(50);

    expect(watchStartCalls).toEqual(['/home/test']);
    const watcherId = nextWatcherId;

    // Event with different id should be ignored
    emitWatchEvent({ id: 9999, type: 'change' });
    expect(receivedEvents).toEqual([]);

    // Event with matching id should trigger onEvent
    emitWatchEvent({ id: watcherId, type: 'change' });
    expect(receivedEvents).toEqual(['change']);

    emitWatchEvent({ id: watcherId, type: 'error', message: 'directory deleted' });
    expect(receivedEvents).toEqual(['change', 'error']);
  });

  test('stops watcher on unmount', async () => {
    function TestComponent() {
      useDirWatch('/home/test', true, () => {});
      return null;
    }

    root!.render(React.createElement(TestComponent));
    await delay(50);

    const startedId = nextWatcherId;
    expect(watchStopCalls).toEqual([]);

    root!.unmount();
    root = null;
    await delay(50);

    expect(watchStopCalls).toEqual([startedId]);
    expect(activeListeners.size).toBe(0);
  });

  test('stops old watcher and starts new one when dir changes', async () => {
    function TestComponent({ dir }: { dir: string }) {
      useDirWatch(dir, true, () => {});
      return null;
    }

    root!.render(React.createElement(TestComponent, { dir: '/dir/one' }));
    await delay(50);

    const firstId = nextWatcherId;
    expect(watchStartCalls).toEqual(['/dir/one']);

    root!.render(React.createElement(TestComponent, { dir: '/dir/two' }));
    await delay(50);

    expect(watchStopCalls).toEqual([firstId]);
    expect(watchStartCalls).toEqual(['/dir/one', '/dir/two']);
  });

  test('inline onEvent change does not restart the watcher', async () => {
    function TestComponent() {
      const [count, setCount] = useState(0);
      useDirWatch('/home/test', true, () => {
        // inline callback closing over count
        void count;
      });
      return React.createElement('button', {
        onClick: () => setCount((c) => c + 1),
      });
    }

    root!.render(React.createElement(TestComponent));
    await delay(50);

    expect(watchStartCalls.length).toBe(1);

    // Re-render TestComponent
    root!.render(React.createElement(TestComponent));
    await delay(50);

    expect(watchStartCalls.length).toBe(1);
    expect(watchStopCalls.length).toBe(0);
  });

  test('tolerates watchStart resolving after unmount by immediately calling watchStop', async () => {
    let resolveLateStart!: (id: number) => void;
    api.watchStart = () =>
      new Promise<number>((resolve) => {
        resolveLateStart = resolve;
      });

    function TestComponent() {
      useDirWatch('/home/late', true, () => {});
      return null;
    }

    root!.render(React.createElement(TestComponent));
    await delay(20);

    // Unmount before watchStart resolves
    root!.unmount();
    root = null;
    await delay(20);

    // Now resolve watchStart late with id 777
    resolveLateStart(777);
    await delay(20);

    expect(watchStopCalls).toContain(777);
  });
});
