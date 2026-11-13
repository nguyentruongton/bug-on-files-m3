import React, { useRef, useState } from 'react';
import { Icon } from './Icon';
import { Breadcrumbs } from './Breadcrumbs';

interface OmnibarProps {
    currentPath: string;
    onNavigate: (path: string) => void;
    onSearch: (query: string) => void;
    defaultEditing?: boolean;
}

export const Omnibar: React.FC<OmnibarProps> = ({
    currentPath,
    onNavigate,
    onSearch,
    defaultEditing = false,
}) => {
    const [isEditing, setIsEditing] = useState(defaultEditing);
    const [inputVal, setInputVal] = useState(currentPath);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleContainerClick = () => {
        if (!isEditing) {
            setIsEditing(true);
            const isSpecial =
                currentPath.startsWith('app://') ||
                currentPath.startsWith('dashboard://') ||
                currentPath.startsWith('search://');
            setInputVal(isSpecial ? '' : currentPath);
            setTimeout(() => {
                inputRef.current?.focus();
                if (!isSpecial) {
                    inputRef.current?.select();
                }
            }, 10);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = inputVal.trim();
        if (!trimmed) {
            setIsEditing(false);
            return;
        }

        if (trimmed.startsWith('/') || trimmed.startsWith('~') || trimmed.includes('/')) {
            onNavigate(trimmed);
        } else {
            onSearch(trimmed);
        }
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setIsEditing(false);
            setInputVal(currentPath);
        }
    };

    return (
        <div
            onClick={handleContainerClick}
            className={`relative flex items-center h-10 flex-1 min-w-0 rounded-full px-3 transition-colors cursor-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-m3-primary ${
                isEditing
                    ? 'bg-m3-surface-container-highest'
                    : 'bg-m3-surface-container-high hover:bg-m3-surface-container-highest'
            }`}
        >
            <Icon
                name={isEditing ? 'search' : 'folder_open'}
                size={18}
                className="text-m3-on-surface-variant shrink-0 mr-2"
            />

            {isEditing ? (
                <form onSubmit={handleSubmit} className="flex-1 flex items-center min-w-0 gap-1">
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputVal}
                        onChange={(e) => setInputVal(e.target.value)}
                        onBlur={() => setIsEditing(false)}
                        onKeyDown={handleKeyDown}
                        placeholder="Enter path or search query..."
                        aria-label="Location or search"
                        className="w-full bg-transparent border-0 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-m3-primary rounded-sm text-sm text-m3-on-surface placeholder:text-m3-on-surface-variant/70"
                    />
                    {inputVal && (
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                setInputVal('');
                                inputRef.current?.focus();
                            }}
                            aria-label="Clear input"
                            className="inline-flex items-center justify-center w-6 h-6 rounded-full text-m3-on-surface-variant hover:bg-m3-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-m3-primary transition-colors shrink-0"
                        >
                            <Icon name="close" size={16} />
                        </button>
                    )}
                </form>
            ) : (
                <div className="flex-1 min-w-0 overflow-hidden flex items-center">
                    {currentPath.startsWith('app://dashboard') || currentPath === 'dashboard://' ? (
                        <span className="text-sm font-medium text-m3-on-surface truncate">
                            Home Dashboard
                        </span>
                    ) : currentPath.startsWith('search://') ? (
                        <span className="text-sm font-medium text-m3-primary truncate">
                            Search: &ldquo;{currentPath.replace('search://', '')}&rdquo;
                        </span>
                    ) : (
                        <div
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 min-w-0 overflow-hidden"
                        >
                            <Breadcrumbs currentPath={currentPath} onNavigate={onNavigate} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
