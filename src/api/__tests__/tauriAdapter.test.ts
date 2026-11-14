import { describe, expect, test } from 'bun:test';
import { createTauriAdapter } from '../tauriAdapter';
import { COMMAND_MAP } from '../commandMap';
import type { IApi, WatchEvent } from '../types';

describe('tauriAdapter', () => {
    test('every COMMAND_MAP key exists on the adapter', () => {
        const invoke = async () => {};
        const listen = async () => () => {};
        const adapter = createTauriAdapter(invoke, listen);

        for (const key of Object.keys(COMMAND_MAP) as (keyof typeof COMMAND_MAP)[]) {
            expect(typeof (adapter as any)[key]).toBe('function');
        }
        expect(typeof adapter.startDrag).toBe('function');
        expect(typeof adapter.onWatchEvent).toBe('function');
        expect(typeof adapter.ptyOnData).toBe('function');
        expect(typeof adapter.ptyOnExit).toBe('function');
    });

    test('listDir calls list_dir with { path } and converts mtimeMs to Date', async () => {
        const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
        const invoke = async (cmd: string, args?: Record<string, unknown>) => {
            calls.push({ cmd, args });
            return [
                {
                    name: 'file.txt',
                    path: '/tmp/file.txt',
                    isDirectory: false,
                    size: 1234,
                    mtimeMs: 1700000000000,
                },
            ];
        };
        const listen = async () => () => {};
        const adapter = createTauriAdapter(invoke, listen);

        const files = await adapter.listDir('/tmp');
        expect(calls).toEqual([{ cmd: 'list_dir', args: { path: '/tmp' } }]);
        expect(files.length).toBe(1);
        expect(files[0].name).toBe('file.txt');
        expect(files[0].path).toBe('/tmp/file.txt');
        expect(files[0].isDirectory).toBe(false);
        expect(files[0].size).toBe(1234);
        expect(files[0].mtime).toBeInstanceOf(Date);
        expect(files[0].mtime.getTime()).toBe(1700000000000);
    });

    test('copyFile calls copy_file with { source, dest }', async () => {
        const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
        const invoke = async (cmd: string, args?: Record<string, unknown>) => {
            calls.push({ cmd, args });
            return true;
        };
        const listen = async () => () => {};
        const adapter = createTauriAdapter(invoke, listen);

        const result = await adapter.copyFile('/a', '/b');
        expect(result).toBe(true);
        expect(calls).toEqual([{ cmd: 'copy_file', args: { source: '/a', dest: '/b' } }]);
    });

    test('onWatchEvent unsubscribes even if called before listen resolves', async () => {
        let unlistenCalled = false;
        let resolveListen!: (unlisten: () => void) => void;
        const listenPromise = new Promise<() => void>((resolve) => {
            resolveListen = resolve;
        });

        const listen = async (event: string, _cb: (payload: unknown) => void) => {
            expect(event).toBe('fs:watch-event');
            return listenPromise;
        };
        const invoke = async () => {};
        const adapter = createTauriAdapter(invoke, listen);

        const unsub = adapter.onWatchEvent(() => {});
        // Call unsub immediately BEFORE listen resolves
        unsub();

        // Now resolve listen
        resolveListen(() => {
            unlistenCalled = true;
        });

        // Allow microtasks / macrotasks to run
        await new Promise((r) => setTimeout(r, 10));

        expect(unlistenCalled).toBe(true);
    });

    test('ptyOnData subscribes to terminal:data:7 for pid 7', async () => {
        let subscribedEvent = '';
        let emittedData = '';
        let registeredCb: ((payload: unknown) => void) | null = null;

        const listen = async (event: string, cb: (payload: unknown) => void) => {
            subscribedEvent = event;
            registeredCb = cb;
            return () => {};
        };
        const invoke = async () => {};
        const adapter = createTauriAdapter(invoke, listen);

        adapter.ptyOnData(7, (data) => {
            emittedData = data;
        });

        expect(subscribedEvent).toBe('terminal:data:7');
        expect(registeredCb).not.toBeNull();
        registeredCb!('hello terminal');
        expect(emittedData).toBe('hello terminal');
    });

    test('ptyOnExit subscribes to terminal:exit:7 for pid 7', async () => {
        let subscribedEvent = '';
        let exitCalled = false;
        let registeredCb: ((payload: unknown) => void) | null = null;

        const listen = async (event: string, cb: (payload: unknown) => void) => {
            subscribedEvent = event;
            registeredCb = cb;
            return () => {};
        };
        const invoke = async () => {};
        const adapter = createTauriAdapter(invoke, listen);

        adapter.ptyOnExit(7, () => {
            exitCalled = true;
        });

        expect(subscribedEvent).toBe('terminal:exit:7');
        expect(registeredCb).not.toBeNull();
        registeredCb!(null);
        expect(exitCalled).toBe(true);
    });

    test('search calls search with { directory, query, options } and converts mtimeMs to Date', async () => {
        const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
        const invoke = async (cmd: string, args?: Record<string, unknown>) => {
            calls.push({ cmd, args });
            return [
                {
                    name: 'found.txt',
                    path: '/tmp/found.txt',
                    isDirectory: false,
                    size: 50,
                    mtimeMs: 1600000000000,
                },
            ];
        };
        const listen = async () => () => {};
        const adapter = createTauriAdapter(invoke, listen);

        const results = await adapter.search('/tmp', 'found', { type: 'f' });
        expect(calls).toEqual([
            { cmd: 'search', args: { directory: '/tmp', query: 'found', options: { type: 'f' } } },
        ]);
        expect(results.length).toBe(1);
        expect(results[0].mtime).toBeInstanceOf(Date);
        expect(results[0].mtime.getTime()).toBe(1600000000000);
    });

    test('startDrag is a no-op that does not throw', () => {
        const invoke = async () => {};
        const listen = async () => () => {};
        const adapter = createTauriAdapter(invoke, listen);

        expect(() => adapter.startDrag('/some/path')).not.toThrow();
    });

    test('listDir preserves mediaKind: "video" when present and leaves undefined otherwise', async () => {
        const invoke = async () => [
            {
                name: 'clip.mp4',
                path: '/tmp/clip.mp4',
                isDirectory: false,
                size: 1000,
                mtimeMs: 1700000000000,
                mediaKind: 'video',
            },
            {
                name: 'stream.ts',
                path: '/tmp/stream.ts',
                isDirectory: false,
                size: 2000,
                mtimeMs: 1700000000000,
                media_kind: 'video',
            },
            {
                name: 'notes.txt',
                path: '/tmp/notes.txt',
                isDirectory: false,
                size: 500,
                mtimeMs: 1700000000000,
            },
        ];
        const listen = async () => () => {};
        const adapter = createTauriAdapter(invoke, listen);

        const files = await adapter.listDir('/tmp');
        expect(files.length).toBe(3);
        expect(files[0].mediaKind).toBe('video');
        expect(files[1].mediaKind).toBe('video');
        expect(files[2].mediaKind).toBeUndefined();
    });

    test('getVideoMetadata calls get_video_metadata with { path } and returns payload', async () => {
        const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
        const mockPayload = {
            width: 1920,
            height: 1080,
            durationSeconds: 12.5,
            codec: 'h264',
        };
        const invoke = async (cmd: string, args?: Record<string, unknown>) => {
            calls.push({ cmd, args });
            return mockPayload;
        };
        const listen = async () => () => {};
        const adapter = createTauriAdapter(invoke, listen);

        const result = await adapter.getVideoMetadata('/tmp/clip.mkv');
        expect(calls).toEqual([{ cmd: 'get_video_metadata', args: { path: '/tmp/clip.mkv' } }]);
        expect(result).toEqual(mockPayload);
    });

    test('listTrash maps trashId and originalParent, and restoreTrashItems/purgeTrashItems/emptyTrash invoke expected commands', async () => {
        const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
        const invoke = async (cmd: string, args?: Record<string, unknown>) => {
            calls.push({ cmd, args });
            if (cmd === 'list_trash') {
                return [
                    {
                        name: 'deleted.txt',
                        path: '/home/u/.local/share/Trash/files/deleted.txt',
                        isDirectory: false,
                        size: 42,
                        mtimeMs: 1700000000000,
                        trashId: '/home/u/.local/share/Trash/info/deleted.txt.trashinfo',
                        originalParent: '/home/u/Documents',
                    },
                ];
            }
            return true;
        };
        const listen = async () => () => {};
        const adapter = createTauriAdapter(invoke, listen);

        const items = await adapter.listTrash();
        expect(items).toHaveLength(1);
        expect(items[0].trashId).toBe('/home/u/.local/share/Trash/info/deleted.txt.trashinfo');
        expect(items[0].originalParent).toBe('/home/u/Documents');

        await adapter.restoreTrashItems(['id1']);
        await adapter.purgeTrashItems(['id2']);
        await adapter.emptyTrash();

        expect(calls).toEqual([
            { cmd: 'list_trash', args: undefined },
            { cmd: 'restore_trash_items', args: { ids: ['id1'] } },
            { cmd: 'purge_trash_items', args: { ids: ['id2'] } },
            { cmd: 'empty_trash', args: undefined },
        ]);
    });
});
