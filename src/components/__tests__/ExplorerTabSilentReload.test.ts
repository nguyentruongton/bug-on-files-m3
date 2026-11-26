import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  pruneSelectedFiles,
  pruneRemovedFilePaths,
  recoverMissingFolder,
  shouldApplyReload,
  shouldSilentlyRefreshTab,
  resolveDragCompletion,
  shouldSyncQuickLookOnRender,
  processInboundDrop,
  shouldCheckMissingFolderOnReloadError,
  shouldReloadAfterInboundDrop,
  resolveLoadFailureFallbackPath,
} from '../../utils/explorerTabUtils';
import { FileSystemService } from '../../services/FileSystemService';
import { api } from '../../api';
import { ClipboardProvider } from '../../contexts/ClipboardContext';
import { ToastProvider } from '../../contexts/ToastContext';
import { ExplorerTab } from '../ExplorerTab';

describe('ExplorerTab silent reload & recovery logic', () => {
  describe('selection pruning', () => {
    test('retains selected files that still exist', () => {
      const selected = new Set(['/tmp/a.txt', '/tmp/b.txt']);
      const current = [{ path: '/tmp/a.txt' }, { path: '/tmp/b.txt' }, { path: '/tmp/c.txt' }];
      const result = pruneSelectedFiles(selected, current);
      expect(result).toBe(selected); // same reference when unchanged
      expect(Array.from(result)).toEqual(['/tmp/a.txt', '/tmp/b.txt']);
    });

    test('prunes files that were deleted externally', () => {
      const selected = new Set(['/tmp/a.txt', '/tmp/b.txt', '/tmp/deleted.txt']);
      const current = [{ path: '/tmp/a.txt' }, { path: '/tmp/b.txt' }];
      const result = pruneSelectedFiles(selected, current);
      expect(result).not.toBe(selected);
      expect(Array.from(result)).toEqual(['/tmp/a.txt', '/tmp/b.txt']);
    });

    test('returns empty set if all selected files were deleted', () => {
      const selected = new Set(['/tmp/a.txt']);
      const current = [{ path: '/tmp/b.txt' }];
      const result = pruneSelectedFiles(selected, current);
      expect(Array.from(result)).toEqual([]);
    });
  });

  describe('folder missing recovery walk', () => {
    test('navigates to immediate parent when parent exists', async () => {
      const loaded: string[] = [];
      const toasts: string[] = [];

      await recoverMissingFolder('/home/stark/folder/sub', {
        exists: async (p) => p === '/home/stark/folder',
        getParentPath: async (p) => {
          const parts = p.split('/').filter(Boolean);
          parts.pop();
          return '/' + parts.join('/');
        },
        loadPath: (p) => loaded.push(p),
        showToast: (m) => toasts.push(m),
      });

      expect(loaded).toEqual(['/home/stark/folder']);
      expect(toasts).toEqual(['Folder no longer exists']);
    });

    test('walks up multiple levels when parent directory was also deleted', async () => {
      const loaded: string[] = [];
      const toasts: string[] = [];

      await recoverMissingFolder('/home/stark/deleted1/deleted2', {
        exists: async (p) => p === '/home/stark',
        getParentPath: async (p) => {
          const parts = p.split('/').filter(Boolean);
          parts.pop();
          return '/' + parts.join('/');
        },
        loadPath: (p) => loaded.push(p),
        showToast: (m) => toasts.push(m),
      });

      expect(loaded).toEqual(['/home/stark']);
      expect(toasts).toEqual(['Folder no longer exists']);
    });
  });

  describe('reload sequencing guard (shouldApplyReload)', () => {
    test('allows reload when seq, path match and search is inactive', () => {
      expect(
        shouldApplyReload({
          seq: 1,
          expectedSeq: 1,
          currentPath: '/home/user/docs',
          targetPath: '/home/user/docs',
          searchActive: false,
        })
      ).toBe(true);
    });

    test('rejects reload when seq is stale (superseded by newer reload or navigation)', () => {
      expect(
        shouldApplyReload({
          seq: 1,
          expectedSeq: 2,
          currentPath: '/home/user/docs',
          targetPath: '/home/user/docs',
          searchActive: false,
        })
      ).toBe(false);
    });

    test('rejects reload when user has navigated to another directory', () => {
      expect(
        shouldApplyReload({
          seq: 1,
          expectedSeq: 1,
          currentPath: '/home/user/other',
          targetPath: '/home/user/docs',
          searchActive: false,
        })
      ).toBe(false);
    });

    test('rejects reload when search is active', () => {
      expect(
        shouldApplyReload({
          seq: 1,
          expectedSeq: 1,
          currentPath: '/home/user/docs',
          targetPath: '/home/user/docs',
          searchActive: true,
        })
      ).toBe(false);
    });
  });

  describe('drag completion resolution (resolveDragCompletion)', () => {
    test('triggers reload and clears pending flag when drag ends normally with pending reload', () => {
      const result = resolveDragCompletion(true, true);
      expect(result).toEqual({
        shouldReload: true,
        nextPendingReload: false,
      });
    });

    test('does not reload when drag ends without pending changes', () => {
      const result = resolveDragCompletion(true, false);
      expect(result).toEqual({
        shouldReload: false,
        nextPendingReload: false,
      });
    });

    test('suppresses reload and clears pending flag on unmount or tab deactivation', () => {
      const result = resolveDragCompletion(false, true);
      expect(result).toEqual({
        shouldReload: false,
        nextPendingReload: false,
      });
    });

    test('suppresses reload when neither trigger nor pending is true', () => {
      const result = resolveDragCompletion(false, false);
      expect(result).toEqual({
        shouldReload: false,
        nextPendingReload: false,
      });
    });
  });

  describe('render-phase quick look sync guard (shouldSyncQuickLookOnRender)', () => {
    const listA = [{ path: '/a' }];
    const listB = [{ path: '/b' }];

    test('does not sync when quickLookPath is null (avoids double render on navigation/sort)', () => {
      expect(shouldSyncQuickLookOnRender(null, listA, listB)).toBe(false);
    });

    test('does not sync when lists are identical reference', () => {
      expect(shouldSyncQuickLookOnRender('/a', listA, listA)).toBe(false);
    });

    test('syncs when quickLookPath is open and sorted files reference changed', () => {
      expect(shouldSyncQuickLookOnRender('/a', listA, listB)).toBe(true);
    });
  });

  describe('inbound drag-and-drop guard (processInboundDrop)', () => {
    test('blocks drops during active search or in trash/dashboard views', async () => {
      const copied: Array<[string, string]> = [];
      const deps = {
        exists: async () => false,
        copyFile: async (src: string, dest: string) => {
          copied.push([src, dest]);
          return true;
        },
      };

      expect(await processInboundDrop(['/tmp/a.txt'], '/home/u', true, deps)).toBe(0);
      expect(await processInboundDrop(['/tmp/a.txt'], 'app://trash', false, deps)).toBe(0);
      expect(await processInboundDrop(['/tmp/a.txt'], 'app://dashboard', false, deps)).toBe(0);
      expect(copied).toEqual([]);
    });

    test('rejects same-folder self-drops, descendant drops, and invalid paths, and avoids overwriting colliding names', async () => {
      const existing = new Set(['/home/u/Pictures/photo.png']);
      const copied: Array<[string, string]> = [];
      const deps = {
        exists: async (p: string) => existing.has(p),
        copyFile: async (src: string, dest: string) => {
          copied.push([src, dest]);
          existing.add(dest);
          return true;
        },
      };

      const count = await processInboundDrop(
        [
          '/home/u/Pictures/same.png', // same folder -> skip
          '/home/u', // ancestor of /home/u/Pictures -> skip
          '/home/u/Pictures', // same dir -> skip
          'relative/path.txt', // non-absolute -> skip
          '/tmp/evil\0.txt', // NUL byte -> skip
          '/tmp/photo.png', // collision -> photo (2).png
          '/tmp/fresh.png', // no collision -> fresh.png
        ],
        '/home/u/Pictures',
        false,
        deps
      );

      expect(count).toBe(2);
      expect(copied).toEqual([
        ['/tmp/photo.png', '/home/u/Pictures/photo (2).png'],
        ['/tmp/fresh.png', '/home/u/Pictures/fresh.png'],
      ]);
    });

    test('shouldReloadAfterInboundDrop only reloads if tab is still at destDir and not searching', () => {
      expect(shouldReloadAfterInboundDrop(2, '/home/u/Pictures', '/home/u/Pictures', false)).toBe(true);
      expect(shouldReloadAfterInboundDrop(2, '/home/u/Pictures', '/home/u/Documents', false)).toBe(false);
      expect(shouldReloadAfterInboundDrop(2, '/home/u/Pictures', '/home/u/Pictures', true)).toBe(false);
      expect(shouldReloadAfterInboundDrop(0, '/home/u/Pictures', '/home/u/Pictures', false)).toBe(false);
    });

    test('shouldCheckMissingFolderOnReloadError excludes virtual app:// paths like app://trash', () => {
      expect(shouldCheckMissingFolderOnReloadError('app://trash')).toBe(false);
      expect(shouldCheckMissingFolderOnReloadError('app://dashboard')).toBe(false);
      expect(shouldCheckMissingFolderOnReloadError('/home/u/Documents')).toBe(true);
    });
  });

  describe('FileSystemService error propagation', () => {
    test('propagates listDir and listTrash rejections instead of swallowing them', async () => {
      const origListDir = api.listDir;
      const origListTrash = api.listTrash;
      try {
        Object.assign(api, {
          listDir: async () => {
            throw new Error('EACCES: permission denied');
          },
          listTrash: async () => {
            throw new Error('Trash unavailable');
          },
        });
        await expect(FileSystemService.listDir('/root')).rejects.toThrow('EACCES');
        await expect(FileSystemService.listTrash()).rejects.toThrow('Trash unavailable');
      } finally {
        Object.assign(api, { listDir: origListDir, listTrash: origListTrash });
      }
    });
  });

  describe('loadPath failure fallback', () => {
    test('returns currentPath when external/context-menu navigation fails on a different path', () => {
      expect(resolveLoadFailureFallbackPath('/root', '/home/u')).toBe('/home/u');
    });

    test('returns null when failed path matches currentPath or currentPath is empty', () => {
      expect(resolveLoadFailureFallbackPath('/home/u', '/home/u')).toBeNull();
      expect(resolveLoadFailureFallbackPath('/root', '')).toBeNull();
    });
  });

  describe('search-mode path pruning (pruneRemovedFilePaths)', () => {
    test('removes only paths in removedPaths while keeping skipped and cancelled items intact', () => {
      const moved = { path: '/home/u/Docs/moved.txt', name: 'moved.txt' };
      const skipped = { path: '/home/u/Docs/skipped.txt', name: 'skipped.txt' };
      const cancelled = { path: '/home/u/Docs/cancelled.txt', name: 'cancelled.txt' };
      const files = [moved, skipped, cancelled];

      const result = pruneRemovedFilePaths(files, new Set(['/home/u/Docs/moved.txt']));

      expect(result).toEqual([skipped, cancelled]);
      expect(result[0]).toBe(skipped);
      expect(result[1]).toBe(cancelled);
    });

    test('returns the same array reference when nothing matched or removedPaths is empty', () => {
      const files = [
        { path: '/home/u/Docs/a.txt', name: 'a.txt' },
        { path: '/home/u/Docs/b.txt', name: 'b.txt' },
      ];

      expect(pruneRemovedFilePaths(files, new Set(['/home/u/Docs/other.txt']))).toBe(files);
      expect(pruneRemovedFilePaths(files, new Set())).toBe(files);
    });
  });

  describe('directory-scoped silent refresh (shouldSilentlyRefreshTab)', () => {
    test('returns true for normal tabs whose normalized path is in affectedDirs', () => {
      const affected = new Set(['/home/u/Docs', '/home/u/Archive']);

      expect(shouldSilentlyRefreshTab('/home/u/Docs', false, affected)).toBe(true);
      expect(shouldSilentlyRefreshTab('/home/u/Docs/', false, affected)).toBe(true);
      expect(shouldSilentlyRefreshTab('/home/u/Downloads', false, affected)).toBe(false);
    });

    test('returns true for app://trash only when refreshTrash is true and search is inactive', () => {
      expect(shouldSilentlyRefreshTab('app://trash', false, new Set(), true)).toBe(true);
      expect(shouldSilentlyRefreshTab('app://trash', false, new Set(['app://trash']), false)).toBe(false);
      expect(shouldSilentlyRefreshTab('app://trash', false, new Set())).toBe(false);
      expect(shouldSilentlyRefreshTab('app://trash', true, new Set(), true)).toBe(false);
    });

    test('returns false when search is active or tabPath is app://dashboard or empty', () => {
      const affected = new Set(['/home/u/Docs', 'app://dashboard']);

      expect(shouldSilentlyRefreshTab('/home/u/Docs', true, affected, true)).toBe(false);
      expect(shouldSilentlyRefreshTab('app://dashboard', false, affected, true)).toBe(false);
      expect(shouldSilentlyRefreshTab('', false, affected, true)).toBe(false);
    });
  });

  describe('ExplorerTab explorer-root drop target markup', () => {
    function withMockLocalStorage<T>(run: () => T): T {
      const hadLocalStorage = 'localStorage' in globalThis;
      const prevLocalStorage = globalThis.localStorage;
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
          clear: () => {},
          key: () => null,
          length: 0,
        },
      });
      try {
        return run();
      } finally {
        if (!hadLocalStorage) {
          Reflect.deleteProperty(globalThis, 'localStorage');
        } else {
          Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: prevLocalStorage,
          });
        }
      }
    }

    test('renders explorer-root drop attributes and highlights only when explorer-root activeDropTarget matches currentPath', () => {
      const renderTab = (activeDropTarget: Parameters<typeof ExplorerTab>[0]['activeDropTarget']) =>
        withMockLocalStorage(() =>
          renderToStaticMarkup(
            React.createElement(
              ToastProvider,
              null,
              React.createElement(
                ClipboardProvider,
                null,
                React.createElement(ExplorerTab, {
                  tabId: 't1',
                  isActive: true,
                  initialPath: '/tmp/demo',
                  onPathChange: () => {},
                  onContextMenu: () => {},
                  showHiddenFiles: false,
                  iconSize: 64,
                  viewMode: 'list',
                  filledIcons: false,
                  activeDropTarget,
                })
              )
            )
          )
        );

      const activeHtml = renderTab({
        kind: 'folder',
        path: '/tmp/demo/',
        source: 'explorer-root',
      });
      expect(activeHtml).toContain('data-drop-explorer-root="true"');
      expect(activeHtml).toContain('data-explorer-path="/tmp/demo"');
      expect(activeHtml).toContain('data-search-active="false"');
      expect(activeHtml).toContain('data-drop-active="true"');

      const activeRootTag = activeHtml.match(/<div[^>]*data-drop-explorer-root="true"[^>]*>/)?.[0] ?? '';
      expect(activeRootTag).toContain('relative');
      expect(activeRootTag).not.toContain('ring-2 ring-inset ring-m3-primary/60');

      expect(activeHtml).toMatch(
        /<div[^>]*aria-hidden="true"[^>]*class="[^"]*pointer-events-none absolute inset-0 z-10 rounded-\[24px\] ring-2 ring-inset ring-m3-primary\/60[^"]*"/
      );

      const sidebarHtml = renderTab({
        kind: 'folder',
        path: '/tmp/demo',
        source: 'sidebar',
      });
      expect(sidebarHtml).toContain('data-drop-explorer-root="true"');
      expect(sidebarHtml).not.toContain('data-drop-active="true"');
      expect(sidebarHtml).not.toContain('pointer-events-none absolute inset-0 z-10');
      expect(sidebarHtml).not.toContain('ring-2 ring-inset ring-m3-primary/60');
    });
  });
});
