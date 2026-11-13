import React, { useEffect, useMemo, useState } from 'react';
import { Divider, List, ListItem, ScrollArea, TextField } from '@bug-on/m3-expressive';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import { api } from '../api';

export interface AppEntry {
    name: string;
    icon: string | null;
    exec: string;
}

interface OpenWithDialogProps {
    open: boolean;
    onClose: () => void;
    onSelect: (exec: string) => void;
    path: string;
    initialAllApps?: AppEntry[];
    initialRecommendedApps?: AppEntry[];
}

const noop = () => {};

export const OpenWithDialog: React.FC<OpenWithDialogProps> = ({
    open,
    onClose,
    onSelect,
    path,
    initialAllApps = [],
    initialRecommendedApps = [],
}) => {
    const [allApps, setAllApps] = useState<AppEntry[]>(initialAllApps);
    const [recommendedApps, setRecommendedApps] = useState<AppEntry[]>(initialRecommendedApps);
    const [search, setSearch] = useState('');
    const [selection, setSelection] = useState<{ key: string; app: AppEntry } | null>(null);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        api.getApps().then((apps) => {
            if (!cancelled) setAllApps(apps);
        });
        if (path) {
            api.getRecommendedApps(path).then((apps) => {
                if (!cancelled) setRecommendedApps(apps);
            });
        } else {
            Promise.resolve([]).then((apps) => {
                if (!cancelled) setRecommendedApps(apps);
            });
        }
        return () => {
            cancelled = true;
        };
    }, [open, path]);

    const filteredAllApps = useMemo(() => {
        return allApps.filter((app) =>
            app.name.toLowerCase().includes(search.toLowerCase())
        );
    }, [allApps, search]);

    const selectedAppKey = selection?.key ?? '';
    const selectedApp = selection?.app ?? null;

    const handleConfirm = () => {
        if (selectedApp) {
            onSelect(selectedApp.exec);
        }
    };

    const renderSectionItems = (apps: AppEntry[], prefix: 'rec' | 'all') =>
        apps.map((app, idx) => {
            const itemKey = `${prefix}:${idx}:${app.exec}`;
            return (
                <ListItem
                    key={itemKey}
                    value={itemKey}
                    selected={selectedAppKey === itemKey}
                    headline={app.name}
                    leadingType="custom"
                    leadingContent={
                        <div className="w-8 h-8 rounded-m3-sm bg-m3-surface-container-highest flex items-center justify-center shrink-0">
                            <Icon name="apps" size={20} />
                        </div>
                    }
                    onClick={() => setSelection({ key: itemKey, app })}
                    onDoubleClick={() => onSelect(app.exec)}
                />
            );
        });

    const showRecommended = recommendedApps.length > 0 && !search;

    return (
        <Dialog
            title="Open With..."
            icon={<Icon name="open_in_new" size={24} />}
            open={open}
            onClose={onClose}
            maxWidth="max-w-md"
            actions={
                <>
                    <Button onClick={onClose} variant="text">
                        Cancel
                    </Button>
                    <Button onClick={handleConfirm} variant="filled" disabled={!selectedApp}>
                        Open
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-3 h-[420px] w-full">
                <TextField
                    variant="outlined"
                    label="Search applications"
                    placeholder="Type app name..."
                    value={search}
                    onChange={(val) => setSearch(val)}
                    fullWidth
                    leadingIcon={<Icon name="search" size={18} />}
                    trailingIconMode={search ? 'clear' : 'none'}
                />

                <ScrollArea className="flex-1 min-h-0 pr-1" type="hover">
                    <div className="flex flex-col gap-1">
                        {showRecommended && (
                            <>
                                <div className="text-xs font-semibold text-m3-primary px-3 pt-1 pb-0.5">
                                    Recommended
                                </div>
                                <List
                                    variant="expressive"
                                    listStyle="segmented"
                                    selectionMode="single-select"
                                    value={selectedAppKey}
                                    onChange={noop}
                                    aria-label="Recommended applications"
                                >
                                    {renderSectionItems(recommendedApps, 'rec')}
                                </List>
                                <Divider className="my-2" />
                                <div className="text-xs font-semibold text-m3-primary px-3 pb-0.5">
                                    All Applications
                                </div>
                            </>
                        )}
                        <List
                            variant="expressive"
                            listStyle="segmented"
                            selectionMode="single-select"
                            value={selectedAppKey}
                            onChange={noop}
                            aria-label="All applications"
                        >
                            {renderSectionItems(filteredAllApps, 'all')}
                        </List>
                    </div>
                </ScrollArea>
            </div>
        </Dialog>
    );
};
