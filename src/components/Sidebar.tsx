import React, { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { normalizePath, getActiveDriveMountpoint } from '../utils/navigationHistory';
import { api } from '../api';
import './Sidebar.css';

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

export const Sidebar: React.FC<SidebarProps> = ({ onNavigate, currentPath, collapsed = false }) => {
    const [places, setPlaces] = useState<Place[]>([]);
    const [drives, setDrives] = useState<Drive[]>([]);

    useEffect(() => {
        if (api) {
            if (api.getPlaces) {
                api.getPlaces().then(setPlaces);
            }

            const fetchDrives = async () => {
                if (api.getDrives) {
                    const d = await api.getDrives();
                    setDrives(d);
                }
            };

            fetchDrives();
            const interval = setInterval(fetchDrives, 5000);
            return () => clearInterval(interval);
        }
    }, []);

    const normalizedCurrent = normalizePath(currentPath);
    const activeMountpoint = getActiveDriveMountpoint(
        currentPath,
        drives.map((d) => d.mountpoint)
    );

    return (
        <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`} aria-hidden={collapsed}>
            <div className="sidebar-section">
                <h3 className="sidebar-title">Places</h3>
                <div className="sidebar-list">
                    {places.map((place) => {
                        const isActive = normalizedCurrent === normalizePath(place.path);
                        return (
                            <button
                                key={`${place.name}:${place.path}`}
                                className={`sidebar-item ${isActive ? 'active' : ''}`}
                                onClick={() => onNavigate(place.path)}
                                title={place.path}
                            >
                                <Icon name={getPlaceIcon(place.name)} className="sidebar-icon" filled={isActive} />
                                <span className="sidebar-label">{place.name}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {drives.length > 0 && (
                <div className="sidebar-section">
                    <h3 className="sidebar-title">Devices</h3>
                    <div className="sidebar-list">
                        {drives.map((drive) => {
                            const isActive = activeMountpoint !== null && normalizePath(drive.mountpoint) === normalizePath(activeMountpoint);
                            return (
                                <button
                                    key={`${drive.name}:${drive.mountpoint}`}
                                    className={`sidebar-item ${isActive ? 'active' : ''}`}
                                    onClick={() => onNavigate(drive.mountpoint)}
                                    title={`${drive.label || drive.name} (${drive.mountpoint})`}
                                >
                                    <Icon name={drive.usb ? 'usb' : 'hard_drive'} className="sidebar-icon" filled={isActive} />
                                    <span className="sidebar-label">{drive.label || drive.name}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </aside>
    );
};

function getPlaceIcon(name: string): string {
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
}
