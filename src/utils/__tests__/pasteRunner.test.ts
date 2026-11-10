import { describe, expect, test } from 'bun:test';
import type { IFile } from '../../types/files';
import {
  type ConflictAction,
  type PasteDeps,
  getUniqueName,
  isSameOrDescendant,
  runPaste,
} from '../pasteRunner';

function makeFile(name: string, isDirectory = false, parentDir = '/src'): IFile {
  const normParent = parentDir.endsWith('/') ? parentDir.slice(0, -1) : parentDir;
  const path = normParent === '' ? `/${name}` : `${normParent}/${name}`;
  return {
    name,
    path,
    isDirectory,
    size: 100,
    mtime: new Date('2026-11-10T14:30:00Z'),
  };
}

interface FakePasteDepsOptions {
  existing?: string[];
  conflictResolutions?: Array<{ action: ConflictAction; applyToAll: boolean }>;
  failTrashFor?: string[];
  failCopyFor?: string[];
  failMoveFor?: string[];
}

function createFakePasteDeps(options: FakePasteDepsOptions = {}) {
  const existingSet = new Set<string>(options.existing || []);
  const callLog: string[] = [];
  const conflictCalls: Array<{ file: IFile; destPath: string; remaining: number }> = [];
  let resolutionIndex = 0;

  const deps: PasteDeps = {
    async exists(path: string) {
      callLog.push(`exists:${path}`);
      return existingSet.has(path);
    },
    async copy(src: string, dest: string) {
      callLog.push(`copy:${src}->${dest}`);
      if (options.failCopyFor?.includes(src) || options.failCopyFor?.includes(dest)) {
        throw new Error(`copy failed: ${src} -> ${dest}`);
      }
      existingSet.add(dest);
    },
    async move(src: string, dest: string) {
      callLog.push(`move:${src}->${dest}`);
      if (options.failMoveFor?.includes(src) || options.failMoveFor?.includes(dest)) {
        throw new Error(`move failed: ${src} -> ${dest}`);
      }
      existingSet.delete(src);
      existingSet.add(dest);
    },
    async trash(path: string) {
      callLog.push(`trash:${path}`);
      if (options.failTrashFor?.includes(path)) {
        throw new Error(`trash failed: ${path}`);
      }
      existingSet.delete(path);
    },
    async resolveConflict(file: IFile, destPath: string, remaining: number) {
      callLog.push(`resolveConflict:${file.path}->${destPath}:remaining=${remaining}`);
      conflictCalls.push({ file, destPath, remaining });
      if (options.conflictResolutions && resolutionIndex < options.conflictResolutions.length) {
        return options.conflictResolutions[resolutionIndex++];
      }
      return { action: 'skip', applyToAll: false };
    },
  };

  return { deps, existingSet, callLog, conflictCalls };
}

describe('getUniqueName', () => {
  test('generates name (2).ext for standard extension', async () => {
    const result = await getUniqueName('a.txt', async () => false);
    expect(result).toBe('a (2).txt');
  });

  test('generates name (2) for file without extension', async () => {
    const result = await getUniqueName('Makefile', async () => false);
    expect(result).toBe('Makefile (2)');
  });

  test('generates .dotfile (2) for dotfile without second extension', async () => {
    const result = await getUniqueName('.env', async () => false);
    expect(result).toBe('.env (2)');
  });

  test('uses last dot for multi-dot files like a.tar.gz', async () => {
    const result = await getUniqueName('a.tar.gz', async () => false);
    expect(result).toBe('a.tar (2).gz');
  });

  test('skips (2) and picks (3) when (2) is taken', async () => {
    const taken = new Set(['a (2).txt']);
    const result = await getUniqueName('a.txt', async (candidate) => taken.has(candidate));
    expect(result).toBe('a (3).txt');
  });
});

describe('isSameOrDescendant', () => {
  test('detects identical paths', () => {
    expect(isSameOrDescendant('/a/b', '/a/b')).toBe(true);
  });

  test('detects descendant paths', () => {
    expect(isSameOrDescendant('/a/b', '/a/b/c')).toBe(true);
  });

  test('rejects siblings sharing prefix without slash boundary', () => {
    expect(isSameOrDescendant('/a/b', '/a/bc')).toBe(false);
  });

  test('handles root / properly', () => {
    expect(isSameOrDescendant('/', '/sub')).toBe(true);
    expect(isSameOrDescendant('/', '/')).toBe(true);
    expect(isSameOrDescendant('/sub', '/')).toBe(false);
  });

  test('handles trailing slashes', () => {
    expect(isSameOrDescendant('/a/b/', '/a/b/c/')).toBe(true);
    expect(isSameOrDescendant('/a/b/', '/a/b')).toBe(true);
  });
});

