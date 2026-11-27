import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
    Divider,
    FAST_SPATIAL_SPRING,
    NavigationDrawer,
    NavigationDrawerContent,
    NavigationDrawerItem,
    NavigationDrawerSectionHeader,
    ScrollArea,
} from '@bug-on/m3-expressive';
import { Icon } from './Icon';
import { normalizePath, getActiveDriveMountpoint } from '../utils/navigationHistory';
import type { ResolvedDropTarget } from '../utils/dropTargetUtils';
import { api } from '../api';

const DROP_OVERLAY_CLASS =
    'pointer-events-none absolute inset-0 z-20 rounded-full ring-2 ring-inset ring-m3-primary bg-m3-primary-container/35';

function SidebarDropOverlay({ active }: { active: boolean }) {
    if (!active) return null;
    return <div aria-hidden="true" className={DROP_OVERLAY_CLASS} />;
}

interface Place {
    name: string;
    path: string;
    icon: string;
}

interface SidebarProps {
    onNavigate: (path: string) => void;
    currentPath: string;
    collapsed?: boolean;
    activeDropTarget?: ResolvedDropTarget | null;
    initialPlaces?: Place[];
    initialDrives?: Drive[];
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
    activeDropTarget = null,
    initialPlaces = [],
    initialDrives = [],
}) => {
    const [places, setPlaces] = useState<Place[]>(initialPlaces);
    const [drives, setDrives] = useState<Drive[]>(initialDrives);

    useEffect(() => {
        if (!api?.getPlaces) return;
        api.getPlaces()
            .then((res) => {
                if (res) setPlaces(res);
            })
            .catch(console.error);
    }, []);

    useEffect(() => {
        if (collapsed || !api?.getDrives) return;

        let cancelled = false;
        const fetchDrives = () => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
                return;
            }
            api.getDrives()
                .then((res) => {
                    if (!cancelled && res) setDrives(res);
                })
                .catch(console.error);
        };

        fetchDrives();
        const interval = window.setInterval(fetchDrives, 5000);
        window.addEventListener('focus', fetchDrives);
        document.addEventListener('visibilitychange', fetchDrives);

        return () => {
            cancelled = true;
            window.clearInterval(interval);
            window.removeEventListener('focus', fetchDrives);
            document.removeEventListener('visibilitychange', fetchDrives);
        };
    }, [collapsed]);

    const normCurrent = normalizePath(currentPath);
    const activeMountpoint = getActiveDriveMountpoint(
        normCurrent,
        drives.map((d) => d.mountpoint),
    );
    const activeSidebarDropPath =
        activeDropTarget?.kind === 'folder' && activeDropTarget.source === 'sidebar'
            ? normalizePath(activeDropTarget.path)
            : null;
    const isTrashDropActive = activeDropTarget?.kind === 'trash';
    const isComputerDropActive = activeSidebarDropPath === '/';

    return (
        <motion.aside
            initial={false}
            animate={{
                width: collapsed ? 0 : 244,
                opacity: collapsed ? 0 : 1,
                marginLeft: collapsed ? 0 : 8,
                marginRight: collapsed ? 0 : 8,
            }}
            transition={FAST_SPATIAL_SPRING}
            aria-hidden={collapsed}
            className="box-border h-full shrink-0 pt-1.5 pb-2 overflow-hidden select-none"
        >
            <NavigationDrawer
                variant="standard"
                width={244}
                className="shell-panel h-full bg-m3-surface-container-low rounded-3xl! border-0"
                aria-label="Places and devices"
            >
                <div data-drop-sidebar="true" className="flex-1 min-h-0 h-full">
                    <ScrollArea
                        className="h-full"
                        type="hover"
                        viewportProps={{ 'data-drop-scroll-container': 'true' } as React.HTMLAttributes<HTMLDivElement>}
                    >
                        <NavigationDrawerContent className="px-2 py-3">
                            <NavigationDrawerSectionHeader className="text-m3-on-surface-variant">
                                Places
                            </NavigationDrawerSectionHeader>
                            {places.map((place) => {
                                const isSelected = normalizePath(place.path) === normCurrent;
                                const isPlaceDropActive =
                                    activeSidebarDropPath !== null &&
                                    normalizePath(place.path) === activeSidebarDropPath;
                                return (
                                    <div
                                        key={place.path}
                                        data-drop-folder-path={place.path}
                                        data-drop-active={isPlaceDropActive ? 'true' : undefined}
                                        className="relative"
                                    >
                                        <NavigationDrawerItem
                                            selected={isSelected}
                                            shape="pill"
                                            icon={<Icon name={getPlaceIconName(place.name)} size={20} fill={isSelected ? 1 : 0} animateFill />}
                                            label={place.name}
                                            onClick={() => onNavigate(place.path)}
                                        />
                                        <SidebarDropOverlay active={isPlaceDropActive} />
                                    </div>
                                );
                            })}
                            <div
                                data-drop-trash="true"
                                data-drop-active={isTrashDropActive ? 'true' : undefined}
                                className="relative"
                            >
                                <NavigationDrawerItem
                                    selected={normCurrent === 'app://trash'}
                                    shape="pill"
                                    icon={<Icon name="delete" size={20} fill={normCurrent === 'app://trash' ? 1 : 0} animateFill />}
                                    label="Trash"
                                    onClick={() => onNavigate('app://trash')}
                                />
                                <SidebarDropOverlay active={isTrashDropActive} />
                            </div>

                            <Divider shape='wavy' className="my-2" />

                            <NavigationDrawerSectionHeader className="text-m3-on-surface-variant">
                                Devices
                            </NavigationDrawerSectionHeader>
                            {drives.map((drive) => {
                                const isSelected =
                                    !!activeMountpoint &&
                                    normalizePath(drive.mountpoint) === activeMountpoint;
                                const isDriveDropActive =
                                    activeSidebarDropPath !== null &&
                                    normalizePath(drive.mountpoint) === activeSidebarDropPath;
                                const iconName = drive.usb
                                    ? 'usb'
                                    : drive.mountpoint === '/'
                                        ? 'hard_drive'
                                        : 'sd_storage';
                                const label = drive.label || (drive.mountpoint === '/' ? 'System' : drive.name);
                                return (
                                    <div
                                        key={drive.mountpoint}
                                        data-drop-folder-path={drive.mountpoint}
                                        data-drop-active={isDriveDropActive ? 'true' : undefined}
                                        className="relative"
                                    >
                                        <NavigationDrawerItem
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
                                        <SidebarDropOverlay active={isDriveDropActive} />
                                    </div>
                                );
                            })}

                            {drives.length === 0 && (
                                <div
                                    data-drop-folder-path="/"
                                    data-drop-active={isComputerDropActive ? 'true' : undefined}
                                    className="relative"
                                >
                                    <NavigationDrawerItem
                                        selected={normCurrent === '/'}
                                        shape="pill"
                                        icon={<Icon name="hard_drive" size={20} fill={normCurrent === '/' ? 1 : 0} animateFill />}
                                        label="Computer"
                                        onClick={() => onNavigate('/')}
                                    />
                                    <SidebarDropOverlay active={isComputerDropActive} />
                                </div>
                            )}
                        </NavigationDrawerContent>
                    </ScrollArea>
                </div>
            </NavigationDrawer>
        </motion.aside>
    );
};
