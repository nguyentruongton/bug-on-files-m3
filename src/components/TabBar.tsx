import React, { useEffect, useRef } from 'react';
import { Button, ButtonGroup } from '@bug-on/m3-expressive';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import type { ResolvedDropTarget } from '../utils/dropTargetUtils';
import { normalizePath } from '../utils/navigationHistory';

export interface Tab {
    id: string;
    path: string;
    title: string;
    pinned?: boolean;
}

interface TabBarProps {
    tabs: Tab[];
    activeTabId: string;
    onTabClick: (id: string) => void;
    onTabClose: (id: string) => void;
    onNewTab: () => void;
    onTabContextMenu?: (e: React.MouseEvent, tab: Tab) => void;
    onTabBarContextMenu?: (e: React.MouseEvent) => void;
    activeDropTarget?: ResolvedDropTarget | null;
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
    onTabContextMenu,
    onTabBarContextMenu,
    activeDropTarget = null,
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
        <div
            onContextMenu={(e) => {
                e.preventDefault();
                onTabBarContextMenu?.(e);
            }}
            className="flex items-center gap-2 px-3 py-1.5 bg-m3-surface-container select-none"
        >
            <div
                role="tablist"
                aria-label="Open tabs"
                onKeyDown={handleTabListKeyDown}
                className="flex-1 min-w-0 overflow-x-auto rounded-m3-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                <ButtonGroup variant="connected" size="sm" className="w-max overflow-visible">
                    {tabs.map((tab) => {
                        const isActive = tab.id === activeTabId;
                        const isDropActive = Boolean(
                            activeDropTarget &&
                            ((activeDropTarget.kind === 'tab' && activeDropTarget.tabId === tab.id) ||
                                (activeDropTarget.kind === 'trash' && normalizePath(tab.path) === 'app://trash'))
                        );
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
                                icon={
                                    <Icon
                                        name={getTabIconName(tab.path)}
                                        size={16}
                                        fill={isActive ? 1 : 0}
                                        animateFill
                                    />
                                }
                                iconPosition="leading"
                                role="tab"
                                data-tab-id={tab.id}
                                data-drop-tab-id={tab.id}
                                data-drop-active={isDropActive ? 'true' : undefined}
                                aria-selected={isActive}
                                aria-label={tab.title}
                                tabIndex={isActive ? 0 : -1}
                                onClick={() => onTabClick(tab.id)}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onTabContextMenu?.(e, tab);
                                }}
                                onMouseDown={(e) => {
                                    if (e.button === 1 && canClose && !tab.pinned) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onTabClose(tab.id);
                                    }
                                }}
                                className={`min-w-[120px] max-w-[220px] [&>span]:w-full [&>span]:min-w-0 pl-2! pr-1.5! ${
                                    isDropActive ? 'ring-2 ring-inset ring-m3-primary bg-m3-primary-container/35' : ''
                                }`}
                            >
                                <span className="flex items-center gap-1.5 w-full min-w-0 justify-between">
                                    <span className="truncate flex-1 text-left">{tab.title}</span>
                                    {tab.pinned ? (
                                        <span
                                            aria-label={`${tab.title} pinned`}
                                            title="Pinned tab"
                                            className="shrink-0 inline-flex items-center justify-center w-5 h-5"
                                        >
                                            <Icon name="keep" size={16} />
                                        </span>
                                    ) : canClose ? (
                                        <IconButton
                                            role="button"
                                            tabIndex={-1}
                                            colorStyle='tonal'
                                            aria-label={`Close ${tab.title}`}
                                            size='xs'
                                            title="Close tab"
                                            onPointerDown={(e) => {
                                                e.stopPropagation();
                                            }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onTabClose(tab.id);
                                            }}
                                            className={isActive ? "hover:bg-m3-surface-container-highest active:bg-m3-surface-container-highest" : "hover:bg-m3-surface-container"}
                                        >
                                            <Icon name="close" size={16} />
                                        </IconButton>
                                    ) : null}
                                </span>
                            </Button>
                        );
                    })}
                </ButtonGroup>
            </div>

            <IconButton
                size="sm"
                colorStyle='standard'
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
