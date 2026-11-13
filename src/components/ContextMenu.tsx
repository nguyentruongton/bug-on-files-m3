import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Divider, FAST_SPATIAL_SPRING } from '@bug-on/m3-expressive';
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

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onClose();
            }
        };

        const timer = setTimeout(() => {
            document.addEventListener('click', handleClickOutside);
        }, 0);
        document.addEventListener('keydown', handleEscape, true);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('click', handleClickOutside);
            document.removeEventListener('keydown', handleEscape, true);
        };
    }, [onClose]);

    useEffect(() => {
        const menuEl = menuRef.current;
        if (!menuEl) return;

        const { innerWidth, innerHeight } = window;
        const rect = menuEl.getBoundingClientRect();

        let newX = x;
        let newY = y;

        if (x + rect.width > innerWidth) {
            newX = Math.max(8, x - rect.width);
        }
        if (y + rect.height > innerHeight) {
            newY = Math.max(8, y - rect.height);
        }

        menuEl.style.left = `${newX}px`;
        menuEl.style.top = `${newY}px`;

        const firstItem = menuEl.querySelector<HTMLElement>('[role="menuitem"]');
        (firstItem ?? menuEl).focus();
    }, [x, y]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const menuEl = menuRef.current;
        if (!menuEl) return;

        if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
            return;
        }

        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
            return;
        }

        const menuItems = Array.from(
            menuEl.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')
        );
        if (menuItems.length === 0) return;

        e.preventDefault();
        const activeIdx = menuItems.indexOf(document.activeElement as HTMLElement);
        let nextIdx = 0;

        if (e.key === 'Home') {
            nextIdx = 0;
        } else if (e.key === 'End') {
            nextIdx = menuItems.length - 1;
        } else if (e.key === 'ArrowDown') {
            nextIdx = activeIdx === -1 ? 0 : (activeIdx + 1) % menuItems.length;
        } else {
            nextIdx =
                activeIdx === -1
                    ? menuItems.length - 1
                    : (activeIdx - 1 + menuItems.length) % menuItems.length;
        }

        menuItems[nextIdx]?.focus();
    };

    return (
        <motion.div
            ref={menuRef}
            role="menu"
            aria-label="Context menu"
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={FAST_SPATIAL_SPRING}
            style={{ left: x, top: y }}
            className="fixed z-50 min-w-[200px] max-w-[280px] bg-m3-surface-container-high text-m3-on-surface rounded-m3-lg p-1.5 select-none origin-top-left focus:outline-none"
        >
            {items.map((item, index) =>
                item.divider ? (
                    <Divider key={index} role="separator" className="my-1" />
                ) : (
                    <button
                        key={index}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                            item.action();
                            onClose();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-m3-md text-sm font-medium hover:bg-m3-secondary-container hover:text-m3-on-secondary-container focus:outline-none focus-visible:ring-2 focus-visible:ring-m3-primary transition-colors text-left cursor-pointer"
                    >
                        {item.icon && <Icon name={item.icon} size={18} className="shrink-0 opacity-85" />}
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.shortcut && (
                            <span className="text-xs text-m3-on-surface-variant ml-2">
                                {item.shortcut}
                            </span>
                        )}
                    </button>
                )
            )}
        </motion.div>
    );
};
