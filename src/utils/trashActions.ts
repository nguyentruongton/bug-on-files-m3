import type { IFile } from '../types/files';

export type ToastFn = (msg: string, type: 'info' | 'error' | 'success') => void;

export type PurgeTarget =
    | { mode: 'items'; items: IFile[] }
    | { mode: 'empty' };

export interface TrashBatchDeps {
    trash: (path: string) => Promise<boolean>;
    showToast: ToastFn;
    refresh: () => void;
}

export interface RestoreBatchDeps {
    restoreTrash: (ids: string[]) => Promise<boolean>;
    showToast: ToastFn;
    refresh: () => void;
}

export interface PurgeActionDeps {
    purgeTrash: (ids: string[]) => Promise<boolean>;
    emptyTrash: () => Promise<boolean>;
    showToast: ToastFn;
    refresh: () => void;
}

/**
 * Moves a batch of items to Trash, refreshing the active view in a `finally`
 * block so partial successes remain reflected in the UI.
 */
export async function executeTrashBatch(
    items: IFile[],
    { trash, showToast, refresh }: TrashBatchDeps
): Promise<void> {
    if (items.length === 0) return;
    try {
        for (const item of items) {
            await trash(item.path);
        }
        showToast(
            items.length === 1
                ? `Moved "${items[0].name}" to Trash`
                : `Moved ${items.length} items to Trash`,
            'success'
        );
    } catch (err) {
        console.error('Move to trash failed', err);
        showToast('Failed to move selected item(s) to Trash', 'error');
    } finally {
        refresh();
    }
}

/**
 * Restores trashed items by their Trash IDs and always refreshes the Trash view
 * in `finally` when a backend call was attempted.
 */
export async function executeRestoreBatch(
    items: IFile[],
    { restoreTrash, showToast, refresh }: RestoreBatchDeps
): Promise<void> {
    const ids = items.map((item) => item.trashId).filter((id): id is string => Boolean(id));
    if (ids.length === 0) {
        showToast('Cannot restore item(s): missing trash metadata', 'error');
        return;
    }
    try {
        const ok = await restoreTrash(ids);
        if (!ok) {
            throw new Error('Restore command returned false');
        }
        showToast(
            items.length === 1
                ? `Restored "${items[0].name}"`
                : `Restored ${items.length} items`,
            'success'
        );
    } catch (err) {
        console.error('Restore failed', err);
        showToast('Failed to restore selected item(s)', 'error');
    } finally {
        refresh();
    }
}

/**
 * Permanently deletes selected trashed items or empties the Trash, refreshing
 * the active view in `finally` whenever a backend operation ran.
 */
export async function executePurgeAction(
    targetState: PurgeTarget,
    { purgeTrash, emptyTrash, showToast, refresh }: PurgeActionDeps
): Promise<void> {
    if (targetState.mode === 'items') {
        const ids = targetState.items
            .map((item) => item.trashId)
            .filter((id): id is string => Boolean(id));
        if (ids.length === 0) {
            showToast('Cannot permanently delete item(s): missing trash metadata', 'error');
            return;
        }
        try {
            const ok = await purgeTrash(ids);
            if (!ok) {
                throw new Error('Purge command returned false');
            }
            showToast(
                targetState.items.length === 1
                    ? `Permanently deleted "${targetState.items[0].name}"`
                    : `Permanently deleted ${targetState.items.length} items`,
                'success'
            );
        } catch (err) {
            console.error('Permanent delete failed', err);
            showToast('Failed to permanently delete selected item(s)', 'error');
        } finally {
            refresh();
        }
        return;
    }

    try {
        const ok = await emptyTrash();
        if (!ok) {
            throw new Error('Empty trash command returned false');
        }
        showToast('Emptied Trash', 'success');
    } catch (err) {
        console.error('Permanent delete failed', err);
        showToast('Failed to empty Trash', 'error');
    } finally {
        refresh();
    }
}
