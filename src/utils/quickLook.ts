import type { IFile } from '../types/files';
import {
    isImageFile,
    isVideoFile,
    isAudioFile,
    isPdfFile,
    isTextFile,
} from './fileUtils';

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'folder' | 'other';

export function getPreviewKind(file: IFile): PreviewKind {
    if (file.isDirectory) {
        return 'folder';
    }
    const name = file.name;
    if (isImageFile(name)) return 'image';
    if (isVideoFile(name)) return 'video';
    if (isAudioFile(name)) return 'audio';
    if (isPdfFile(name)) return 'pdf';
    if (isTextFile(name)) return 'text';
    return 'other';
}

export function toMediaUrl(path: string): string {
    const encodedSegments = path.split('/').map(encodeURIComponent).join('/');
    return `media://${encodedSegments}`;
}

export function stepIndex(index: number, length: number, delta: number): number {
    if (length <= 0) {
        return -1;
    }
    const next = index + delta;
    return Math.max(0, Math.min(length - 1, next));
}

export function resolveQuickLookTarget(
    selectedFiles: Set<string>,
    lastSelectedPath: string | null,
    sortedFiles: IFile[]
): IFile | null {
    if (selectedFiles.size === 0) {
        return null;
    }
    if (lastSelectedPath && selectedFiles.has(lastSelectedPath)) {
        const found = sortedFiles.find((f) => f.path === lastSelectedPath);
        if (found) return found;
    }
    const firstSelected = sortedFiles.find((f) => selectedFiles.has(f.path));
    return firstSelected ?? null;
}

export function resolveQuickLookFallback(
    prevPath: string,
    prevFiles: IFile[],
    newFiles: IFile[]
): IFile | null {
    if (newFiles.length === 0) {
        return null;
    }
    const stillPresent = newFiles.find((f) => f.path === prevPath);
    if (stillPresent) {
        return stillPresent;
    }
    const prevIndex = prevFiles.findIndex((f) => f.path === prevPath);
    if (prevIndex === -1) {
        return newFiles[0];
    }
    const clampedIndex = Math.min(prevIndex, newFiles.length - 1);
    return newFiles[clampedIndex];
}

export function getArrowStepDelta(key: string, viewMode: 'grid' | 'list'): number | null {
    if (key === 'ArrowLeft') return -1;
    if (key === 'ArrowRight') return 1;
    if (viewMode === 'list') {
        if (key === 'ArrowUp') return -1;
        if (key === 'ArrowDown') return 1;
    }
    return null;
}

