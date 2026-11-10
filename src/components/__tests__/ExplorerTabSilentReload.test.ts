import { describe, expect, test } from 'bun:test';

describe('ExplorerTab silent reload & recovery logic', () => {
  describe('selection pruning', () => {
    function pruneSelectedFiles(prev: Set<string>, currentFiles: Array<{ path: string }>): Set<string> {
      if (prev.size === 0) return prev;
      const validPaths = new Set(currentFiles.map((f) => f.path));
      let changed = false;
      const next = new Set<string>();
      for (const p of prev) {
        if (validPaths.has(p)) {
          next.add(p);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    }

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
    async function recoverMissingFolder(
      missingPath: string,
      deps: {
        exists: (path: string) => Promise<boolean>;
        getParentPath: (path: string) => Promise<string>;
        loadPath: (path: string) => void;
        showToast: (msg: string, type: string) => void;
      }
    ) {
      let checkPath = missingPath;
      while (checkPath) {
        const parent = await deps.getParentPath(checkPath);
        if (!parent || parent === checkPath) {
          if (await deps.exists(parent || '/')) {
            deps.loadPath(parent || '/');
            deps.showToast('Folder no longer exists', 'info');
          }
          break;
        }
        if (await deps.exists(parent)) {
          deps.loadPath(parent);
          deps.showToast('Folder no longer exists', 'info');
          break;
        }
        checkPath = parent;
      }
    }

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
});
