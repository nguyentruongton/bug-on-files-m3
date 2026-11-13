import type { IFile } from '../types/files';

export type WatchEvent =
    | { id: number; type: 'change' }
    | { id: number; type: 'error'; message: string };

export type TextPreview =
    | { kind: 'text'; content: string }
    | { kind: 'too-large'; size: number }
    | { kind: 'binary' }
    | { kind: 'error' };

export interface IDrive {
    name: string;
    label: string;
    mountpoint: string;
    size: string;
    type: string;
    removable: boolean;
    usb: boolean;
}

export interface VideoMetadata {
    width?: number | null;
    height?: number | null;
    durationSeconds?: number | null;
    codec?: string | null;
}

export interface IApi {
    getThemeCss: () => Promise<string | null>;
    listDir: (path: string) => Promise<IFile[]>;
    getParentPath: (path: string) => Promise<string>;
    getHomePath: () => Promise<string>;
    getPlaces: () => Promise<Array<{ name: string; path: string; icon: string }>>;
    copyFile: (source: string, dest: string) => Promise<boolean>;
    moveFile: (source: string, dest: string) => Promise<boolean>;
    trashFile: (path: string) => Promise<boolean>;
    renameFile: (oldPath: string, newPath: string) => Promise<boolean>;
    createDirectory: (path: string) => Promise<boolean>;
    openPath: (path: string) => Promise<string>;
    extractFile: (path: string) => Promise<boolean>;
    getApps: () => Promise<{ name: string; icon: string; exec: string; }[]>;
    openWith: (exec: string, path: string) => Promise<boolean>;
    openFileDialog: () => Promise<string | null>;
    openDirectoryDialog: () => Promise<string | null>;
    readFile: (path: string) => Promise<string | null>;
    readTextPreview: (path: string) => Promise<TextPreview>;
    startDrag: (path: string, iconPath?: string) => void;
    getStartupPath: () => Promise<string | null>;
    search: (directory: string, query: string, options?: { type?: 'f' | 'd', minSize?: string, maxSize?: string }) => Promise<IFile[]>;
    getDirectorySize: (path: string) => Promise<number>;
    setIcon: (iconType: string) => Promise<void>;
    exists: (path: string) => Promise<boolean>;
    getStorageUsage: () => Promise<{ total: number; used: number; free: number } | null>;
    getDrives: () => Promise<IDrive[]>;
    getRecommendedApps: (path: string) => Promise<{ name: string; icon: string | null; exec: string; path: string; }[]>;
    watchStart: (dir: string) => Promise<number>;
    watchStop: (id: number) => Promise<void>;
    onWatchEvent: (cb: (e: WatchEvent) => void) => () => void;
    getVideoMetadata: (path: string) => Promise<VideoMetadata | null>;

    // PTY
    ptySpawn: (cwd: string) => Promise<number>;
    ptyWrite: (pid: number, data: string) => void;
    ptyResize: (pid: number, cols: number, rows: number) => void;
    ptyKill: (pid: number) => void;
    ptyOnData: (pid: number, callback: (data: string) => void) => () => void;
    ptyOnExit: (pid: number, callback: () => void) => () => void;
}

export type IElectronAPI = IApi;

