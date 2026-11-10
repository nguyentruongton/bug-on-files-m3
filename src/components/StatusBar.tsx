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
        <div
            style={{
                height: '28px',
                borderTop: '1px solid var(--md-sys-color-outline-variant)',
                background: 'var(--md-sys-color-surface-container-low)',
                color: 'var(--md-sys-color-on-surface-variant)',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 20px',
                gap: '16px',
                flexShrink: 0,
                userSelect: 'none',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span>
                    {shownCount} {shownCount === 1 ? 'item' : 'items'}
                </span>
                {hiddenCount > 0 && (
                    <span style={{ opacity: 0.75 }}>
                        ({hiddenCount} hidden)
                    </span>
                )}
            </div>
            {selectedCount > 0 && (
                <div style={{ color: 'var(--md-sys-color-primary)', fontWeight: 500 }}>
                    {selectedCount} selected
                    {selectedSize > 0 ? ` (${formatFileSize(selectedSize)})` : ''}
                </div>
            )}
        </div>
    );
};
