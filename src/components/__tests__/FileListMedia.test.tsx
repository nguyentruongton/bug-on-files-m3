import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IFile } from '../../types/files';
import {
    FileList,
    MediaThumbnail,
    shouldSuppressClickAfterDrag,
    shouldSuppressFileClick,
} from '../FileList';

function makeFile(name: string, overrides: Partial<IFile> = {}): IFile {
    return {
        name,
        path: `/home/u/${name}`,
        isDirectory: false,
        size: 1024,
        mtime: new Date('2026-05-01T10:00:00Z'),
        ...overrides,
    };
}

describe('FileList media thumbnails and play badge', () => {
    test('renders lazy grid thumbnail and play badge for video and extended image candidates in list view', () => {
        const files: IFile[] = [
            makeFile('clip.mp4'),
            makeFile('photo.heic'),
            makeFile('stream.ts', { mediaKind: 'video' }),
            makeFile('doc.txt'),
            makeFile('docs', { isDirectory: true }),
        ];

        const html = renderToStaticMarkup(
            <FileList
                files={files}
                selectedFiles={new Set()}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="list"
                iconSize={64}
                filledIcons
                groupingEnabled={false}
                sortBy="name"
                sortOrder="asc"
            />
        );

        // Videos render thumbnail pointing to media://thumb
        expect(html).toContain('src="media://thumb/home/u/clip.mp4?size=grid"');
        expect(html).toContain('src="media://thumb/home/u/photo.heic?size=grid"');
        expect(html).toContain('src="media://thumb/home/u/stream.ts?size=grid"');

        // Lazy loading and async decoding
        expect(html).toContain('loading="lazy"');
        expect(html).toContain('decoding="async"');

        // Play badge icon for videos
        expect(html).toContain('play_arrow');
        expect(html).toContain('pointer-events-none');

        // Non-media and directories do not render media://thumb
        expect(html).not.toContain('media://thumb/home/u/doc.txt');
        expect(html).not.toContain('media://thumb/home/u/docs');
    });

    test('renders lazy grid thumbnail and play badge for videos in grid view', () => {
        const files: IFile[] = [
            makeFile('clip.mp4'),
            makeFile('photo.heic'),
            makeFile('code.ts'),
        ];

        const html = renderToStaticMarkup(
            <FileList
                files={files}
                selectedFiles={new Set()}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="grid"
                iconSize={64}
                filledIcons
                groupingEnabled={false}
                sortBy="name"
                sortOrder="asc"
            />
        );

        expect(html).toContain('src="media://thumb/home/u/clip.mp4?size=grid"');
        expect(html).toContain('src="media://thumb/home/u/photo.heic?size=grid"');
        expect(html).toContain('play_arrow');
        expect(html).toContain('pointer-events-none');
        expect(html).not.toContain('media://thumb/home/u/code.ts');
    });

    test('bounds mounted DOM cards in Grid View for large folders (500 items)', () => {
        const files: IFile[] = Array.from({ length: 500 }, (_, i) =>
            makeFile(`photo_${String(i).padStart(4, '0')}.png`)
        );

        const html = renderToStaticMarkup(
            <FileList
                files={files}
                selectedFiles={new Set()}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="grid"
                iconSize={64}
                filledIcons
                groupingEnabled={false}
                sortBy="name"
                sortOrder="asc"
            />
        );

        const renderedItemMatches = html.match(/data-file-path="/g) ?? [];
        expect(renderedItemMatches.length).toBeGreaterThan(0);
        expect(renderedItemMatches.length).toBeLessThan(120);
    });

    test('routes video shape pair to video candidate with mediaKind: "video"', () => {
        const videoFile = makeFile('stream.ts', { mediaKind: 'video' });
        const html = renderToStaticMarkup(
            <FileList
                files={[videoFile]}
                selectedFiles={new Set()}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="list"
                iconSize={64}
                filledIcons
                groupingEnabled={false}
                sortBy="name"
                sortOrder="asc"
            />
        );

        // Video shape pair uses bg-m3-secondary-container text-m3-on-secondary-container
        expect(html).toContain('bg-m3-secondary-container text-m3-on-secondary-container');
    });
});

describe('MediaThumbnail subcomponent', () => {
    test('renders thumbnail image and play badge for video file', () => {
        const file = makeFile('video.mov');
        const html = renderToStaticMarkup(
            <MediaThumbnail
                file={file}
                iconName="movie"
                iconSize={32}
                filled
            />
        );

        expect(html).toContain('src="media://thumb/home/u/video.mov?size=grid"');
        expect(html).toContain('alt="video.mov"');
        expect(html).toContain('loading="lazy"');
        expect(html).toContain('decoding="async"');
        expect(html).toContain('play_arrow');
        expect(html).toContain('pointer-events-none');
    });

    test('renders thumbnail image without play badge for photo file', () => {
        const file = makeFile('photo.avif');
        const html = renderToStaticMarkup(
            <MediaThumbnail
                file={file}
                iconName="image"
                iconSize={32}
                filled
            />
        );

        expect(html).toContain('src="media://thumb/home/u/photo.avif?size=grid"');
        expect(html).toContain('alt="photo.avif"');
        expect(html).not.toContain('play_arrow');
    });

    test('renders fallback Icon for non-media file', () => {
        const file = makeFile('report.pdf');
        const html = renderToStaticMarkup(
            <MediaThumbnail
                file={file}
                iconName="picture_as_pdf"
                iconSize={24}
                filled={false}
            />
        );

        expect(html).not.toContain('<img');
        expect(html).toContain('picture_as_pdf');
    });

    test('renders fallback Icon instead of empty img when failed state matches file.path', () => {
        const file = makeFile('broken.mp4');
        const html = renderToStaticMarkup(
            <MediaThumbnail
                file={file}
                iconName="movie"
                iconSize={24}
                filled
                initialFailedPath="/home/u/broken.mp4"
            />
        );

        // Fallback icon must be rendered
        expect(html).toContain('movie');
        // No img tag or play badge rendered in failed state
        expect(html).not.toContain('<img');
        expect(html).not.toContain('play_arrow');
    });
});

describe('FileList drag click suppression helper', () => {
    test('shouldSuppressClickAfterDrag suppresses clicks only before deadline', () => {
        expect(shouldSuppressClickAfterDrag(1000, 950)).toBe(true);
        expect(shouldSuppressClickAfterDrag(1000, 1050)).toBe(false);
    });

    test('shouldSuppressFileClick suppresses throughout active drag even past deadline, and respects post-drag deadline', () => {
        expect(shouldSuppressFileClick(true, 1000, 2000)).toBe(true);
        expect(shouldSuppressFileClick(false, 1000, 950)).toBe(true);
        expect(shouldSuppressFileClick(false, 1000, 1000)).toBe(false);
    });
});

describe('FileList mounted click suppression across long drags', () => {
    class MockNode {
        nodeType = 1;
        parentNode: MockNode | null = null;
        childNodes: MockNode[] = [];
        ownerDocument: MockDocument | null = null;
        textContent: string | null = null;

        appendChild<T extends MockNode>(child: T): T {
            if (child.parentNode) child.parentNode.removeChild(child);
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
            if (!refNode) return this.appendChild(newNode);
            if (newNode.parentNode) newNode.parentNode.removeChild(newNode);
            const idx = this.childNodes.indexOf(refNode);
            if (idx === -1) return this.appendChild(newNode);
            newNode.parentNode = this;
            this.childNodes.splice(idx, 0, newNode);
            return newNode;
        }
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
        clientWidth = 800;
        clientHeight = 600;
        scrollTop = 0;

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
        dispatchEvent(ev: {
            type: string;
            target?: unknown;
            currentTarget?: unknown;
            defaultPrevented?: boolean;
            bubbles?: boolean;
            cancelable?: boolean;
            eventPhase?: number;
            preventDefault?: () => void;
            stopPropagation?: () => void;
        }): boolean {
            ev.target ??= this;
            ev.bubbles ??= true;
            ev.cancelable ??= true;
            ev.eventPhase ??= 3;
            ev.preventDefault ??= () => {
                ev.defaultPrevented = true;
            };
            ev.stopPropagation ??= () => {};
            for (const cb of this.listeners.get(ev.type) ?? []) {
                ev.currentTarget = this;
                cb(ev);
            }
            let parent = this.parentNode;
            while (parent) {
                if (parent instanceof MockElement) {
                    ev.currentTarget = parent;
                    for (const cb of parent.listeners.get(ev.type) ?? []) {
                        cb(ev);
                    }
                }
                parent = parent.parentNode;
            }
            return !ev.defaultPrevented;
        }
        getAttribute(name: string): string | null {
            return this.attributes.get(name) ?? null;
        }
        setAttribute(name: string, value: string) {
            this.attributes.set(name, String(value));
        }
        removeAttribute(name: string) {
            this.attributes.delete(name);
        }
        focus() {}
        querySelectorAll(selector: string): MockElement[] {
            const attrMatch = selector.match(/^\[([^=\]]+)="([^"]*)"\]$/);
            const attrOnlyMatch = selector.match(/^\[([^=\]]+)\]$/);
            const out: MockElement[] = [];
            const visit = (node: MockNode) => {
                if (node instanceof MockElement) {
                    if (attrMatch && node.getAttribute(attrMatch[1]) === attrMatch[2]) {
                        out.push(node);
                    } else if (attrOnlyMatch && node.getAttribute(attrOnlyMatch[1]) !== null) {
                        out.push(node);
                    }
                }
                for (const child of node.childNodes) {
                    visit(child);
                }
            };
            visit(this);
            return out;
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

    class MockDocument extends MockNode {
        override nodeType = 9;
        defaultView: unknown = null;
        documentElement: MockElement;
        body: MockElement;
        activeElement: MockElement | null = null;
        listeners = new Map<string, Set<(ev: unknown) => void>>();

        constructor() {
            super();
            this.documentElement = new MockHTMLElement('HTML', this);
            this.body = new MockHTMLElement('BODY', this);
            this.documentElement.appendChild(this.body);
            this.appendChild(this.documentElement);
        }
        createElement(tag: string) {
            return new MockHTMLElement(tag, this);
        }
        createElementNS(_ns: string, tag: string) {
            return new MockSVGElement(tag, this);
        }
        createTextNode(text: string) {
            return new MockText(text, this);
        }
        createComment() {
            return new MockComment();
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
    }

    const DOM_KEYS = [
        'window',
        'document',
        'Node',
        'Element',
        'HTMLElement',
        'HTMLIFrameElement',
        'SVGElement',
        'navigator',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'ResizeObserver',
    ] as const;

    const saved = new Map<string, { present: boolean; value: unknown }>();
    for (const key of DOM_KEYS) {
        const g = globalThis as Record<string, unknown>;
        saved.set(key, { present: key in g, value: g[key] });
    }

    function restoreDomGlobals() {
        const g = globalThis as Record<string, unknown>;
        for (const key of DOM_KEYS) {
            const entry = saved.get(key);
            if (entry && entry.present) {
                g[key] = entry.value;
            } else {
                delete g[key];
            }
        }
    }

    function setupDom() {
        const doc = new MockDocument();
        const container = doc.createElement('div');
        doc.body.appendChild(container);
        const win = {
            document: doc,
            Node: MockNode,
            Element: MockElement,
            HTMLElement: MockHTMLElement,
            HTMLIFrameElement: MockHTMLIFrameElement,
            SVGElement: MockSVGElement,
            addEventListener: () => {},
            removeEventListener: () => {},
            requestAnimationFrame: (cb: (ts: number) => void) =>
                setTimeout(() => cb(Date.now()), 0) as unknown as number,
            cancelAnimationFrame: (id: number) => clearTimeout(id),
        };
        doc.defaultView = win;

        const g = globalThis as Record<string, unknown>;
        g.window = win;
        g.document = doc;
        g.Node = MockNode;
        g.Element = MockElement;
        g.HTMLElement = MockHTMLElement;
        g.HTMLIFrameElement = MockHTMLIFrameElement;
        g.SVGElement = MockSVGElement;
        g.navigator = { userAgent: 'node' };
        g.requestAnimationFrame = win.requestAnimationFrame;
        g.cancelAnimationFrame = win.cancelAnimationFrame;
        g.ResizeObserver = class {
            observe() {}
            disconnect() {}
        };
        return { container, doc };
    }

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    async function waitFor<T>(fn: () => T | null | undefined, timeoutMs = 1000): Promise<T> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const val = fn();
            if (val !== null && val !== undefined) return val;
            await delay(10);
        }
        throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }

    let root: Root | null = null;
    let container: MockElement;

    beforeEach(() => {
        const dom = setupDom();
        container = dom.container;
        root = createRoot(container as unknown as globalThis.Element, {
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
        }
        await delay(20);
        restoreDomGlobals();
    });

    afterAll(async () => {
        await delay(20);
        restoreDomGlobals();
    });

    test('suppresses click throughout >350ms drag and for 300ms after isDragging transitions true -> false, clearing on pointerdown', async () => {
        const file = makeFile('report.pdf');
        const selectedCalls: string[] = [];
        const navigatedCalls: string[] = [];
        const startedDragCalls: IFile[][] = [];

        const renderWithDragging = (dragging: boolean, selected = false) => {
            root!.render(
                <FileList
                    files={[file]}
                    selectedFiles={selected ? new Set([file.path]) : new Set()}
                    onSelect={(f) => selectedCalls.push(f.path)}
                    onNavigate={(f) => navigatedCalls.push(f.path)}
                    viewMode="grid"
                    iconSize={64}
                    filledIcons
                    groupingEnabled={false}
                    isDragging={dragging}
                    onStartOutboundDrag={(items) => startedDragCalls.push(items)}
                />
            );
        };

        renderWithDragging(false);
        const card = await waitFor(
            () => container.querySelectorAll(`[data-file-path="${file.path}"]`)[0]
        );

        // Start drag on unselected item: handleItemDragStart selects it and triggers outbound drag
        card.dispatchEvent({ type: 'dragstart' });
        expect(startedDragCalls).toEqual([[file]]);
        expect(selectedCalls).toEqual([file.path]);
        selectedCalls.length = 0;

        renderWithDragging(true, true);
        await delay(400); // > 350ms old timer!

        // While drag is still active at 400ms, click must remain suppressed
        card.dispatchEvent({ type: 'click' });
        expect(selectedCalls).toEqual([]);
        expect(navigatedCalls).toEqual([]);

        // Drag ends (onNativeDragEnd -> isDragging: true -> false)
        renderWithDragging(false, true);
        await delay(30);

        // Trailing click within 300ms after isDragging: true -> false is still suppressed
        card.dispatchEvent({ type: 'click' });
        expect(selectedCalls).toEqual([]);
        expect(navigatedCalls).toEqual([]);

        // Re-arm suppression via another true -> false transition, then verify pointerdown clears it immediately
        renderWithDragging(true, true);
        await delay(20);
        renderWithDragging(false, true);
        await delay(30);

        card.dispatchEvent({ type: 'pointerdown' });
        card.dispatchEvent({ type: 'click' });
        expect(navigatedCalls).toEqual([file.path]);

        // Also verify suppression expires naturally after 300ms
        renderWithDragging(true, true);
        await delay(20);
        renderWithDragging(false, true);
        await delay(330);

        card.dispatchEvent({ type: 'click' });
        expect(navigatedCalls).toEqual([file.path, file.path]);
    });
});
