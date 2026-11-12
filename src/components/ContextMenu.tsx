import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { FAST_SPATIAL_SPRING } from '@bug-on/m3-expressive';
import { Icon } from './Icon';

export interface ContextMenuItem {
    label: string;
    icon?: string;
    action: () => void;
    shortcut?: string;
    divider?: boolean;
}

interface ContextMenuProps {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        const timer = setTimeout(() => {
            document.addEventListener('click', handleClickOutside);
        }, 0);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('click', handleClickOutside);
        };
    }, [onClose]);

    useEffect(() => {
        if (!menuRef.current) return;
        const { innerWidth, innerHeight } = window;
        const rect = menuRef.current.getBoundingClientRect();

        let newX = x;
        let newY = y;

        if (x + rect.width > innerWidth) {
            newX = Math.max(8, x - rect.width);
        }
        if (y + rect.height > innerHeight) {
            newY = Math.max(8, y - rect.height);
        }

        menuRef.current.style.left = `${newX}px`;
        menuRef.current.style.top = `${newY}px`;
    }, [x, y]);

    return (
        <motion.div
            ref={menuRef}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={FAST_SPATIAL_SPRING}
            style={{ left: x, top: y }}
            className="fixed z-50 min-w-[200px] max-w-[280px] bg-m3-surface-container-high text-m3-on-surface rounded-m3-lg p-1.5 shadow-xl border border-m3-outline-variant/40 select-none origin-top-left"
        >
            {items.map((item, index) =>
                item.divider ? (
                    <div key={index} className="my-1 h-px bg-m3-outline-variant/40" />
                ) : (
                    <button
                        key={index}
                        type="button"
                        onClick={() => {
                            item.action();
                            onClose();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-m3-md text-sm font-medium hover:bg-m3-secondary-container hover:text-m3-on-secondary-container transition-colors text-left cursor-pointer"
                    >
                        {item.icon && <Icon name={item.icon} size={18} className="shrink-0 opacity-85" />}
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.shortcut && (
                            <span className="text-xs text-m3-on-surface-variant ml-2">
                                {item.shortcut}
                            </span>
                        )}
                    </button>
                ),
            )}
        </motion.div>
    );
};