describe('runPaste', () => {
  test('no conflict: copy calls copy once and does not prompt', async () => {
    const file = makeFile('doc.txt', false, '/src');
    const { deps, callLog, conflictCalls } = createFakePasteDeps();

    const result = await runPaste([file], 'copy', '/dest', deps);

    expect(result).toEqual({ done: 1, skipped: 0, failed: [], cancelled: false });
    expect(conflictCalls).toHaveLength(0);
    expect(callLog).toEqual(['exists:/dest/doc.txt', 'copy:/src/doc.txt->/dest/doc.txt']);
  });

  test('no conflict: root / destDir formats dest path without double slashes', async () => {
    const file = makeFile('rootdoc.txt', false, '/src');
    const { deps, callLog } = createFakePasteDeps();

    const result = await runPaste([file], 'copy', '/', deps);

    expect(result).toEqual({ done: 1, skipped: 0, failed: [], cancelled: false });
    expect(callLog).toEqual(['exists:/rootdoc.txt', 'copy:/src/rootdoc.txt->/rootdoc.txt']);
  });

  test('no conflict: cut calls move once and does not prompt', async () => {
    const file = makeFile('cutme.txt', false, '/src');
    const { deps, callLog, conflictCalls } = createFakePasteDeps();

    const result = await runPaste([file], 'cut', '/dest', deps);

    expect(result).toEqual({ done: 1, skipped: 0, failed: [], cancelled: false });
    expect(conflictCalls).toHaveLength(0);
    expect(callLog).toEqual(['exists:/dest/cutme.txt', 'move:/src/cutme.txt->/dest/cutme.txt']);
  });

  test('conflict + replace: trashes dest then copies src; if trash rejects, copy is NOT called and item in failed', async () => {
    const file = makeFile('doc.txt', false, '/src');
    const { deps, callLog } = createFakePasteDeps({
      existing: ['/dest/doc.txt'],
      conflictResolutions: [{ action: 'replace', applyToAll: false }],
    });

    const result = await runPaste([file], 'copy', '/dest', deps);

    expect(result).toEqual({ done: 1, skipped: 0, failed: [], cancelled: false });
    expect(callLog).toContain('trash:/dest/doc.txt');
    expect(callLog).toContain('copy:/src/doc.txt->/dest/doc.txt');
    expect(callLog.indexOf('trash:/dest/doc.txt')).toBeLessThan(
      callLog.indexOf('copy:/src/doc.txt->/dest/doc.txt')
    );

    // Now test failure in trash
    const failFile = makeFile('doc.txt', false, '/src');
    const { deps: failDeps, callLog: failLog } = createFakePasteDeps({
      existing: ['/dest/doc.txt'],
      conflictResolutions: [{ action: 'replace', applyToAll: false }],
      failTrashFor: ['/dest/doc.txt'],
    });

    const failResult = await runPaste([failFile], 'copy', '/dest', failDeps);
    expect(failResult).toEqual({ done: 0, skipped: 0, failed: ['doc.txt'], cancelled: false });
    expect(failLog).toContain('trash:/dest/doc.txt');
    expect(failLog.some((c) => c.startsWith('copy:'))).toBe(false);
  });

  test('conflict + skip: no IO performed, skipped count incremented', async () => {
    const file = makeFile('skip.txt', false, '/src');
    const { deps, callLog } = createFakePasteDeps({
      existing: ['/dest/skip.txt'],
      conflictResolutions: [{ action: 'skip', applyToAll: false }],
    });

    const result = await runPaste([file], 'copy', '/dest', deps);

    expect(result).toEqual({ done: 0, skipped: 1, failed: [], cancelled: false });
    expect(callLog.some((c) => c.startsWith('copy:') || c.startsWith('trash:') || c.startsWith('move:'))).toBe(false);
  });

  test('conflict + keep-both: copies to unique name', async () => {
    const file = makeFile('data.txt', false, '/src');
    const { deps, callLog } = createFakePasteDeps({
      existing: ['/dest/data.txt'],
      conflictResolutions: [{ action: 'keep-both', applyToAll: false }],
    });

    const result = await runPaste([file], 'copy', '/dest', deps);

    expect(result).toEqual({ done: 1, skipped: 0, failed: [], cancelled: false });
    expect(callLog).toContain('copy:/src/data.txt->/dest/data (2).txt');
  });

  test('applyToAll: true on first of 3 conflicts calls resolveConflict once and reuses action', async () => {
    const f1 = makeFile('f1.txt', false, '/src');
    const f2 = makeFile('f2.txt', false, '/src');
    const f3 = makeFile('f3.txt', false, '/src');

    const { deps, conflictCalls } = createFakePasteDeps({
      existing: ['/dest/f1.txt', '/dest/f2.txt', '/dest/f3.txt'],
      conflictResolutions: [{ action: 'skip', applyToAll: true }],
    });

    const result = await runPaste([f1, f2, f3], 'copy', '/dest', deps);

    expect(result).toEqual({ done: 0, skipped: 3, failed: [], cancelled: false });
    expect(conflictCalls).toHaveLength(1);
    expect(conflictCalls[0].remaining).toBe(3);
  });

  test('cancel on item 2 of 3: item 1 done, items 2-3 untouched, cancelled: true', async () => {
    const f1 = makeFile('f1.txt', false, '/src');
    const f2 = makeFile('f2.txt', false, '/src');
    const f3 = makeFile('f3.txt', false, '/src');

    const { deps, callLog } = createFakePasteDeps({
      existing: ['/dest/f2.txt'], // only f2 conflicts
      conflictResolutions: [{ action: 'cancel', applyToAll: false }],
    });

    const result = await runPaste([f1, f2, f3], 'copy', '/dest', deps);

    expect(result).toEqual({ done: 1, skipped: 0, failed: [], cancelled: true });
    expect(callLog).toContain('copy:/src/f1.txt->/dest/f1.txt');
    expect(callLog.some((c) => c.includes('f3.txt'))).toBe(false);
  });

  test('same-folder copy (/d/a.txt -> /d): no prompt, copies to /d/a (2).txt; trash never called with source path', async () => {
    const file = makeFile('a.txt', false, '/d');
    const { deps, callLog, conflictCalls } = createFakePasteDeps({
      existing: ['/d/a.txt'],
    });

    const result = await runPaste([file], 'copy', '/d', deps);

    expect(result).toEqual({ done: 1, skipped: 0, failed: [], cancelled: false });
    expect(conflictCalls).toHaveLength(0);
    expect(callLog).toContain('copy:/d/a.txt->/d/a (2).txt');
    expect(callLog.some((c) => c.startsWith('trash:'))).toBe(false);
  });

  test('same-folder cut (/d/a.txt -> /d): no IO, skipped: 1, trash never called', async () => {
    const file = makeFile('a.txt', false, '/d');
    const { deps, callLog, conflictCalls } = createFakePasteDeps({
      existing: ['/d/a.txt'],
    });

    const result = await runPaste([file], 'cut', '/d', deps);

    expect(result).toEqual({ done: 0, skipped: 1, failed: [], cancelled: false });
    expect(conflictCalls).toHaveLength(0);
    expect(callLog.some((c) => c.startsWith('trash:') || c.startsWith('copy:') || c.startsWith('move:'))).toBe(false);
  });

  test('folder /x/dir pasted into /x/dir and /x/dir/sub: item in failed, no IO, next item still pasted', async () => {
    const dirSame = makeFile('dir', true, '/x');
    const dirSub = makeFile('dir', true, '/x');
    const nextFile = makeFile('other.txt', false, '/src');

    // Pasting /x/dir into /x/dir
    const { deps: deps1, callLog: callLog1 } = createFakePasteDeps();
    const result1 = await runPaste([dirSame, nextFile], 'copy', '/x/dir', deps1);

    expect(result1).toEqual({ done: 1, skipped: 0, failed: ['dir'], cancelled: false });
    expect(callLog1.some((c) => c.includes('/x/dir/dir'))).toBe(false);
    expect(callLog1).toContain('copy:/src/other.txt->/x/dir/other.txt');

    // Pasting /x/dir into /x/dir/sub
    const { deps: deps2, callLog: callLog2 } = createFakePasteDeps();
    const result2 = await runPaste([dirSub, nextFile], 'copy', '/x/dir/sub', deps2);

    expect(result2).toEqual({ done: 1, skipped: 0, failed: ['dir'], cancelled: false });
    expect(callLog2.some((c) => c.includes('/x/dir/sub/dir'))).toBe(false);
    expect(callLog2).toContain('copy:/src/other.txt->/x/dir/sub/other.txt');
  });

  test('copy/move rejecting for one item adds to failed and loop continues', async () => {
    const f1 = makeFile('fail.txt', false, '/src');
    const f2 = makeFile('ok.txt', false, '/src');

    const { deps } = createFakePasteDeps({
      failCopyFor: ['/src/fail.txt'],
    });

    const result = await runPaste([f1, f2], 'copy', '/dest', deps);

    expect(result).toEqual({ done: 1, skipped: 0, failed: ['fail.txt'], cancelled: false });
  });

  test('remaining count passed to resolveConflict is files.length - index (inclusive count remaining)', async () => {
    const f1 = makeFile('item1.txt', false, '/src');
    const f2 = makeFile('item2.txt', false, '/src');

    const { deps, conflictCalls } = createFakePasteDeps({
      existing: ['/dest/item1.txt', '/dest/item2.txt'],
      conflictResolutions: [
        { action: 'skip', applyToAll: false },
        { action: 'skip', applyToAll: false },
      ],
    });

    await runPaste([f1, f2], 'copy', '/dest', deps);

    expect(conflictCalls).toHaveLength(2);
    expect(conflictCalls[0].remaining).toBe(2);
    expect(conflictCalls[1].remaining).toBe(1);
  });
});
