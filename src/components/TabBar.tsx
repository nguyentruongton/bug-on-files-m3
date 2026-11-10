import React from 'react';
import { Icon } from './Icon';
import './TabBar.css';

interface Tab {
    id: string;
    title: string;
    path?: string;
}

interface TabBarProps {
    tabs: Tab[];
    activeTabId: string;
    onTabClick: (id: string) => void;
    onTabClose: (id: string) => void;
    onNewTab: () => void;
}

function getTabIcon(tab: Tab): string {
    if (tab.path === 'app://dashboard' || tab.title === 'Dashboard') {
        return 'dashboard';
    }
    if (tab.title === 'Home' || (tab.path && /^\/home\/[^/]+\/?$/.test(tab.path))) {
        return 'home';
    }
    return 'folder';
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, activeTabId, onTabClick, onTabClose, onNewTab }) => {
    return (
        <div className="tab-bar" role="tablist">
            {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                    <div
                        key={tab.id}
                        role="tab"
                        aria-selected={isActive}
                        title={tab.path === 'app://dashboard' ? 'Dashboard' : (tab.path || tab.title)}
                        className={`tab-item ${isActive ? 'active' : ''}`}
                        onClick={() => onTabClick(tab.id)}
                        onAuxClick={(e) => {
                            if (e.button === 1) {
                                e.preventDefault();
                                e.stopPropagation();
                                onTabClose(tab.id);
                            }
                        }}
                    >
                        <Icon name={getTabIcon(tab)} filled={isActive} className="tab-leading-icon" />
                        <span className="tab-title">{tab.title}</span>
                        <button
                            type="button"
                            className="tab-close-btn"
                            title="Close Tab"
                            onClick={(e) => {
                                e.stopPropagation();
                                onTabClose(tab.id);
                            }}
                        >
                            <Icon name="close" style={{ fontSize: '15px' }} />
                        </button>
                    </div>
                );
            })}
            <button type="button" className="new-tab-btn" onClick={onNewTab} title="New Tab">
                <Icon name="add" style={{ fontSize: '20px' }} />
            </button>
        </div>
    );
};
