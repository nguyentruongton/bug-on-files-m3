import type { IFile } from '../types/files';
import type { ExtractProgressEvent, IApi, IDrive, TextPreview, VideoMetadata, WatchEvent } from './types';
import { COMMAND_MAP } from './commandMap';

export type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
export type ListenFn = (event: string, cb: (payload: unknown) => void) => Promise<() => void>;

interface RawFileEntry {
    name: string;
    path: string;
    isDirectory?: boolean;
    is_directory?: boolean;
    size: number;
    mtimeMs?: number;
    mtime_ms?: number;
    mediaKind?: 'video';
    media_kind?: 'video';
    trashId?: string;
    trash_id?: string;
    originalParent?: string;
    original_parent?: string;
}

function toIFile(entry: RawFileEntry): IFile {
    const mtimeMs = entry.mtimeMs ?? entry.mtime_ms ?? 0;
    const rawMediaKind = entry.mediaKind ?? entry.media_kind;
    const trashId = entry.trashId ?? entry.trash_id;
    const originalParent = entry.originalParent ?? entry.original_parent;
    const file: IFile = {
        name: entry.name,
        path: entry.path,
        isDirectory: Boolean(entry.isDirectory ?? entry.is_directory),
        size: entry.size,
        mtime: new Date(mtimeMs),
    };
    if (rawMediaKind === 'video') {
        file.mediaKind = 'video';
    }
    if (trashId !== undefined) {
        file.trashId = trashId;
    }
    if (originalParent !== undefined) {
        file.originalParent = originalParent;
    }
    return file;
}

function wrapListener(listenPromise: Promise<() => void>): () => void {
    let unlisten: (() => void) | null = null;
    let unsubscribed = false;

    listenPromise
        .then((fn) => {
            if (unsubscribed) {
                if (typeof fn === 'function') {
                    fn();
                }
            } else {
                unlisten = fn;
            }
        })
        .catch(() => {
            // ignore listen errors during teardown
        });

    return () => {
        unsubscribed = true;
        if (unlisten) {
            unlisten();
            unlisten = null;
        }
    };
}

