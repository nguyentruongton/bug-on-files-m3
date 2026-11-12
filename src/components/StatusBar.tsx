import React from 'react';
import { formatFileSize } from '../utils/fileUtils';

interface StatusBarProps {
    totalItems: number;
    visibleItems?: number;
    hiddenCount?: number;
    selectedCount: number;
    selectedSize?: number;
}

export const StatusBar: React.FC<StatusBarProps> = ({
    totalItems,
    visibleItems,
    hiddenCount = 0,
    selectedCount,
    selectedSize = 0,
}) => {
    const shownCount = visibleItems ?? totalItems;

    return (
        <div className="h-8 px-5 bg-m3-surface-container border-t border-m3-outline-variant/40 text-xs text-m3-on-surface-variant flex items-center justify-between select-none shrink-0">
            <div className="flex items-center gap-2.5">
                <span className="font-medium">
                    {shownCount} {shownCount === 1 ? 'item' : 'items'}
                </span>
                {hiddenCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-m3-surface-container-highest text-[11px] text-m3-on-surface-variant">
                        {hiddenCount} hidden
                    </span>
                )}
            </div>

            {selectedCount > 0 && (
                <div className="px-2.5 py-0.5 rounded-full bg-m3-primary-container text-m3-on-primary-container font-medium text-[11px]">
                    {selectedCount} selected
                    {selectedSize > 0 ? ` · ${formatFileSize(selectedSize)}` : ''}
                </div>
            )}
        </div>
    );
};
