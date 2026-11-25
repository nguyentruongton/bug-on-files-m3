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

export const GRID_HEADER_HEIGHT = 28;
export const GRID_GAP_PX = 12;

export function getGridCardHeight(iconSize: number): number {
    return iconSize + 92;
}

export function computeGridColumns(
    containerWidth: number,
    iconSize: number,
    gapPx = GRID_GAP_PX,
    horizontalPaddingPx = 32
): number {
    const usableWidth = Math.max(0, containerWidth - horizontalPaddingPx);
    const minCardWidth = Math.max(116, iconSize + 48);
    return Math.max(1, Math.floor((usableWidth + gapPx) / (minCardWidth + gapPx)));
}

export type VirtualGridEntry =
    | { kind: 'header'; key: string; group: FileGroup; height: number }
    | { kind: 'grid-row'; key: string; items: IFile[]; startIndex: number; height: number };

export function buildVirtualGridEntries(
    files: IFile[],
    groupingEnabled: boolean,
    columnCount: number,
    iconSize: number,
    gapPx = GRID_GAP_PX
): { entries: VirtualGridEntry[]; fileIndexToRowIndex: number[] } {
    if (files.length === 0) {
        return { entries: [], fileIndexToRowIndex: [] };
    }

    const cols = Math.max(1, Math.floor(columnCount));
    const headerEntryHeight = GRID_HEADER_HEIGHT + gapPx;
    const rowEntryHeight = getGridCardHeight(iconSize) + gapPx;
    const entries: VirtualGridEntry[] = [];
    const fileIndexToRowIndex = new Array<number>(files.length);

    if (!groupingEnabled) {
        for (let i = 0; i < files.length; i += cols) {
            const rowItems = files.slice(i, i + cols);
            const rowIndex = entries.length;
            entries.push({
                kind: 'grid-row',
                key: `row:${i}:${rowItems[0]?.path ?? ''}`,
                items: rowItems,
                startIndex: i,
                height: rowEntryHeight,
            });
            for (let j = 0; j < rowItems.length; j++) {
                fileIndexToRowIndex[i + j] = rowIndex;
            }
        }
        return { entries, fileIndexToRowIndex };
    }

    let i = 0;
    while (i < files.length) {
        const group = getSemanticGroup(files[i]);
        let groupEnd = i + 1;
        while (groupEnd < files.length && getSemanticGroup(files[groupEnd]) === group) {
            groupEnd++;
        }

        entries.push({
            kind: 'header',
            key: `grid-header:${group}:${i}`,
            group,
            height: headerEntryHeight,
        });

        for (let rowStart = i; rowStart < groupEnd; rowStart += cols) {
            const sliceEnd = Math.min(groupEnd, rowStart + cols);
            const rowItems = files.slice(rowStart, sliceEnd);
            const rowIndex = entries.length;
            entries.push({
                kind: 'grid-row',
                key: `grid-row:${group}:${rowStart}:${rowItems[0]?.path ?? ''}`,
                items: rowItems,
                startIndex: rowStart,
                height: rowEntryHeight,
            });
            for (let j = 0; j < rowItems.length; j++) {
                fileIndexToRowIndex[rowStart + j] = rowIndex;
            }
        }

        i = groupEnd;
    }

    return { entries, fileIndexToRowIndex };
}

export function resolveGridArrowTarget(
    entries: VirtualGridEntry[],
    fileIndexToRowIndex: number[],
    currentFileIndex: number,
    key: string,
    totalFiles: number
): number {
    if (totalFiles <= 0) return -1;
    if (key === 'Home') return 0;
    if (key === 'End') return totalFiles - 1;
    if (key === 'ArrowRight') return Math.min(totalFiles - 1, currentFileIndex + 1);
    if (key === 'ArrowLeft') return Math.max(0, currentFileIndex - 1);

    if (key !== 'ArrowDown' && key !== 'ArrowUp') {
        return -1;
    }

    const rowIdx = fileIndexToRowIndex[currentFileIndex];
    const currentRow = rowIdx !== undefined ? entries[rowIdx] : undefined;
    if (!currentRow || currentRow.kind !== 'grid-row') {
        return -1;
    }

    const colIdx = Math.max(0, currentFileIndex - currentRow.startIndex);
    const step = key === 'ArrowDown' ? 1 : -1;

    for (let i = rowIdx + step; i >= 0 && i < entries.length; i += step) {
        const candidate = entries[i];
        if (candidate.kind === 'grid-row' && candidate.items.length > 0) {
            return candidate.startIndex + Math.min(colIdx, candidate.items.length - 1);
        }
    }

    return currentFileIndex;
}

export function collectOutboundDragPaths(
    clickedFile: IFile,
    sortedFiles: IFile[],
    selectedFiles: Set<string>
): string[] {
    if (selectedFiles.has(clickedFile.path) && selectedFiles.size > 0) {
        const ordered = sortedFiles
            .filter((f) => selectedFiles.has(f.path))
            .map((f) => f.path);
        if (ordered.length > 0) {
            return ordered;
        }
    }
    return [clickedFile.path];
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
