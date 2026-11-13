import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { FAST_SPATIAL_SPRING, LoadingIndicator } from '@bug-on/m3-expressive';
import { ExpressiveShape } from './ExpressiveShape';
import type { IFile } from '../types/files';
import type { TextPreview } from '../api/types';
import { api } from '../api';
import {
    getArrowStepDelta,
    getPreviewKind,
    stepIndex,
    toMediaUrl,
    type PreviewKind,
} from '../utils/quickLook';
import { formatFileDate, formatFileSize, getFileIconInfo } from '../utils/fileUtils';
import { isModalDialogOpen } from '../utils/themeUtils';
import { FileSystemService } from '../services/FileSystemService';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Button } from './Button';

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

    const [mediaErrorPath, setMediaErrorPath] = useState<string | null>(null);
    const hasMediaError = mediaErrorPath === file.path;

    const previewKind: PreviewKind = hasMediaError ? 'other' : rawKind;

    const [textPreview, setTextPreview] = useState<{ path: string; data: TextPreview } | null>(null);

    const [folderInfo, setFolderInfo] = useState<{
        path: string;
        itemCount: number | null;
        size: number | null;
    }>({ path: '', itemCount: null, size: null });

    useEffect(() => {
        if (previewKind !== 'text') return;

        let cancelled = false;

        if (api && typeof api.readTextPreview === 'function') {
            api.readTextPreview(file.path)
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

    useEffect(() => {
        if (previewKind !== 'folder') return;

        let cancelled = false;

        FileSystemService.listDir(file.path)
            .then((items) => {
                if (!cancelled) {
                    setFolderInfo((prev) =>
                        prev.path === file.path
                            ? { ...prev, itemCount: items.length }
                            : { path: file.path, itemCount: items.length, size: null },
                    );
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setFolderInfo((prev) =>
                        prev.path === file.path
                            ? { ...prev, itemCount: 0 }
                            : { path: file.path, itemCount: 0, size: null },
                    );
                }
            });

        if (api && typeof api.getDirectorySize === 'function') {
            api.getDirectorySize(file.path)
                .then((size) => {
                    if (!cancelled) {
                        setFolderInfo((prev) =>
                            prev.path === file.path
                                ? { ...prev, size }
                                : { path: file.path, itemCount: null, size },
                        );
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        setFolderInfo((prev) =>
                            prev.path === file.path
                                ? { ...prev, size: 0 }
                                : { path: file.path, itemCount: null, size: 0 },
                        );
                    }
                });
        }

        return () => {
            cancelled = true;
        };
    }, [file.path, previewKind]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isModalDialogOpen()) {
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

    const headerMeta = useMemo(() => {
        if (file.isDirectory) {
            const hasSamePath = folderInfo.path === file.path;
            const itemsStr =
                hasSamePath && folderInfo.itemCount !== null
                    ? `${folderInfo.itemCount} ${folderInfo.itemCount === 1 ? 'item' : 'items'}`
                    : 'Calculating…';
            const sizeStr =
                hasSamePath && folderInfo.size !== null
                    ? formatFileSize(folderInfo.size)
                    : 'Calculating…';
            return `${itemsStr} • ${sizeStr} • ${formatFileDate(file.mtime)}`;
        }
        return `${formatFileSize(file.size)} • ${formatFileDate(file.mtime)}`;
    }, [file, folderInfo]);

    const renderBody = () => {
        switch (previewKind) {
            case 'image':
                return (
                    <div className="flex-1 min-h-[320px] flex items-center justify-center p-4 bg-m3-surface-container-lowest overflow-auto">
                        <img
                            key={file.path}
                            src={toMediaUrl(file.path)}
                            alt={file.name}
                            className="max-w-full max-h-[68vh] object-contain rounded-m3-md"
                            onError={() => setMediaErrorPath(file.path)}
                        />
                    </div>
                );

            case 'video':
                return (
                    <div className="flex-1 min-h-[320px] flex items-center justify-center p-4 bg-m3-surface-container-lowest">
                        <video
                            key={file.path}
                            src={toMediaUrl(file.path)}
                            controls
                            autoPlay={false}
                            className="max-w-full max-h-[68vh] rounded-m3-md outline-none"
                            onError={() => setMediaErrorPath(file.path)}
                        />
                    </div>
                );

            case 'audio':
                return (
                    <div className="flex-1 min-h-[280px] flex items-center justify-center p-8 bg-m3-surface-container-low">
                        <div className="flex flex-col items-center gap-4 w-full max-w-md p-6 rounded-m3-xl bg-m3-surface-container">
                            <ExpressiveShape
                                shape="cookie6Sided"
                                morphTo="verySunny"
                                morphOn="hover"
                                width={88}
                                height={88}
                                className="bg-m3-tertiary-container text-m3-on-tertiary-container"
                            >
                                <Icon name="audio_file" size={44} />
                            </ExpressiveShape>
                            <div className="text-base font-medium text-m3-on-surface text-center truncate w-full">
                                {file.name}
                            </div>
                            <audio
                                key={file.path}
                                src={toMediaUrl(file.path)}
                                controls
                                autoPlay={false}
                                className="w-full"
                                onError={() => setMediaErrorPath(file.path)}
                            />
                        </div>
                    </div>
                );

            case 'pdf':
                return (
                    <div className="flex-1 min-h-[480px] flex bg-m3-surface-container-lowest">
                        <iframe
                            key={file.path}
                            src={toMediaUrl(file.path)}
                            title={file.name}
                            className="w-full h-full min-h-[65vh] border-0"
                            onError={() => setMediaErrorPath(file.path)}
                        />
                    </div>
                );

            case 'text': {
                const isCurrent = textPreview?.path === file.path;
                if (!isCurrent) {
                    return (
                        <div className="flex-1 min-h-[300px] flex flex-col items-center justify-center gap-3 text-sm text-m3-on-surface-variant">
                            <LoadingIndicator size={36} aria-label="Loading text preview" />
                            <span>Loading preview…</span>
                        </div>
                    );
                }

                const result = textPreview.data;
                if (result.kind === 'too-large') {
                    return (
                        <div className="flex-1 min-h-[280px] flex flex-col items-center justify-center gap-3 p-8 text-m3-on-surface-variant">
                            <Icon name="warning" size={48} className="text-m3-error" />
                            <div className="text-sm font-medium">
                                File is too large to preview ({formatFileSize(result.size)})
                            </div>
                        </div>
                    );
                }

                if (result.kind === 'binary') {
                    return (
                        <div className="flex-1 min-h-[280px] flex flex-col items-center justify-center gap-3 p-8 text-m3-on-surface-variant">
                            <Icon name="insert_drive_file" size={48} />
                            <div className="text-sm font-medium">Binary file</div>
                        </div>
                    );
                }

                if (result.kind === 'error') {
                    return (
                        <div className="flex-1 min-h-[280px] flex flex-col items-center justify-center gap-3 p-8 text-m3-on-surface-variant">
                            <Icon name="error_outline" size={48} className="text-m3-error" />
                            <div className="text-sm font-medium">Couldn&apos;t read file</div>
                        </div>
                    );
                }

                return (
                    <div className="flex-1 min-h-0 overflow-auto bg-m3-surface-container-lowest p-5">
                        <pre className="quicklook-text-content m-0 font-mono text-xs sm:text-sm leading-relaxed text-m3-on-surface whitespace-pre-wrap break-words">
                            {result.content}
                        </pre>
                    </div>
                );
            }

            case 'folder': {
                const isCurrent = folderInfo.path === file.path;
                const itemsDisplay =
                    isCurrent && folderInfo.itemCount !== null
                        ? `${folderInfo.itemCount} ${folderInfo.itemCount === 1 ? 'item' : 'items'}`
                        : 'Calculating…';
                const sizeDisplay =
                    isCurrent && folderInfo.size !== null
                        ? formatFileSize(folderInfo.size)
                        : 'Calculating…';

                return (
                    <div className="flex-1 min-h-[300px] flex items-center justify-center p-8">
                        <div className="flex flex-col items-center gap-3 text-center max-w-md">
                            <ExpressiveShape
                                shape="clover4Leaf"
                                morphTo="flower"
                                morphOn="hover"
                                width={96}
                                height={96}
                                className="bg-m3-primary-container text-m3-on-primary-container"
                            >
                                <Icon name="folder" size={48} filled />
                            </ExpressiveShape>
                            <div className="text-xl font-semibold text-m3-on-surface break-all">
                                {file.name}
                            </div>
                            <div className="flex flex-col gap-1 text-xs text-m3-on-surface-variant">
                                <div>{itemsDisplay}</div>
                                <div>Total Size: {sizeDisplay}</div>
                                <div>Modified: {formatFileDate(file.mtime)}</div>
                                <div className="break-all opacity-80 mt-1">{file.path}</div>
                            </div>
                        </div>
                    </div>
                );
            }

            case 'other':
            default:
                return (
                    <div className="flex-1 min-h-[300px] flex items-center justify-center p-8">
                        <div className="flex flex-col items-center gap-3 text-center max-w-md">
                            <ExpressiveShape
                                shape="clover4Leaf"
                                morphTo="flower"
                                morphOn="hover"
                                width={96}
                                height={96}
                                className="bg-m3-secondary-container text-m3-on-secondary-container"
                            >
                                <Icon name={iconInfo.icon} size={48} />
                            </ExpressiveShape>
                            <div className="text-xl font-semibold text-m3-on-surface break-all">
                                {file.name}
                            </div>
                            <div className="flex flex-col gap-1 text-xs text-m3-on-surface-variant">
                                <div>Size: {formatFileSize(file.size)}</div>
                                <div>Modified: {formatFileDate(file.mtime)}</div>
                                <div className="break-all opacity-80 mt-1">{file.path}</div>
                            </div>
                        </div>
                    </div>
                );
        }
    };

    return (
        <div
            className="fixed inset-0 z-40 bg-black/55 backdrop-blur-xs flex items-center justify-center p-6"
            onClick={onClose}
            role="presentation"
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={FAST_SPATIAL_SPRING}
                className="w-full max-w-4xl max-h-[85vh] bg-m3-surface-container-high text-m3-on-surface rounded-m3-xl flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={`Preview of ${file.name}`}
            >
                <header className="flex items-center justify-between gap-4 px-5 py-3.5 bg-m3-surface-container shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <Icon
                            name={iconInfo.icon}
                            size={24}
                            filled={file.isDirectory}
                            className={`shrink-0 ${iconInfo.colorClass}`}
                        />
                        <div className="flex flex-col min-w-0">
                            <span
                                className="text-base font-semibold text-m3-on-surface truncate"
                                title={file.name}
                            >
                                {file.name}
                            </span>
                            <span className="text-xs text-m3-on-surface-variant truncate">
                                {headerMeta}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <Button
                            variant="tonal"
                            size="sm"
                            icon={<Icon name="open_in_new" size={18} />}
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
            </motion.div>
        </div>
    );
};
