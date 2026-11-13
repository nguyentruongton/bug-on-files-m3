import React, { useEffect, useRef } from 'react';
import { Button, ButtonGroup } from '@bug-on/m3-expressive';
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
    const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

    useEffect(() => {
        const activeEl = tabRefs.current.get(activeTabId);
        if (activeEl && typeof activeEl.scrollIntoView === 'function') {
            activeEl.scrollIntoView({
                behavior: 'smooth',
                inline: 'nearest',
                block: 'nearest',
            });
        }
    }, [activeTabId]);

    const handleTabListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (tabs.length === 0) return;

        const target = e.target as HTMLElement | null;
        const isCloseButton = Boolean(target?.closest('button'));
        if ((e.key === 'Enter' || e.key === ' ') && isCloseButton) {
            return;
        }

        const tabEl = target?.closest('[role="tab"]') as HTMLElement | null;
        const currentIdx = tabEl?.dataset.tabId
            ? tabs.findIndex((t) => t.id === tabEl.dataset.tabId)
            : tabs.findIndex((t) => t.id === activeTabId);
        const safeIdx = currentIdx >= 0 ? currentIdx : 0;

        if (e.key === 'ArrowRight') {
            e.preventDefault();
            const nextTab = tabs[(safeIdx + 1) % tabs.length];
            tabRefs.current.get(nextTab.id)?.focus();
            onTabClick(nextTab.id);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            const prevTab = tabs[(safeIdx - 1 + tabs.length) % tabs.length];
            tabRefs.current.get(prevTab.id)?.focus();
            onTabClick(prevTab.id);
        } else if (e.key === 'Home') {
            e.preventDefault();
            const firstTab = tabs[0];
            tabRefs.current.get(firstTab.id)?.focus();
            onTabClick(firstTab.id);
        } else if (e.key === 'End') {
            e.preventDefault();
            const lastTab = tabs[tabs.length - 1];
            tabRefs.current.get(lastTab.id)?.focus();
            onTabClick(lastTab.id);
        } else if ((e.key === 'Enter' || e.key === ' ') && tabEl?.dataset.tabId && !e.defaultPrevented) {
            e.preventDefault();
            onTabClick(tabEl.dataset.tabId);
        }
    };

    const canClose = tabs.length > 1;

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-m3-surface-container select-none">
            <div
                role="tablist"
                aria-label="Open tabs"
                onKeyDown={handleTabListKeyDown}
                className="flex-1 min-w-0 overflow-x-auto rounded-m3-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                <ButtonGroup variant="connected" size="sm" className="w-max overflow-visible">
                    {tabs.map((tab) => {
                        const isActive = tab.id === activeTabId;
                        return (
                            <Button
                                key={tab.id}
                                ref={(el) => {
                                    if (el) {
                                        tabRefs.current.set(tab.id, el);
                                    } else {
                                        tabRefs.current.delete(tab.id);
                                    }
                                }}
                                variant="toggle"
                                size="sm"
                                selected={isActive}
                                colorStyle="tonal"
                                role="tab"
                                data-tab-id={tab.id}
                                aria-selected={isActive}
                                aria-label={tab.title}
                                tabIndex={isActive ? 0 : -1}
                                onClick={() => onTabClick(tab.id)}
                                onMouseDown={(e) => {
                                    if (e.button === 1 && canClose) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onTabClose(tab.id);
                                    }
                                }}
                                className={`min-w-[120px] max-w-[220px] [&>span]:w-full [&>span]:min-w-0 !px-3 ${
                                    isActive
                                        ? '!bg-m3-secondary-container !text-m3-on-secondary-container font-medium'
                                        : '!bg-m3-surface-container-high !text-m3-on-surface-variant hover:!bg-m3-surface-container-highest'
                                }`}
                            >
                                <span className="flex items-center gap-1.5 w-full min-w-0 justify-between">
                                    <span className="flex items-center gap-1.5 min-w-0 flex-1 truncate text-left">
                                        <Icon
                                            name={getTabIconName(tab.path)}
                                            size={16}
                                            filled={isActive}
                                            className="shrink-0"
                                        />
                                        <span className="truncate">{tab.title}</span>
                                    </span>
                                    {canClose && (
                                        <span
                                            role="button"
                                            tabIndex={-1}
                                            aria-label={`Close ${tab.title}`}
                                            title="Close tab"
                                            onPointerDown={(e) => {
                                                e.stopPropagation();
                                            }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onTabClose(tab.id);
                                            }}
                                            className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-m3-full opacity-70 hover:opacity-100 hover:bg-m3-surface-container-highest cursor-pointer"
                                        >
                                            <Icon name="close" size={14} />
                                        </span>
                                    )}
                                </span>
                            </Button>
                        );
                    })}
                </ButtonGroup>
            </div>

            <IconButton
                size="xs"
                onClick={onNewTab}
                aria-label="New tab"
                title="New tab (Ctrl+T)"
                className="shrink-0"
            >
                <Icon name="add" size={18} />
            </IconButton>
        </div>
    );
};
