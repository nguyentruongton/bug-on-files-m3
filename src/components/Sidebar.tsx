import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
    FAST_SPATIAL_SPRING,
    NavigationDrawer,
    NavigationDrawerContent,
    NavigationDrawerDivider,
    NavigationDrawerItem,
    NavigationDrawerSectionHeader,
    ScrollArea,
} from '@bug-on/m3-expressive';
import { Icon } from './Icon';
import { normalizePath, getActiveDriveMountpoint } from '../utils/navigationHistory';
import { api } from '../api';

interface Place {
    name: string;
    path: string;
    icon: string;
}

interface SidebarProps {
    onNavigate: (path: string) => void;
    currentPath: string;
    collapsed?: boolean;
}

interface Drive {
    name: string;
    label: string;
    mountpoint: string;
    size: string;
    type: string;
    removable: boolean;
    usb: boolean;
}

const getPlaceIconName = (name: string): string => {
    switch (name) {
        case 'Home': return 'home';
        case 'Desktop': return 'desktop_windows';
        case 'Documents': return 'description';
        case 'Downloads': return 'download';
        case 'Music': return 'music_note';
        case 'Pictures': return 'image';
        case 'Videos': return 'movie';
        default: return 'folder';
    }
};

export const Sidebar: React.FC<SidebarProps> = ({
    onNavigate,
    currentPath,
    collapsed = false,
}) => {
    const [places, setPlaces] = useState<Place[]>([]);
    const [drives, setDrives] = useState<Drive[]>([]);

    useEffect(() => {
        if (!api) return;

        if (api.getPlaces) {
            api.getPlaces()
                .then((res) => {
                    if (res) setPlaces(res);
                })
                .catch(console.error);
        }

        const fetchDrives = () => {
            if (api.getDrives) {
                api.getDrives()
                    .then((res) => {
                        if (res) setDrives(res);
                    })
                    .catch(console.error);
            }
        };

        fetchDrives();
        const interval = setInterval(fetchDrives, 5000);
        return () => clearInterval(interval);
    }, []);

    const normCurrent = normalizePath(currentPath);
    const activeMountpoint = getActiveDriveMountpoint(
        normCurrent,
        drives.map((d) => d.mountpoint),
    );

    return (
        <motion.aside
            initial={false}
            animate={{
                width: collapsed ? 0 : 244,
                opacity: collapsed ? 0 : 1,
            }}
            transition={FAST_SPATIAL_SPRING}
            aria-hidden={collapsed}
            className="h-full shrink-0 overflow-hidden select-none"
        >
            <NavigationDrawer
                variant="standard"
                width={244}
                className="shell-panel h-full bg-m3-surface-container-low !rounded-[24px] border-0"
                aria-label="Places and devices"
            >
                <ScrollArea className="h-full" type="hover">
                    <NavigationDrawerContent className="px-2 py-3">
                        <NavigationDrawerSectionHeader className="text-m3-on-surface-variant">
                            Places
                        </NavigationDrawerSectionHeader>
                        {places.map((place) => {
                            const isSelected = normalizePath(place.path) === normCurrent;
                            return (
                                <NavigationDrawerItem
                                    key={place.path}
                                    selected={isSelected}
                                    shape="pill"
                                    icon={<Icon name={getPlaceIconName(place.name)} size={20} fill={isSelected ? 1 : 0} animateFill />}
                                    label={place.name}
                                    onClick={() => onNavigate(place.path)}
                                />
                            );
                        })}
                        <NavigationDrawerItem
                            key="app://trash"
                            selected={normCurrent === 'app://trash'}
                            shape="pill"
                            icon={<Icon name="delete" size={20} fill={normCurrent === 'app://trash' ? 1 : 0} animateFill />}
                            label="Trash"
                            onClick={() => onNavigate('app://trash')}
                        />

                        <NavigationDrawerDivider className="my-2" />

                        <NavigationDrawerSectionHeader className="text-m3-on-surface-variant">
                            Devices
                        </NavigationDrawerSectionHeader>
                        {drives.map((drive) => {
                            const isSelected =
                                !!activeMountpoint &&
                                normalizePath(drive.mountpoint) === activeMountpoint;
                            const iconName = drive.usb
                                ? 'usb'
                                : drive.mountpoint === '/'
                                    ? 'hard_drive'
                                    : 'sd_storage';
                            const label = drive.label || (drive.mountpoint === '/' ? 'System' : drive.name);
                            return (
                                <NavigationDrawerItem
                                    key={drive.mountpoint}
                                    selected={isSelected}
                                    shape="pill"
                                    icon={<Icon name={iconName} size={20} fill={isSelected ? 1 : 0} animateFill />}
                                    label={label}
                                    badge={
                                        <span className="text-[11px] font-medium text-m3-on-surface-variant">
                                            {drive.size}
                                        </span>
                                    }
                                    onClick={() => onNavigate(drive.mountpoint)}
                                />
                            );
                        })}

                        {drives.length === 0 && (
                            <NavigationDrawerItem
                                selected={normCurrent === '/'}
                                shape="pill"
                                icon={<Icon name="hard_drive" size={20} fill={normCurrent === '/' ? 1 : 0} animateFill />}
                                label="Computer"
                                onClick={() => onNavigate('/')}
                            />
                        )}
                    </NavigationDrawerContent>
                </ScrollArea>
            </NavigationDrawer>
        </motion.aside>
    );
};
