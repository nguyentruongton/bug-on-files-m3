import React, { useEffect, useMemo, useState } from 'react';
import { ScrollArea, TextField } from '@bug-on/m3-expressive';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import { api } from '../api';

interface OpenWithDialogProps {
    open: boolean;
    onClose: () => void;
    onSelect: (exec: string) => void;
}

interface AppEntry {
    name: string;
    icon: string | null;
    exec: string;
}

export const OpenWithDialog: React.FC<OpenWithDialogProps & { path: string }> = ({
    open,
    onClose,
    onSelect,
    path,
}) => {
    const [allApps, setAllApps] = useState<AppEntry[]>([]);
    const [recommendedApps, setRecommendedApps] = useState<AppEntry[]>([]);
    const [search, setSearch] = useState('');
    const [selectedApp, setSelectedApp] = useState<AppEntry | null>(null);

    useEffect(() => {
        if (open) {
            api.getApps().then(setAllApps);
            if (path) {
                api.getRecommendedApps(path).then(setRecommendedApps);
            } else {
                setRecommendedApps([]);
            }
        }
    }, [open, path]);

    const filteredAllApps = useMemo(() => {
        return allApps.filter((app) =>
            app.name.toLowerCase().includes(search.toLowerCase()),
        );
    }, [allApps, search]);

    const handleConfirm = () => {
        if (selectedApp) {
            onSelect(selectedApp.exec);
        }
    };

    const renderAppItem = (app: AppEntry, idx: number) => {
        const isSelected = selectedApp === app;
        return (
            <button
                key={`${app.name}-${idx}`}
                type="button"
                onClick={() => setSelectedApp(app)}
                onDoubleClick={() => onSelect(app.exec)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-m3-md text-left transition-colors cursor-pointer ${
                    isSelected
                        ? 'bg-m3-secondary-container text-m3-on-secondary-container'
                        : 'hover:bg-m3-surface-container-highest text-m3-on-surface'
                }`}
            >
                <div className="w-8 h-8 rounded-m3-sm bg-m3-surface-container-highest flex items-center justify-center shrink-0">
                    <Icon name="apps" size={20} />
                </div>
                <span className="font-medium text-sm truncate">{app.name}</span>
            </button>
        );
    };

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
                        {recommendedApps.length > 0 && !search && (
                            <>
                                <div className="text-xs font-semibold text-m3-primary px-3 pt-1 pb-0.5">
                                    Recommended
                                </div>
                                {recommendedApps.map((app, idx) => renderAppItem(app, idx))}
                                <div className="h-px bg-m3-outline-variant/50 my-2" />
                                <div className="text-xs font-semibold text-m3-primary px-3 pb-0.5">
                                    All Applications
                                </div>
                            </>
                        )}
                        {filteredAllApps.map((app, idx) => renderAppItem(app, idx))}
                    </div>
                </ScrollArea>
            </div>
        </Dialog>
    );
};
