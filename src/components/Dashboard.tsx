import React, { useEffect, useState } from 'react';
import {
    Card,
    CardContent,
    List,
    ListItem,
    ProgressIndicator,
    ScrollArea,
} from '@bug-on/m3-expressive';
import { ExpressiveShape } from './ExpressiveShape';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { IFile } from '../types/files';
import { resolveInitialPins, type PinnedItem } from '../utils/dashboardUtils';
import { getSemanticGroup } from '../utils/fileUtils';
import { getFileGroupShapePair, getPinnedIndexShapePair } from '../utils/shapeUtils';
import { api } from '../api';

interface DashboardProps {
    onNavigate: (path: string) => void;
}

interface StorageStats {
    total: number;
    used: number;
    free: number;
}

const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const n = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
    return `${parseFloat((bytes / Math.pow(k, n)).toFixed(1))} ${units[n]}`;
};

function getTimeGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
    const [greeting] = useState<string>(() => getTimeGreeting());
    const [storage, setStorage] = useState<StorageStats | null>(null);
    const [pinnedItems, setPinnedItems] = useLocalStorage<PinnedItem[]>('dashboard.pinned', []);
    const [recentFiles] = useLocalStorage<IFile[]>('dashboard.recent', []);

    useEffect(() => {
        if (!api) return;

        api.getStorageUsage().then((stats) => {
            if (stats) setStorage(stats);
        });

        if (api.getPlaces) {
            api.getPlaces().then((places) => {
                setPinnedItems((prev) => {
                    const resolved = resolveInitialPins(prev, places);
                    if (
                        resolved.length === prev.length &&
                        resolved.every(
                            (item, idx) => item.path === prev[idx].path && item.name === prev[idx].name,
                        )
                    ) {
                        return prev;
                    }
                    return resolved;
                });
            });
        }
    }, [setPinnedItems]);

    const handleAddPin = async () => {
        if (!api?.openDirectoryDialog) return;
        const dirPath = await api.openDirectoryDialog();
        if (!dirPath) return;
        const name = dirPath.split('/').pop() || dirPath;
        setPinnedItems((prev) =>
            prev.some((item) => item.path === dirPath) ? prev : [...prev, { name, path: dirPath }],
        );
    };

    const handleRemovePin = (e: React.MouseEvent, index: number) => {
        e.stopPropagation();
        setPinnedItems((prev) => prev.filter((_, i) => i !== index));
    };

    const usagePercent = storage && storage.total > 0
        ? Math.min(100, Math.max(0, (storage.used / storage.total) * 100))
        : 0;

    return (
        <ScrollArea className="h-full w-full" type="hover">
            <div className="max-w-6xl mx-auto px-6 py-7 flex flex-col gap-6">
                <header className="flex flex-col gap-1">
                    <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-m3-on-surface">
                        {greeting}
                    </h1>
                    <p className="text-sm text-m3-on-surface-variant">
                        Your Expressive Workspace
                    </p>
                </header>

                <div className="grid grid-cols-12 gap-4">
                    {/* Bento Card 1: System Storage */}
                    <Card
                        variant="filled"
                        disableHoverEffect
                        className="col-span-12 lg:col-span-5 rounded-m3-xl bg-m3-surface-container"
                    >
                        <CardContent className="p-6 flex flex-col justify-between gap-6 h-full">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2 text-m3-primary font-medium text-sm">
                                        <Icon name="hard_drive" size={20} filled />
                                        <span>System Storage</span>
                                    </div>
                                    <p className="text-xs text-m3-on-surface-variant">
                                        {storage
                                            ? `${formatBytes(storage.free)} free`
                                            : 'Reading disk volume...'}
                                    </p>
                                </div>

                                <ExpressiveShape
                                    shape="flower"
                                    morphTo="verySunny"
                                    morphOn="hover"
                                    width={68}
                                    height={68}
                                    className="bg-m3-primary-container text-m3-on-primary-container shadow-xs"
                                >
                                    <span className="text-sm font-bold tracking-tight">
                                        {storage ? `${Math.round(usagePercent)}%` : '—'}
                                    </span>
                                </ExpressiveShape>
                            </div>

                            {storage ? (
                                <div className="flex flex-col gap-2.5">
                                    <ProgressIndicator
                                        variant="linear"
                                        shape="wavy"
                                        value={usagePercent}
                                        aria-label="System storage usage"
                                        color="var(--md-sys-color-primary)"
                                        trackColor="var(--md-sys-color-surface-container-highest)"
                                    />
                                    <div className="flex items-center justify-between text-xs font-medium text-m3-on-surface-variant">
                                        <span>{formatBytes(storage.used)} used</span>
                                        <span>{formatBytes(storage.total)} total</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="h-8 flex items-center text-xs text-m3-on-surface-variant">
                                    Loading storage statistics...
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Bento Card 2: Pinned Folders */}
                    <Card
                        variant="elevated"
                        disableHoverEffect
                        className="col-span-12 lg:col-span-7 rounded-m3-xl bg-m3-surface-container"
                    >
                        <CardContent className="p-6 flex flex-col gap-4 h-full">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-m3-primary font-medium text-sm">
                                    <Icon name="push_pin" size={20} filled />
                                    <span>Pinned Folders</span>
                                </div>
                                <span className="text-xs text-m3-on-surface-variant">
                                    {pinnedItems.length} pinned
                                </span>
                            </div>

                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                                {pinnedItems.map((item, idx) => {
                                    const shapePair = getPinnedIndexShapePair(idx);
                                    return (
                                        <div
                                            key={item.path}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => onNavigate(item.path)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    onNavigate(item.path);
                                                }
                                            }}
                                            className="group relative flex flex-col items-center gap-2 p-3 rounded-m3-lg bg-m3-surface-container-low hover:bg-m3-surface-container-high transition-colors cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-m3-primary"
                                        >
                                            <ExpressiveShape
                                                shape={shapePair.rest}
                                                morphTo={shapePair.morph}
                                                morphOn="hover"
                                                width={52}
                                                height={52}
                                                className="bg-m3-primary-container text-m3-on-primary-container"
                                            >
                                                <Icon
                                                    name={item.name === 'Home' ? 'home' : 'folder'}
                                                    size={26}
                                                    filled
                                                />
                                            </ExpressiveShape>
                                            <span className="text-xs font-medium text-m3-on-surface truncate w-full text-center">
                                                {item.name}
                                            </span>
                                            <IconButton
                                                size="xs"
                                                aria-label={`Unpin ${item.name}`}
                                                title="Unpin"
                                                onClick={(e) => handleRemovePin(e, idx)}
                                                className="absolute top-1 right-1 !w-6 !h-6 !min-w-0 !min-h-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 bg-m3-surface-container-highest/90"
                                            >
                                                <Icon name="close" size={14} />
                                            </IconButton>
                                        </div>
                                    );
                                })}

                                <button
                                    type="button"
                                    onClick={handleAddPin}
                                    className="flex flex-col items-center justify-center gap-2 p-3 rounded-m3-lg border border-dashed border-m3-outline-variant hover:border-m3-primary hover:bg-m3-surface-container-high transition-colors cursor-pointer select-none"
                                >
                                    <ExpressiveShape
                                        shape="circle"
                                        morphTo="cookie4Sided"
                                        morphOn="hover"
                                        width={52}
                                        height={52}
                                        className="bg-m3-secondary-container text-m3-on-secondary-container"
                                    >
                                        <Icon name="add" size={24} />
                                    </ExpressiveShape>
                                    <span className="text-xs font-medium text-m3-on-surface-variant">
                                        Add Pin
                                    </span>
                                </button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Bento Card 3: Recent Files */}
                    <Card
                        variant="outlined"
                        disableHoverEffect
                        className="col-span-12 rounded-m3-xl bg-m3-surface-container-low border-m3-outline-variant/50"
                    >
                        <CardContent className="p-6 flex flex-col gap-3">
                            <div className="flex items-center gap-2 text-m3-primary font-medium text-sm">
                                <Icon name="history" size={20} filled />
                                <span>Recent Activity</span>
                            </div>

                            {recentFiles.length === 0 ? (
                                <div className="py-8 text-center text-sm text-m3-on-surface-variant">
                                    No recent files yet. Open folders or files to build your quick-access trail.
                                </div>
                            ) : (
                                <List
                                    variant="expressive"
                                    listStyle="segmented"
                                    selectionMode="single-action"
                                >
                                    {recentFiles.slice(0, 10).map((file) => {
                                        const group = getSemanticGroup(file);
                                        const shapePair = getFileGroupShapePair(group, file.isDirectory, file.name);
                                        return (
                                            <ListItem
                                                key={file.path}
                                                value={file.path}
                                                headline={file.name}
                                                supportingText={file.path}
                                                leadingType="custom"
                                                leadingContent={
                                                    <ExpressiveShape
                                                        shape={shapePair.rest}
                                                        morphTo={shapePair.morph}
                                                        morphOn="hover"
                                                        width={40}
                                                        height={40}
                                                        className={shapePair.containerClass}
                                                    >
                                                        <Icon
                                                            name={file.isDirectory ? 'folder' : 'article'}
                                                            size={20}
                                                        />
                                                    </ExpressiveShape>
                                                }
                                                onClick={() => onNavigate(file.path)}
                                            />
                                        );
                                    })}
                                </List>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </ScrollArea>
    );
};
