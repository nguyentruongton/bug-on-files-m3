import type { ListItemPosition } from '@bug-on/m3-expressive/layout';
import type { IFile } from '../types/files';
import {
    GROUP_ORDER,
    getFileExtension,
    getSemanticGroup,
    type FileGroup,
} from './fileUtils';

export type SortField = 'name' | 'date' | 'type' | 'size';

export type DisplayEntry =
    | { kind: 'header'; group: FileGroup; key: string }
    | { kind: 'file'; file: IFile; fileIndex: number; position: ListItemPosition; key: string };

export function normalizeSortField(value: unknown): SortField {
    if (value === 'name' || value === 'date' || value === 'type' || value === 'size') {
        return value;
    }
    return 'name';
}

function compareNaturalName(a: IFile, b: IFile): number {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

function toTimestampMs(mtime: IFile['mtime']): number {
    const ms = mtime instanceof Date ? mtime.getTime() : new Date(mtime).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

export function compareFiles(
    a: IFile,
    b: IFile,
    sortBy: SortField,
    sortOrder: 'asc' | 'desc',
    groupingEnabled: boolean
): number {
    if (groupingEnabled) {
        const groupA = getSemanticGroup(a);
        const groupB = getSemanticGroup(b);
        if (groupA !== groupB) {
            return GROUP_ORDER.indexOf(groupA) - GROUP_ORDER.indexOf(groupB);
        }
    } else if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
    }

    let result = 0;
    switch (sortBy) {
        case 'name':
            result = compareNaturalName(a, b);
            break;
        case 'size':
            result = a.size - b.size || compareNaturalName(a, b);
            break;
        case 'date':
            result = toTimestampMs(a.mtime) - toTimestampMs(b.mtime) || compareNaturalName(a, b);
            break;
        case 'type': {
            const extA = getFileExtension(a.name).toLowerCase();
            const extB = getFileExtension(b.name).toLowerCase();
            result = extA.localeCompare(extB, undefined, { numeric: true, sensitivity: 'base' });
            if (result === 0) {
                result = getSemanticGroup(a).localeCompare(getSemanticGroup(b), undefined, {
                    sensitivity: 'base',
                });
            }
            if (result === 0) {
                result = compareNaturalName(a, b);
            }
            break;
        }
    }

    return sortOrder === 'asc' ? result : -result;
}

function resolveSegmentPosition(indexInGroup: number, groupLength: number): ListItemPosition {
    if (groupLength <= 1) return 'solo';
    if (indexInGroup === 0) return 'leading';
    if (indexInGroup === groupLength - 1) return 'trailing';
    return 'middle';
}

export function buildDisplayEntries(
    files: IFile[],
    groupingEnabled: boolean
): DisplayEntry[] {
    if (files.length === 0) return [];

    if (!groupingEnabled) {
        return files.map((file, idx) => ({
            kind: 'file',
            file,
            fileIndex: idx,
            position: resolveSegmentPosition(idx, files.length),
            key: file.path,
        }));
    }

    const buckets = new Map<FileGroup, IFile[]>();
    for (const file of files) {
        const group = getSemanticGroup(file);
        const list = buckets.get(group);
        if (list) {
            list.push(file);
        } else {
            buckets.set(group, [file]);
        }
    }

    const entries: DisplayEntry[] = [];
    let fileIndex = 0;

    for (const group of GROUP_ORDER) {
        const bucket = buckets.get(group);
        if (!bucket || bucket.length === 0) continue;

        entries.push({
            kind: 'header',
            group,
            key: `header:${group}`,
        });

        for (let i = 0; i < bucket.length; i++) {
            const file = bucket[i];
            entries.push({
                kind: 'file',
                file,
                fileIndex,
                position: resolveSegmentPosition(i, bucket.length),
                key: file.path,
            });
            fileIndex++;
        }
    }

    return entries;
}
