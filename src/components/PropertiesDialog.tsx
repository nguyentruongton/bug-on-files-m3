import React, { useEffect, useState } from 'react';
import { ShapeMedia } from '@bug-on/m3-expressive';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import type { IFile } from '../types/files';
import { api } from '../api';

interface PropertiesDialogProps {
    file: IFile | null;
    open: boolean;
    onClose: () => void;
}

export const PropertiesDialog: React.FC<PropertiesDialogProps> = ({ file, open, onClose }) => {
    const [dirSizeState, setDirSizeState] = useState<{ path: string; size: number } | null>(null);

    useEffect(() => {
        if (!open || !file || !file.isDirectory || !api?.getDirectorySize) return;
        let cancelled = false;
        api.getDirectorySize(file.path)
            .then((size) => {
                if (!cancelled) {
                    setDirSizeState({ path: file.path, size });
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setDirSizeState({ path: file.path, size: 0 });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [open, file]);

    if (!file) return null;

    const calculatedSize = !file.isDirectory
        ? file.size
        : dirSizeState?.path === file.path
            ? dirSizeState.size
            : null;
    const isCalculating = Boolean(open && file.isDirectory && calculatedSize === null && api?.getDirectorySize);

    return (
        <Dialog
            title="Properties"
            icon={<Icon name="info" size={24} />}
            open={open}
            onClose={onClose}
            maxWidth="max-w-md"
            actions={<Button onClick={onClose}>Close</Button>}
        >
            <div className="flex flex-col gap-5 min-w-[320px]">
                <div className="flex items-center gap-4">
                    <ShapeMedia
                        shape="cookie4Sided"
                        morphTo="flower"
                        morphOn="hover"
                        width={64}
                        height={64}
                        className="bg-m3-primary-container text-m3-on-primary-container flex items-center justify-center shrink-0"
                    >
                        <Icon
                            name={file.isDirectory ? 'folder' : 'insert_drive_file'}
                            filled={file.isDirectory}
                            size={32}
                        />
                    </ShapeMedia>
                    <div className="min-w-0 flex-1">
                        <div className="text-lg font-medium text-m3-on-surface break-all" style={{ userSelect: 'text' }}>{file.name}</div>
                        <div className="text-xs font-medium text-m3-on-surface-variant">
                            {file.isDirectory ? 'Folder' : 'File'}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-[96px_1fr] gap-y-3 gap-x-3 text-sm rounded-m3-lg bg-m3-surface-container-high/50 p-4">
                    <div className="text-m3-on-surface-variant font-medium">Location</div>
                    <div className="text-m3-on-surface break-all" style={{ userSelect: 'text' }}>{file.path}</div>

                    <div className="text-m3-on-surface-variant font-medium">Size</div>
                    <div className="flex items-center gap-2 text-m3-on-surface">
                        {isCalculating ? (
                            <span className="italic text-m3-primary">Calculating...</span>
                        ) : (
                            <span>
                                {calculatedSize !== null ? formatSize(calculatedSize) : '-'}
                                <span className="text-m3-on-surface-variant ml-1.5 text-xs">
                                    ({calculatedSize?.toLocaleString()} bytes)
                                </span>
                            </span>
                        )}
                    </div>

                    <div className="text-m3-on-surface-variant font-medium">Modified</div>
                    <div className="text-m3-on-surface">{new Date(file.mtime).toLocaleString()}</div>

                    <div className="text-m3-on-surface-variant font-medium">Type</div>
                    <div className="text-m3-on-surface">
                        {file.isDirectory ? 'Directory' : file.name.split('.').pop()?.toUpperCase() || 'File'}
                    </div>
                </div>
            </div>
        </Dialog>
    );
};

function formatSize(bytes: number) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