export function createTauriAdapter(invoke: InvokeFn, listen: ListenFn): IApi {
    return {
        getThemeCss: () => invoke(COMMAND_MAP.getThemeCss) as Promise<string | null>,
        listDir: async (path: string): Promise<IFile[]> => {
            const raw = (await invoke(COMMAND_MAP.listDir, { path })) as RawFileEntry[];
            return raw.map(toIFile);
        },
        getParentPath: (path: string) =>
            invoke(COMMAND_MAP.getParentPath, { path }) as Promise<string>,
        getHomePath: () => invoke(COMMAND_MAP.getHomePath) as Promise<string>,
        getPlaces: () =>
            invoke(COMMAND_MAP.getPlaces) as Promise<
                Array<{ name: string; path: string; icon: string }>
            >,
        copyFile: (source: string, dest: string) =>
            invoke(COMMAND_MAP.copyFile, { source, dest }) as Promise<boolean>,
        moveFile: (source: string, dest: string) =>
            invoke(COMMAND_MAP.moveFile, { source, dest }) as Promise<boolean>,
        trashFile: (path: string) =>
            invoke(COMMAND_MAP.trashFile, { path }) as Promise<boolean>,
        listTrash: async (): Promise<IFile[]> => {
            const raw = (await invoke(COMMAND_MAP.listTrash)) as RawFileEntry[];
            return raw.map(toIFile);
        },
        restoreTrashItems: (ids: string[]) =>
            invoke(COMMAND_MAP.restoreTrashItems, { ids }) as Promise<boolean>,
        purgeTrashItems: (ids: string[]) =>
            invoke(COMMAND_MAP.purgeTrashItems, { ids }) as Promise<boolean>,
        emptyTrash: () =>
            invoke(COMMAND_MAP.emptyTrash) as Promise<boolean>,
        renameFile: (oldPath: string, newPath: string) =>
            invoke(COMMAND_MAP.renameFile, { oldPath, newPath }) as Promise<boolean>,
        createDirectory: (path: string) =>
            invoke(COMMAND_MAP.createDirectory, { path }) as Promise<boolean>,
        openPath: (path: string) =>
            invoke(COMMAND_MAP.openPath, { path }) as Promise<string>,
        extractFile: (path: string) =>
            invoke(COMMAND_MAP.extractFile, { path }) as Promise<boolean>,
        getApps: () =>
            invoke(COMMAND_MAP.getApps) as Promise<
                { name: string; icon: string; exec: string }[]
            >,
        openWith: (exec: string, path: string) =>
            invoke(COMMAND_MAP.openWith, { exec, path }) as Promise<boolean>,
        openFileDialog: () =>
            invoke(COMMAND_MAP.openFileDialog) as Promise<string | null>,
        openDirectoryDialog: () =>
            invoke(COMMAND_MAP.openDirectoryDialog) as Promise<string | null>,
        readFile: (path: string) =>
            invoke(COMMAND_MAP.readFile, { path }) as Promise<string | null>,
        readTextPreview: (path: string) =>
            invoke(COMMAND_MAP.readTextPreview, { path }) as Promise<TextPreview>,
        startDrag: (_path: string, _iconPath?: string) => {
            // Deferred no-op in Tauri
        },
        getStartupPath: () =>
            invoke(COMMAND_MAP.getStartupPath) as Promise<string | null>,
        search: async (
            directory: string,
            query: string,
            options?: { type?: 'f' | 'd'; minSize?: string; maxSize?: string }
        ): Promise<IFile[]> => {
            const raw = (await invoke(COMMAND_MAP.search, {
                directory,
                query,
                options,
            })) as RawFileEntry[];
            return raw.map(toIFile);
        },
        getDirectorySize: (path: string) =>
            invoke(COMMAND_MAP.getDirectorySize, { path }) as Promise<number>,
        setIcon: (iconType: string) =>
            invoke(COMMAND_MAP.setIcon, { iconType }) as Promise<void>,
        exists: (path: string) =>
            invoke(COMMAND_MAP.exists, { path }) as Promise<boolean>,
        getStorageUsage: () =>
            invoke(COMMAND_MAP.getStorageUsage) as Promise<
                { total: number; used: number; free: number } | null
            >,
        getDrives: () => invoke(COMMAND_MAP.getDrives) as Promise<IDrive[]>,
        getRecommendedApps: (path: string) =>
            invoke(COMMAND_MAP.getRecommendedApps, { path }) as Promise<
                { name: string; icon: string | null; exec: string; path: string }[]
            >,
        watchStart: (dir: string) =>
            invoke(COMMAND_MAP.watchStart, { dir }) as Promise<number>,
        watchStop: (id: number) =>
            invoke(COMMAND_MAP.watchStop, { id }) as Promise<void>,
        onWatchEvent: (cb: (e: WatchEvent) => void) => {
            return wrapListener(
                listen('fs:watch-event', (payload) => cb(payload as WatchEvent))
            );
        },
        onExtractProgress: (cb: (e: ExtractProgressEvent) => void) => {
            return wrapListener(
                listen('fs:extract-progress', (payload) => cb(payload as ExtractProgressEvent))
            );
        },
        getVideoMetadata: (path: string) =>
            invoke(COMMAND_MAP.getVideoMetadata, { path }) as Promise<VideoMetadata | null>,
        ptySpawn: (cwd: string) =>
            invoke(COMMAND_MAP.ptySpawn, { cwd }) as Promise<number>,
        ptyWrite: (pid: number, data: string) => {
            void invoke(COMMAND_MAP.ptyWrite, { pid, data });
        },
        ptyResize: (pid: number, cols: number, rows: number) => {
            void invoke(COMMAND_MAP.ptyResize, { pid, cols, rows });
        },
        ptyKill: (pid: number) => {
            void invoke(COMMAND_MAP.ptyKill, { pid });
        },
        ptyOnData: (pid: number, callback: (data: string) => void) => {
            return wrapListener(
                listen(`terminal:data:${pid}`, (payload) => callback(payload as string))
            );
        },
        ptyOnExit: (pid: number, callback: () => void) => {
            return wrapListener(
                listen(`terminal:exit:${pid}`, () => callback())
            );
        },
    };
}
