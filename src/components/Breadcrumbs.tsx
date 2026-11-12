import React from 'react';
import { Icon } from './Icon';

interface BreadcrumbsProps {
    currentPath: string;
    onNavigate: (path: string) => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ currentPath, onNavigate }) => {
    const parts = currentPath.split('/').filter(Boolean);

    const handleSegmentClick = (index: number) => {
        const target = '/' + parts.slice(0, index + 1).join('/');
        onNavigate(target);
    };

    return (
        <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-0.5 overflow-x-auto no-scrollbar py-0.5 text-sm select-none"
        >
            <button
                type="button"
                onClick={() => onNavigate('/')}
                title="Root (/)"
                aria-label="Root directory"
                className="inline-flex items-center justify-center w-7 h-7 rounded-full text-m3-on-surface-variant hover:bg-m3-surface-container-highest hover:text-m3-on-surface transition-colors shrink-0"
            >
                <Icon name="home" size={18} />
            </button>

            {parts.map((part, index) => {
                const isLast = index === parts.length - 1;
                return (
                    <React.Fragment key={`${part}-${index}`}>
                        <Icon
                            name="chevron_right"
                            size={16}
                            className="text-m3-on-surface-variant/60 shrink-0"
                        />
                        <button
                            type="button"
                            onClick={() => handleSegmentClick(index)}
                            className={`px-2.5 py-1 rounded-full text-xs sm:text-sm truncate max-w-[180px] transition-colors shrink-0 ${
                                isLast
                                    ? 'bg-m3-secondary-container text-m3-on-secondary-container font-medium'
                                    : 'text-m3-on-surface-variant hover:bg-m3-surface-container-highest hover:text-m3-on-surface'
                            }`}
                            title={part}
                        >
                            {part}
                        </button>
                    </React.Fragment>
                );
            })}
        </nav>
    );
};
