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
