import { describe, expect, test } from 'bun:test';
import {
  pruneSelectedFiles,
  recoverMissingFolder,
  shouldApplyReload,
  resolveDragCompletion,
  shouldSyncQuickLookOnRender,
  processInboundDrop,
  shouldCheckMissingFolderOnReloadError,
  shouldReloadAfterInboundDrop,
  resolveLoadFailureFallbackPath,
} from '../../utils/explorerTabUtils';
import { FileSystemService } from '../../services/FileSystemService';
import { api } from '../../api';

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
});
