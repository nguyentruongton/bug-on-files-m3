import { describe, expect, test } from 'bun:test';
import type { IFile } from '../../types/files';
import {
    executePurgeAction,
    executeRestoreBatch,
    executeTrashBatch,
} from '../trashActions';

function makeItem(name: string, overrides: Partial<IFile> = {}): IFile {
    return {
        name,
        path: `/tmp/${name}`,
        isDirectory: false,
        size: 10,
        mtime: new Date('2026-11-14T00:00:00Z'),
        ...overrides,
    };
}

describe('trashActions', () => {
    test('executeTrashBatch refreshes even when a batch item fails partway through', async () => {
        const toasts: Array<{ msg: string; type: string }> = [];
        let refreshed = 0;
        let callCount = 0;

        const items = [makeItem('a.txt'), makeItem('b.txt')];
        await executeTrashBatch(items, {
            trash: async () => {
                callCount++;
                if (callCount === 2) {
                    throw new Error('EACCES');
                }
                return true;
            },
            showToast: (msg, type) => toasts.push({ msg, type }),
            refresh: () => {
                refreshed++;
            },
        });

        expect(refreshed).toBe(1);
        expect(toasts).toEqual([
            { msg: 'Failed to move selected item(s) to Trash', type: 'error' },
        ]);
    });

    test('executeTrashBatch shows singular/plural success toast and refreshes', async () => {
        const toasts: Array<{ msg: string; type: string }> = [];
        let refreshed = 0;

        await executeTrashBatch([makeItem('one.txt')], {
            trash: async () => true,
            showToast: (msg, type) => toasts.push({ msg, type }),
            refresh: () => {
                refreshed++;
            },
        });

        expect(refreshed).toBe(1);
        expect(toasts).toEqual([{ msg: 'Moved "one.txt" to Trash', type: 'success' }]);
    });

    test('executeRestoreBatch refreshes even when restore throws or returns false', async () => {
        const toasts: Array<{ msg: string; type: string }> = [];
        let refreshed = 0;

        await executeRestoreBatch(
            [makeItem('a.txt', { trashId: 'id-1' }), makeItem('b.txt', { trashId: 'id-2' })],
            {
                restoreTrash: async () => false,
                showToast: (msg, type) => toasts.push({ msg, type }),
                refresh: () => {
                    refreshed++;
                },
            }
        );

        expect(refreshed).toBe(1);
        expect(toasts).toEqual([
            { msg: 'Failed to restore selected item(s)', type: 'error' },
        ]);
    });

    test('executeRestoreBatch aborts without refresh when trash metadata is missing', async () => {
        const toasts: Array<{ msg: string; type: string }> = [];
        let refreshed = 0;

        await executeRestoreBatch([makeItem('a.txt')], {
            restoreTrash: async () => true,
            showToast: (msg, type) => toasts.push({ msg, type }),
            refresh: () => {
                refreshed++;
            },
        });

        expect(refreshed).toBe(0);
        expect(toasts).toEqual([
            { msg: 'Cannot restore item(s): missing trash metadata', type: 'error' },
        ]);
    });

    test('executePurgeAction refreshes on partial error for both items and empty modes', async () => {
        const toasts: Array<{ msg: string; type: string }> = [];
        let refreshed = 0;

        await executePurgeAction(
            { mode: 'items', items: [makeItem('a.txt', { trashId: 'id-1' })] },
            {
                purgeTrash: async () => {
                    throw new Error('EPERM');
                },
                emptyTrash: async () => true,
                showToast: (msg, type) => toasts.push({ msg, type }),
                refresh: () => {
                    refreshed++;
                },
            }
        );

        await executePurgeAction(
            { mode: 'empty' },
            {
                purgeTrash: async () => true,
                emptyTrash: async () => false,
                showToast: (msg, type) => toasts.push({ msg, type }),
                refresh: () => {
                    refreshed++;
                },
            }
        );

        expect(refreshed).toBe(2);
        expect(toasts).toEqual([
            { msg: 'Failed to permanently delete selected item(s)', type: 'error' },
            { msg: 'Failed to empty Trash', type: 'error' },
        ]);
    });
});
