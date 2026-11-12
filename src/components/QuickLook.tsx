import React, { useState, useEffect, useMemo } from 'react';
import type { IFile } from '../types/files';
import type { TextPreview } from '../api/types';
import {
    getPreviewKind,
    toMediaUrl,
    stepIndex,
    getArrowStepDelta,
    type PreviewKind,
} from '../utils/quickLook';
import { getFileIconInfo, formatFileSize, formatFileDate } from '../utils/fileUtils';
import { FileSystemService } from '../services/FileSystemService';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Button } from './Button';
import './QuickLook.css';

export interface QuickLookProps {
    file: IFile;
    files: IFile[];
    viewMode: 'grid' | 'list';
    onClose: () => void;
    onNavigate: (file: IFile) => void;
    onOpen: (file: IFile) => void;
}

export const QuickLook: React.FC<QuickLookProps> = ({
    file,
    files,
    viewMode,
    onClose,
    onNavigate,
    onOpen,
}) => {
    const rawKind = useMemo(() => getPreviewKind(file), [file]);
    const iconInfo = useMemo(() => getFileIconInfo(file), [file]);

    // Track media load errors per file
    const [mediaErrorPath, setMediaErrorPath] = useState<string | null>(null);
    const hasMediaError = mediaErrorPath === file.path;

    const previewKind: PreviewKind = hasMediaError ? 'other' : rawKind;

    // Text preview state
    const [textPreview, setTextPreview] = useState<{ path: string; data: TextPreview } | null>(null);

    // Folder preview state
    const [folderInfo, setFolderInfo] = useState<{
        path: string;
        itemCount: number | null;
        size: number | null;
    }>({ path: '', itemCount: null, size: null });

    // Cancelled-effect guard for text preview
    useEffect(() => {
        if (previewKind !== 'text') {
            return;
        }

        let cancelled = false;

        if (window.electron && typeof window.electron.readTextPreview === 'function') {
            window.electron.readTextPreview(file.path)
                .then((data) => {
                    if (!cancelled) {
                        setTextPreview({ path: file.path, data });
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        setTextPreview({ path: file.path, data: { kind: 'error' } });
                    }
                });
        } else {
            Promise.resolve().then(() => {
                if (!cancelled) {
                    setTextPreview({ path: file.path, data: { kind: 'error' } });
                }
            });
        }

        return () => {
            cancelled = true;
        };
    }, [file.path, previewKind]);

    // Cancelled-effect guard for folder preview
    useEffect(() => {
        if (previewKind !== 'folder') {
            return;
        }

        let cancelled = false;

        FileSystemService.listDir(file.path)
            .then((items) => {
                if (!cancelled) {
                    setFolderInfo((prev) =>
                        prev.path === file.path
                            ? { ...prev, itemCount: items.length }
                            : { path: file.path, itemCount: items.length, size: null }
                    );
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setFolderInfo((prev) =>
                        prev.path === file.path
                            ? { ...prev, itemCount: 0 }
                            : { path: file.path, itemCount: 0, size: null }
                    );
                }
            });

        if (window.electron && typeof window.electron.getDirectorySize === 'function') {
            window.electron.getDirectorySize(file.path)
                .then((size) => {
                    if (!cancelled) {
                        setFolderInfo((prev) =>
                            prev.path === file.path
                                ? { ...prev, size }
                                : { path: file.path, itemCount: null, size }
                        );
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        setFolderInfo((prev) =>
                            prev.path === file.path
                                ? { ...prev, size: 0 }
                                : { path: file.path, itemCount: null, size: 0 }
                        );
                    }
                });
        }

        return () => {
            cancelled = true;
        };
    }, [file.path, previewKind]);

    // Capture-phase keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Pre-flight ruling: ignore if modal dialog is open above it
            if (document.querySelector('dialog[open]')) {
                return;
            }

            const target = e.target as HTMLElement | null;
            if (
                target &&
                (target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.isContentEditable)
            ) {
                return;
            }

            if (e.key === 'Escape' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
                return;
            }

            const delta = getArrowStepDelta(e.key, viewMode);
            if (delta !== null) {
                e.preventDefault();
                e.stopPropagation();
                const currentIndex = files.findIndex((f) => f.path === file.path);
                if (currentIndex !== -1 && files.length > 0) {
                    const nextIndex = stepIndex(currentIndex, files.length, delta);
                    if (nextIndex !== currentIndex && files[nextIndex]) {
                        onNavigate(files[nextIndex]);
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [file.path, files, viewMode, onClose, onNavigate]);

    // Subtitle string for header
    const headerMeta = useMemo(() => {
        if (file.isDirectory) {
            const hasSamePath = folderInfo.path === file.path;
            const itemsStr = hasSamePath && folderInfo.itemCount !== null
                ? `${folderInfo.itemCount} ${folderInfo.itemCount === 1 ? 'item' : 'items'}`
                : 'Calculating…';
            const sizeStr = hasSamePath && folderInfo.size !== null
                ? formatFileSize(folderInfo.size)
                : 'Calculating…';
            return `${itemsStr} • ${sizeStr} • ${formatFileDate(file.mtime)}`;
        }
        return `${formatFileSize(file.size)} • ${formatFileDate(file.mtime)}`;
    }, [file, folderInfo]);

    // Render body based on previewKind
    const renderBody = () => {
        switch (previewKind) {
            case 'image':
                return (
                    <div className="quicklook-body quicklook-body--media">
                        <img
                            key={file.path}
                            src={toMediaUrl(file.path)}
                            alt={file.name}
                            className="quicklook-image"
                            onError={() => setMediaErrorPath(file.path)}
                        />
                    </div>
                );

            case 'video':
                return (
                    <div className="quicklook-body quicklook-body--media">
                        <video
                            key={file.path}
                            src={toMediaUrl(file.path)}
                            controls
                            autoPlay={false}
                            className="quicklook-video"
                            onError={() => setMediaErrorPath(file.path)}
                        />
                    </div>
                );

            case 'audio':
                return (
                    <div className="quicklook-body">
                        <div className="quicklook-audio-card">
                            <Icon name="audio_file" size={64} className="media-icon" />
                            <div className="quicklook-audio-name">{file.name}</div>
                            <audio
                                key={file.path}
                                src={toMediaUrl(file.path)}
                                controls
                                autoPlay={false}
                                className="quicklook-audio"
                                onError={() => setMediaErrorPath(file.path)}
                            />
                        </div>
                    </div>
                );

            case 'pdf':
                return (
                    <div className="quicklook-body">
                        <iframe
                            key={file.path}
                            src={toMediaUrl(file.path)}
                            title={file.name}
                            className="quicklook-pdf"
                            onError={() => setMediaErrorPath(file.path)}
                        />
                    </div>
                );

            case 'text': {
                const isCurrent = textPreview?.path === file.path;
                if (!isCurrent) {
                    return (
                        <div className="quicklook-body">
                            <div className="quicklook-loading">Loading preview…</div>
                        </div>
                    );
                }

                const result = textPreview.data;
                if (result.kind === 'too-large') {
                    return (
                        <div className="quicklook-body">
                            <div className="quicklook-notice">
                                <Icon name="warning" size={48} />
                                <div className="quicklook-notice__text">
                                    File is too large to preview ({formatFileSize(result.size)})
                                </div>
                            </div>
                        </div>
                    );
                }

                if (result.kind === 'binary') {
                    return (
                        <div className="quicklook-body">
                            <div className="quicklook-notice">
                                <Icon name="insert_drive_file" size={48} />
                                <div className="quicklook-notice__text">Binary file</div>
                            </div>
                        </div>
                    );
                }

                if (result.kind === 'error') {
                    return (
                        <div className="quicklook-body">
                            <div className="quicklook-notice">
                                <Icon name="error_outline" size={48} />
                                <div className="quicklook-notice__text">Couldn't read file</div>
                            </div>
                        </div>
                    );
                }

                return (
                    <div className="quicklook-body">
                        <div className="quicklook-text-container">
                            <pre className="quicklook-text-content">{result.content}</pre>
                        </div>
                    </div>
                );
            }

            case 'folder': {
                const isCurrent = folderInfo.path === file.path;
                const itemsDisplay = isCurrent && folderInfo.itemCount !== null
                    ? `${folderInfo.itemCount} ${folderInfo.itemCount === 1 ? 'item' : 'items'}`
                    : 'Calculating…';
                const sizeDisplay = isCurrent && folderInfo.size !== null
                    ? formatFileSize(folderInfo.size)
                    : 'Calculating…';

                return (
                    <div className="quicklook-body">
                        <div className="quicklook-info-panel">
                            <Icon name="folder" size={72} className="folder-icon" />
                            <div className="quicklook-info-panel__title">{file.name}</div>
                            <div className="quicklook-info-panel__details">
                                <div>{itemsDisplay}</div>
                                <div>Total Size: {sizeDisplay}</div>
                                <div>Modified: {formatFileDate(file.mtime)}</div>
                                <div>{file.path}</div>
                            </div>
                        </div>
                    </div>
                );
            }

            case 'other':
            default:
                return (
                    <div className="quicklook-body">
                        <div className="quicklook-info-panel">
                            <Icon name={iconInfo.icon} size={72} className={iconInfo.colorClass} />
                            <div className="quicklook-info-panel__title">{file.name}</div>
                            <div className="quicklook-info-panel__details">
                                <div>Size: {formatFileSize(file.size)}</div>
                                <div>Modified: {formatFileDate(file.mtime)}</div>
                                <div>{file.path}</div>
                            </div>
                        </div>
                    </div>
                );
        }
    };

    return (
        <div className="quicklook-scrim" onClick={onClose} role="presentation">
            <div
                className="quicklook-card"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={`Preview of ${file.name}`}
            >
                <header className="quicklook-header">
                    <div className="quicklook-header__info">
                        <Icon
                            name={iconInfo.icon}
                            className={`quicklook-header__icon ${iconInfo.colorClass}`}
                        />
                        <div className="quicklook-header__text">
                            <span className="quicklook-header__title" title={file.name}>
                                {file.name}
                            </span>
                            <span className="quicklook-header__meta">{headerMeta}</span>
                        </div>
                    </div>
                    <div className="quicklook-header__actions">
                        <Button
                            variant="tonal"
                            icon={<Icon name="open_in_new" />}
                            onClick={() => onOpen(file)}
                        >
                            Open
                        </Button>
                        <IconButton
                            variant="standard"
                            onClick={onClose}
                            title="Close (Escape or Space)"
                            aria-label="Close preview"
                        >
                            <Icon name="close" />
                        </IconButton>
                    </div>
                </header>
                {renderBody()}
            </div>
        </div>
    );
};
