import React from 'react';
import { Tabs, TabsList, Tab as M3Tab } from '@bug-on/m3-expressive';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

export interface Tab {
    id: string;
    path: string;
    title: string;
}

interface TabBarProps {
    tabs: Tab[];
    activeTabId: string;
    onTabClick: (id: string) => void;
    onTabClose: (id: string) => void;
    onNewTab: () => void;
}

const getTabIconName = (path: string): string => {
    if (path.startsWith('app://dashboard') || path === 'dashboard://') return 'dashboard';
    if (path.startsWith('search://')) return 'search';
    if (path === '/') return 'hard_drive';
    if (path.endsWith('/Home') || path.split('/').filter(Boolean).length === 2) return 'home';
    return 'folder';
};

export const TabBar: React.FC<TabBarProps> = ({
    tabs,
    activeTabId,
    onTabClick,
    onTabClose,
    onNewTab,
}) => {
    return (
        <div className="flex items-center gap-1 px-3 pt-1.5 border-b border-m3-outline-variant/40 bg-m3-surface-container-low select-none">
            <Tabs
                value={activeTabId}
                onValueChange={onTabClick}
                className="flex-1 min-w-0"
            >
                <TabsList
                    variant="secondary"
                    scrollable
                    backgroundColor="transparent"
                    aria-label="Open tabs"
                    className="!px-0 !gap-1"
                >
                    {tabs.map((tab) => {
                        const isActive = tab.id === activeTabId;
                        const canClose = tabs.length > 1;
                        return (
                            <div
                                key={tab.id}
                                className="relative flex items-center shrink-0 group max-w-[220px]"
                                onMouseDown={(e) => {
                                    if (e.button === 1 && canClose) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onTabClose(tab.id);
                                    }
                                }}
                            >
                                <M3Tab
                                    value={tab.id}
                                    inlineIcon
                                    icon={
                                        <Icon
                                            name={getTabIconName(tab.path)}
                                            size={16}
                                            filled={isActive}
                                        />
                                    }
                                    className={`!h-10 !min-w-[112px] !max-w-[220px] !px-3 rounded-t-m3-md transition-colors ${
                                        canClose ? '!pr-8' : ''
                                    } ${
                                        isActive
                                            ? 'text-m3-primary font-medium'
                                            : 'text-m3-on-surface-variant'
                                    }`}
                                >
                                    <span className="truncate max-w-[136px] block text-left">
                                        {tab.title}
                                    </span>
                                </M3Tab>
                                {canClose && (
                                    <IconButton
                                        size="xs"
                                        aria-label={`Close ${tab.title}`}
                                        title="Close tab"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onTabClose(tab.id);
                                        }}
                                        className="absolute right-1 top-1/2 -translate-y-1/2 z-10 !w-6 !h-6 !min-w-0 !min-h-0 opacity-60 group-hover:opacity-100 hover:bg-m3-surface-container-highest"
                                    >
                                        <Icon name="close" size={14} />
                                    </IconButton>
                                )}
                            </div>
                        );
                    })}
                </TabsList>
            </Tabs>

            <IconButton
                size="xs"
                onClick={onNewTab}
                aria-label="New tab"
                title="New tab (Ctrl+T)"
                className="shrink-0 mb-1"
            >
                <Icon name="add" size={18} />
            </IconButton>
        </div>
    );
};
