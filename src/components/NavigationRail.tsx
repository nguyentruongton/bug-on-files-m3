import React from 'react';
import {
    NavigationRail as M3NavigationRail,
    NavigationRailItem,
} from '@bug-on/m3-expressive';

export interface NavigationItem {
    id: string;
    label: string;
    icon: React.ReactNode;
    activeIcon?: React.ReactNode;
    isActive: boolean;
    onClick: () => void;
    badge?: React.ReactNode;
}

interface NavigationRailProps {
    items: NavigationItem[];
    fab?: React.ReactNode;
    headerAction?: React.ReactNode;
}

export const NavigationRail: React.FC<NavigationRailProps> = ({
    items,
    fab,
    headerAction,
}) => {
    return (
        <M3NavigationRail
            variant="collapsed"
            shape="pill"
            alignment="top"
            narrow
            header={headerAction}
            fab={fab}
            className="h-full shrink-0 bg-m3-surface border-0 select-none"
        >
            {items.map((item) => (
                <NavigationRailItem
                    key={item.id}
                    selected={item.isActive}
                    icon={item.icon}
                    activeIcon={item.activeIcon}
                    label={item.label}
                    badge={item.badge}
                    onClick={item.onClick}
                    shape="pill"
                />
            ))}
        </M3NavigationRail>
    );
};
