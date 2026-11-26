import { describe, expect, test } from 'bun:test';
import type { IFile } from '../../types/files';
import {
  buildFileContextMenuItems,
  copyPathToClipboard,
  type FileContextMenuParams,
} from '../fileContextMenu';

function makeFile(name: string, isDirectory = false): IFile {
  return {
    name,
    path: `/home/user/${name}`,
    isDirectory,
    size: isDirectory ? 0 : 128,
    mtime: new Date('2026-11-26T00:00:00Z'),
  };
}

function makeParams(overrides: Partial<FileContextMenuParams> = {}): FileContextMenuParams {
  return {
    item: makeFile('notes.txt', false),
    targetItems: [makeFile('notes.txt', false)],
    isTrashView: false,
    currentPath: '/home/user',
    hasClipboardFiles: false,
    allSelectedAreArchives: false,
    onOpenFolder: () => {},
    onOpenFile: () => {},
    onOpenInNewTab: () => {},
    onOpenInTerminal: () => {},
    onCopyPath: () => {},
    onCopy: () => {},
    onCut: () => {},
    onDelete: () => {},
    onExtractHere: () => {},
    onExtractToOwnFolder: () => {},
    onExtractToDir: () => {},
    onCompress: () => {},
    onRename: () => {},
    onOpenWith: () => {},
    onProperties: () => {},
    onRestore: () => {},
    onPurge: () => {},
    onEmptyTrash: () => {},
    onNewFolder: () => {},
    onPaste: () => {},
    ...overrides,
  };
}

describe('buildFileContextMenuItems — Copy Path', () => {
  test('shows Copy Path right after the first divider and before Copy for a single file', () => {
    const copiedPaths: string[] = [];
    const file = makeFile('notes.txt', false);
    const items = buildFileContextMenuItems(
      makeParams({
        item: file,
        targetItems: [file],
        onCopyPath: (path) => copiedPaths.push(path),
      })
    );

    const copyPathIdx = items.findIndex((i) => i.label === 'Copy Path');
    const copyIdx = items.findIndex((i) => i.label === 'Copy');
    expect(copyPathIdx).toBeGreaterThan(0);
    expect(items[copyPathIdx - 1]?.divider).toBe(true);
    expect(copyIdx).toBe(copyPathIdx + 1);
    expect(items[copyPathIdx]?.icon).toBe('content_paste_go');

    items[copyPathIdx]!.action();
    expect(copiedPaths).toEqual(['/home/user/notes.txt']);
  });

  test('shows Copy Path for a single folder', () => {
    const folder = makeFile('Projects', true);
    const items = buildFileContextMenuItems(
      makeParams({
        item: folder,
        targetItems: [folder],
      })
    );

    expect(items.some((i) => i.label === 'Copy Path')).toBe(true);
  });

  test('does not show Copy Path for multi-selection', () => {
    const f1 = makeFile('a.txt', false);
    const f2 = makeFile('b.txt', false);
    const items = buildFileContextMenuItems(
      makeParams({
        item: f1,
        targetItems: [f1, f2],
      })
    );

    expect(items.some((i) => i.label === 'Copy Path')).toBe(false);
  });

  test('does not show Copy Path in Trash view', () => {
    const file = makeFile('deleted.txt', false);
    const items = buildFileContextMenuItems(
      makeParams({
        item: file,
        targetItems: [file],
        isTrashView: true,
        currentPath: 'app://trash',
      })
    );

    expect(items.some((i) => i.label === 'Copy Path')).toBe(false);
  });

  test('does not show Copy Path on background right-click', () => {
    const items = buildFileContextMenuItems(
      makeParams({
        item: null,
        targetItems: [],
      })
    );

    expect(items.some((i) => i.label === 'Copy Path')).toBe(false);
  });
});

