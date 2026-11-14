import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import {
    FAST_SPATIAL_SPRING,
    MenuItem,
    VerticalMenu,
    VerticalMenuContent,
    VerticalMenuGroup,
} from '@bug-on/m3-expressive';
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

export function splitIntoMenuGroups(items: ContextMenuItem[]): ContextMenuItem[][] {
    const groups: ContextMenuItem[][] = [];
    let current: ContextMenuItem[] = [];

    for (const item of items) {
        if (item.divider) {
            if (current.length > 0) {
                groups.push(current);
                current = [];
            }
        } else {
            current.push(item);
        }
    }

    if (current.length > 0) {
        groups.push(current);
    }

    return groups;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const groups = splitIntoMenuGroups(items);

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

    return (
        <motion.div
            ref={menuRef}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={FAST_SPATIAL_SPRING}
            style={{ left: x, top: y }}
            className="fixed z-50 min-w-[200px] max-w-[280px] select-none origin-top-left focus:outline-none"
        >
            <VerticalMenu className="w-full min-w-[200px]">
                <VerticalMenuContent separatorStyle="gap" aria-label="Context menu">
                    {groups.map((group, groupIdx) => (
                        <VerticalMenuGroup key={groupIdx}>
                            {group.map((item, itemIdx) => (
                                <MenuItem
                                    key={`${groupIdx}-${itemIdx}-${item.label}`}
                                    leadingIcon={item.icon ? <Icon name={item.icon} size={18} /> : undefined}
                                    trailingText={item.shortcut}
                                    onClick={() => {
                                        item.action();
                                        onClose();
                                    }}
                                >
                                    {item.label}
                                </MenuItem>
                            ))}
                        </VerticalMenuGroup>
                    ))}
                </VerticalMenuContent>
            </VerticalMenu>
        </motion.div>
    );
};
