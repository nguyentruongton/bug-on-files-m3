import React from 'react';
import { LoadingIndicator } from '@bug-on/m3-expressive';

interface FileListSkeletonProps {
    viewMode: 'grid' | 'list';
    count?: number;
    iconSize?: number;
}

export const FileListSkeleton: React.FC<FileListSkeletonProps> = ({
    viewMode,
    count = 12,
    iconSize = 64,
}) => {
    return (
        <div className="flex flex-col gap-5 p-5 h-full overflow-hidden">
            <div className="flex items-center justify-center gap-3 pt-2 text-m3-on-surface-variant text-xs font-medium">
                <LoadingIndicator size={32} aria-label="Loading folder contents" />
                <span>Loading folder contents...</span>
            </div>

            {viewMode === 'grid' ? (
                <div
                    className="grid gap-3"
                    style={{
                        gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(112, iconSize + 48)}px, 1fr))`,
                    }}
                >
                    {Array.from({ length: count }).map((_, i) => (
                        <div
                            key={i}
                            className="flex flex-col items-center gap-2.5 p-3 rounded-m3-lg bg-m3-surface-container animate-pulse"
                        >
                            <div
                                className="rounded-m3-md bg-m3-surface-container-highest"
                                style={{ width: iconSize, height: iconSize }}
                            />
                            <div className="h-3.5 w-3/4 rounded-full bg-m3-surface-container-highest" />
                            <div className="h-2.5 w-1/2 rounded-full bg-m3-surface-container-high" />
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {Array.from({ length: count }).map((_, i) => (
                        <div
                            key={i}
                            className="flex items-center gap-4 h-11 px-4 rounded-m3-md bg-m3-surface-container animate-pulse"
                        >
                            <div className="w-7 h-7 rounded-m3-sm bg-m3-surface-container-highest shrink-0" />
                            <div className="h-3.5 w-2/5 rounded-full bg-m3-surface-container-highest" />
                            <div className="h-3 w-24 rounded-full bg-m3-surface-container-high ml-auto" />
                            <div className="h-3 w-14 rounded-full bg-m3-surface-container-high" />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