describe('copyPathToClipboard', () => {
  test('writes path to clipboard and shows info toast', async () => {
    const written: string[] = [];
    const toasts: Array<[string, string]> = [];
    await copyPathToClipboard(
      '/home/user/notes.txt',
      {
        writeText: async (text) => {
          written.push(text);
        },
      },
      (msg, severity) => toasts.push([msg, severity])
    );

    expect(written).toEqual(['/home/user/notes.txt']);
    expect(toasts).toEqual([['Path copied', 'info']]);
  });

  test('does not throw when clipboard API is unavailable', async () => {
    const toasts: Array<[string, string]> = [];
    await expect(
      copyPathToClipboard('/home/user/notes.txt', undefined, (msg, severity) =>
        toasts.push([msg, severity])
      )
    ).resolves.toBeUndefined();
    expect(toasts).toEqual([]);
  });

  test('handles clipboard write rejection without throwing', async () => {
    const toasts: Array<[string, string]> = [];
    await expect(
      copyPathToClipboard(
        '/home/user/notes.txt',
        {
          writeText: async () => {
            throw new Error('Permission denied');
          },
        },
        (msg, severity) => toasts.push([msg, severity])
      )
    ).resolves.toBeUndefined();
    expect(toasts).toEqual([['Failed to copy path', 'error']]);
  });
});

describe('buildFileContextMenuItems — Open & Open in New Tab', () => {
  test('shows Open in New Tab immediately after Open for a single folder', () => {
    const openedInNewTab: string[] = [];
    const folder = makeFile('Projects', true);
    const items = buildFileContextMenuItems(
      makeParams({
        item: folder,
        targetItems: [folder],
        onOpenInNewTab: (path) => openedInNewTab.push(path),
      })
    );

    const openIdx = items.findIndex((i) => i.label === 'Open');
    const newTabIdx = items.findIndex((i) => i.label === 'Open in New Tab');
    expect(openIdx).toBe(0);
    expect(newTabIdx).toBe(1);
    expect(items[newTabIdx]?.icon).toBe('tab_new_right');

    items[newTabIdx]!.action();
    expect(openedInNewTab).toEqual(['/home/user/Projects']);
  });

  test('does not show Open in New Tab for a single file', () => {
    const file = makeFile('notes.txt', false);
    const items = buildFileContextMenuItems(
      makeParams({
        item: file,
        targetItems: [file],
      })
    );

    expect(items.some((i) => i.label === 'Open in New Tab')).toBe(false);
  });

  test('does not show Open in New Tab for multi-selection of folders', () => {
    const d1 = makeFile('DirA', true);
    const d2 = makeFile('DirB', true);
    const items = buildFileContextMenuItems(
      makeParams({
        item: d1,
        targetItems: [d1, d2],
      })
    );

    expect(items.some((i) => i.label === 'Open in New Tab')).toBe(false);
  });

  test('does not show Open in New Tab in Trash view or on background right-click', () => {
    const folder = makeFile('DeletedDir', true);
    const trashItems = buildFileContextMenuItems(
      makeParams({
        item: folder,
        targetItems: [folder],
        isTrashView: true,
        currentPath: 'app://trash',
      })
    );
    const bgItems = buildFileContextMenuItems(
      makeParams({
        item: null,
        targetItems: [],
      })
    );

    expect(trashItems.some((i) => i.label === 'Open in New Tab')).toBe(false);
    expect(bgItems.some((i) => i.label === 'Open in New Tab')).toBe(false);
  });

  test('Open navigates folder in current tab and opens file with OS', () => {
    const openedFolders: string[] = [];
    const openedFiles: string[] = [];
    const folder = makeFile('Projects', true);
    const file = makeFile('notes.txt', false);

    const folderItems = buildFileContextMenuItems(
      makeParams({
        item: folder,
        targetItems: [folder],
        onOpenFolder: (path) => openedFolders.push(path),
        onOpenFile: (path) => openedFiles.push(path),
      })
    );
    folderItems.find((i) => i.label === 'Open')!.action();

    const fileItems = buildFileContextMenuItems(
      makeParams({
        item: file,
        targetItems: [file],
        onOpenFolder: (path) => openedFolders.push(path),
        onOpenFile: (path) => openedFiles.push(path),
      })
    );
    fileItems.find((i) => i.label === 'Open')!.action();

    expect(openedFolders).toEqual(['/home/user/Projects']);
    expect(openedFiles).toEqual(['/home/user/notes.txt']);
  });
});
