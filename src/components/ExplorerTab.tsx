import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useToast } from '../contexts/ToastContext';
import { useClipboard } from '../contexts/ClipboardContext';
import { StatusBar } from './StatusBar';
import { FileList } from './FileList';
import { FileListSkeleton } from './FileListSkeleton';
import { IconButton } from './IconButton';
import { Icon } from './Icon';
import { FileSystemService } from '../services/FileSystemService';
import type { IFile } from '../types/files';

import { Omnibar } from './Omnibar';
import { Dashboard } from './Dashboard';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useDirWatch } from '../hooks/useDirWatch';
import { getSemanticGroup, GROUP_ORDER, isHiddenFile } from '../utils/fileUtils';
import {
    createHistory,
    pushHistory,
    stepBack,
    stepForward,
    type HistoryState,
} from '../utils/navigationHistory';

interface ExplorerTabProps {
    tabId: string;
    isActive: boolean;
    initialPath: string;
    refreshTrigger?: number;
    onPathChange: (id: string, path: string) => void;
    onContextMenu: (e: React.MouseEvent, file: IFile | null, selectedFiles: IFile[]) => void;
    onCreateFolderRequest?: () => void;
    onPasteRequest?: (destDir: string) => void;
    showHiddenFiles: boolean;
    onToggleHiddenFiles?: () => void;
    iconSize: number;
    viewMode: 'grid' | 'list';
    onViewModeChange?: (mode: 'grid' | 'list') => void;
    filledIcons: boolean;
}

export function ExplorerTab({
    tabId,
    isActive,
    initialPath,
    refreshTrigger = 0,
    onPathChange,
    onContextMenu,
    onCreateFolderRequest,
    onPasteRequest,
    showHiddenFiles,
    onToggleHiddenFiles,
    iconSize,
    viewMode,
    onViewModeChange,
    filledIcons,
}: ExplorerTabProps) {
    const [currentPath, setCurrentPath] = useState(initialPath);
    const currentPathRef = useRef(initialPath);
    const hasMountedRef = useRef(false);
    const [historyState, setHistoryState] = useState<HistoryState>(() => createHistory(initialPath));
    const [files, setFiles] = useState<IFile[]>([]);
    const [loading, setLoading] = useState(false);
    const { showToast } = useToast();
    const { copy, cut } = useClipboard();

    // Selection State
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);

    // Track recents
    const [, setRecentFiles] = useLocalStorage<IFile[]>('dashboard.recent', []);

    const addToRecents = useCallback((path: string) => {
        if (path === 'app://dashboard') return;

        const name = path.split('/').pop() || path;
        const newItem: IFile = {
            name,
            path,
            isDirectory: true,
            size: 0,
            mtime: new Date(),
        };

        setRecentFiles((prev) => {
            const filtered = prev.filter((f) => f.path !== path);
            return [newItem, ...filtered].slice(0, 20);
        });
    }, [setRecentFiles]);

    // Search State
    const [searchActive, setSearchActive] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const searchActiveRef = useRef(false);

    useEffect(() => {
        searchActiveRef.current = searchActive;
    }, [searchActive]);

    const handleSearch = async (query: string) => {
        setLoading(true);
        setSearchActive(true);
        searchActiveRef.current = true;
        setSearchQuery(query);
        try {
            if (window.electron && window.electron.search) {
                const results = await window.electron.search(currentPath, query);
                setFiles(results);
            }
        } catch (e) {
            console.error(e);
            showToast('Search failed', 'error');
        }
        setLoading(false);
    };

    const loadPath = useCallback(async (path: string, recordHistory = true) => {
        searchActiveRef.current = false;
        setSearchActive(false);
        setSearchQuery('');
        setSelectedFiles(new Set());
        setLastSelectedPath(null);

        if (recordHistory) {
            setHistoryState((prev) => pushHistory(prev, path));
        }

        if (path === 'app://dashboard') {
            currentPathRef.current = path;
            setCurrentPath(path);
            onPathChange(tabId, path);
            return;
        }

        setLoading(true);
        try {
            const items = await FileSystemService.listDir(path);
            setFiles(items);
            currentPathRef.current = path;
            setCurrentPath(path);
            onPathChange(tabId, path);
            addToRecents(path);
        } catch (e) {
            console.error('Failed to load path', path, e);
            showToast(`Failed to open ${path}`, 'error');
        }
        setLoading(false);
    }, [onPathChange, tabId, addToRecents, showToast]);

    const isRecoveringRef = useRef(false);

    const handleFolderMissing = useCallback(async (missingPath: string) => {
        if (isRecoveringRef.current) return;
        if (!window.electron?.exists || !window.electron?.getParentPath) return;

        isRecoveringRef.current = true;
        try {
            let checkPath = missingPath;
            while (checkPath) {
                const parent = await window.electron.getParentPath(checkPath);
                if (!parent || parent === checkPath) {
                    if (await window.electron.exists(parent || '/')) {
                        loadPath(parent || '/');
                        showToast('Folder no longer exists', 'info');
                    }
                    break;
                }
                if (await window.electron.exists(parent)) {
                    loadPath(parent);
                    showToast('Folder no longer exists', 'info');
                    break;
                }
                checkPath = parent;
            }
        } catch (err) {
            console.error('Error recovering from missing folder:', err);
        } finally {
            isRecoveringRef.current = false;
        }
    }, [loadPath, showToast]);

    const reloadSilently = useCallback(async () => {
        const targetPath = currentPathRef.current;
        if (!targetPath || targetPath === 'app://dashboard' || searchActiveRef.current) {
            return;
        }

        try {
            const items = await FileSystemService.listDir(targetPath);
            if (currentPathRef.current !== targetPath || searchActiveRef.current) {
                return;
            }

            setFiles(items);
            setSelectedFiles((prev) => {
                if (prev.size === 0) return prev;
                const validPaths = new Set(items.map((f) => f.path));
                let changed = false;
                const next = new Set<string>();
                for (const p of prev) {
                    if (validPaths.has(p)) {
                        next.add(p);
                    } else {
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });
        } catch {
            if (window.electron?.exists) {
                const exists = await window.electron.exists(targetPath);
                if (!exists) {
                    handleFolderMissing(targetPath);
                }
            }
        }
    }, [handleFolderMissing]);

    // Drag-in-progress tracking
    const isDraggingRef = useRef(false);
    const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearDrag = useCallback(() => {
        isDraggingRef.current = false;
        if (dragTimeoutRef.current) {
            clearTimeout(dragTimeoutRef.current);
            dragTimeoutRef.current = null;
        }
    }, []);

    const markDragStarted = useCallback(() => {
        isDraggingRef.current = true;
        if (dragTimeoutRef.current) {
            clearTimeout(dragTimeoutRef.current);
        }
        dragTimeoutRef.current = setTimeout(() => {
            isDraggingRef.current = false;
            dragTimeoutRef.current = null;
        }, 5000);
    }, []);

    useEffect(() => {
        if (!isActive) return;
        const handlePointerUp = () => clearDrag();
        const handleFocus = () => clearDrag();
        const handleDragEnd = () => clearDrag();

        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('mouseup', handlePointerUp);
        window.addEventListener('dragend', handleDragEnd);
        window.addEventListener('drop', handlePointerUp);
        window.addEventListener('focus', handleFocus);

        return () => {
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('mouseup', handlePointerUp);
            window.removeEventListener('dragend', handleDragEnd);
            window.removeEventListener('drop', handlePointerUp);
            window.removeEventListener('focus', handleFocus);
            clearDrag();
        };
    }, [isActive, clearDrag]);

    // Step 4: Refresh on re-activation
    const prevActiveRef = useRef(isActive);
    useEffect(() => {
        if (!prevActiveRef.current && isActive) {
            reloadSilently();
        }
        prevActiveRef.current = isActive;
    }, [isActive, reloadSilently]);

    // Live directory watching
    useDirWatch(
        currentPath,
        isActive,
        useCallback(
            async (type: 'change' | 'error') => {
                if (type === 'change') {
                    if (!isDraggingRef.current) {
                        reloadSilently();
                    }
                } else if (type === 'error') {
                    if (window.electron?.exists) {
                        const exists = await window.electron.exists(currentPath);
                        if (!exists) {
                            handleFolderMissing(currentPath);
                        }
                    }
                }
            },
            [currentPath, reloadSilently, handleFolderMissing]
        )
    );

    useEffect(() => {
        if (!initialPath) return;
        if (!hasMountedRef.current) {
            hasMountedRef.current = true;
            loadPath(initialPath, false);
        } else if (initialPath !== currentPathRef.current) {
            loadPath(initialPath, true);
        }
    }, [initialPath, loadPath]);

    useEffect(() => {
        if (refreshTrigger > 0 && currentPathRef.current && currentPathRef.current !== 'app://dashboard') {
            loadPath(currentPathRef.current, false);
        }
    }, [refreshTrigger, loadPath]);

    const handleBack = useCallback(() => {
        const result = stepBack(historyState);
        if (result.path) {
            setHistoryState(result.state);
            loadPath(result.path, false);
        }
    }, [historyState, loadPath]);

    const handleForward = useCallback(() => {
        const result = stepForward(historyState);
        if (result.path) {
            setHistoryState(result.state);
            loadPath(result.path, false);
        }
    }, [historyState, loadPath]);

    const handleNavigate = (file: IFile) => {
        if (file.isDirectory) {
            loadPath(file.path);
        } else {
            FileSystemService.open(file.path);
        }
    };

    const handleUp = useCallback(async () => {
        if (window.electron && currentPath && currentPath !== 'app://dashboard') {
            const parent = await window.electron.getParentPath(currentPath);
            if (parent !== currentPath) {
                loadPath(parent);
            }
        }
    }, [currentPath, loadPath]);

    // Sort State
    const [sortBy, setSortBy] = useState<'name' | 'size' | 'date'>('name');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

    const handleSortChange = useCallback((field: 'name' | 'size' | 'date') => {
        if (sortBy === field) {
            setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortBy(field);
            setSortOrder(field === 'name' ? 'asc' : 'desc');
        }
    }, [sortBy]);

    // Grouping State
    const [groupingEnabled, setGroupingEnabled] = useState(true);

    const hiddenCount = useMemo(
        () => files.filter((f) => isHiddenFile(f.name)).length,
        [files]
    );

    // Filter AND Sort files
    const sortedFiles = useMemo(() => {
        const filtered = files.filter((f) => showHiddenFiles || !isHiddenFile(f.name));
        return [...filtered].sort((a: IFile, b: IFile) => {
            if (groupingEnabled) {
                const groupA = getSemanticGroup(a);
                const groupB = getSemanticGroup(b);
                if (groupA !== groupB) {
                    return GROUP_ORDER.indexOf(groupA) - GROUP_ORDER.indexOf(groupB);
                }
            } else {
                if (a.isDirectory !== b.isDirectory) {
                    return a.isDirectory ? -1 : 1;
                }
            }

            let result = 0;
            switch (sortBy) {
                case 'name':
                    result = a.name.localeCompare(b.name);
                    break;
                case 'size':
                    result = a.size - b.size;
                    break;
                case 'date': {
                    const timeA = a.mtime instanceof Date ? a.mtime.getTime() : new Date(a.mtime).getTime();
                    const timeB = b.mtime instanceof Date ? b.mtime.getTime() : new Date(b.mtime).getTime();
                    result = timeA - timeB;
                    break;
                }
            }
            return sortOrder === 'asc' ? result : -result;
        });
    }, [files, showHiddenFiles, sortBy, sortOrder, groupingEnabled]);

    const selectedSize = useMemo(() => {
        if (selectedFiles.size === 0) return 0;
        return sortedFiles
            .filter((f) => selectedFiles.has(f.path) && !f.isDirectory)
            .reduce((acc, f) => acc + (f.size || 0), 0);
    }, [sortedFiles, selectedFiles]);

    const handleSelect = (file: IFile, toggle: boolean, range: boolean) => {
        const newSelection = new Set(toggle ? selectedFiles : []);

        if (range && lastSelectedPath) {
            const start = sortedFiles.findIndex((f) => f.path === lastSelectedPath);
            const end = sortedFiles.findIndex((f) => f.path === file.path);
            if (start !== -1 && end !== -1) {
                const low = Math.min(start, end);
                const high = Math.max(start, end);
                for (let i = low; i <= high; i++) {
                    newSelection.add(sortedFiles[i].path);
                }
            } else {
                newSelection.add(file.path);
            }
        } else if (toggle) {
            if (selectedFiles.has(file.path)) {
                newSelection.delete(file.path);
            } else {
                newSelection.add(file.path);
                setLastSelectedPath(file.path);
            }
        } else {
            newSelection.add(file.path);
            setLastSelectedPath(file.path);
        }

        setSelectedFiles(newSelection);
    };

    // Keyboard Shortcuts
    useEffect(() => {
        if (!isActive) return;

        const handleKeyDown = async (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (
                target &&
                (target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.isContentEditable ||
                    target.closest('.xterm'))
            ) {
                return;
            }

            if (e.altKey && e.key === 'ArrowLeft') {
                e.preventDefault();
                handleBack();
                return;
            }

            if (e.altKey && e.key === 'ArrowRight') {
                e.preventDefault();
                handleForward();
                return;
            }

            if (e.altKey && e.key === 'ArrowUp') {
                e.preventDefault();
                handleUp();
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
                if (currentPath && currentPath !== 'app://dashboard') {
                    e.preventDefault();
                    onCreateFolderRequest?.();
                }
                return;
            }

            // Toggle Hidden Files (Ctrl+H)
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'h') {
                e.preventDefault();
                onToggleHiddenFiles?.();
                return;
            }

            // Select All (Ctrl+A)
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                const allPaths = new Set(sortedFiles.map((f) => f.path));
                setSelectedFiles(allPaths);
                return;
            }

            // Refresh (F5)
            if (e.key === 'F5') {
                e.preventDefault();
                loadPath(currentPath, false);
                return;
            }

            // Delete (Del)
            if (e.key === 'Delete') {
                e.preventDefault();
                if (selectedFiles.size > 0) {
                    if (window.confirm(`Delete ${selectedFiles.size} items?`)) {
                        for (const path of selectedFiles) {
                            await FileSystemService.trash(path);
                        }
                        showToast(`Deleted ${selectedFiles.size} items`, 'success');
                        loadPath(currentPath, false);
                    }
                }
                return;
            }

            // Copy (Ctrl+C)
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
                if (selectedFiles.size > 0) {
                    const filesToCopy = sortedFiles.filter((f) => selectedFiles.has(f.path));
                    copy(filesToCopy);
                    showToast(`Copied ${selectedFiles.size} items`, 'info');
                }
                return;
            }

            // Cut (Ctrl+X)
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
                if (selectedFiles.size > 0) {
                    const filesToCut = sortedFiles.filter((f) => selectedFiles.has(f.path));
                    cut(filesToCut);
                    showToast(`Cut ${selectedFiles.size} items`, 'info');
                }
                return;
            }

            // Paste (Ctrl+V)
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
                if (currentPath !== 'app://dashboard') {
                    onPasteRequest?.(currentPath);
                }
                return;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        isActive,
        sortedFiles,
        selectedFiles,
        currentPath,
        loadPath,
        showToast,
        copy,
        cut,
        handleBack,
        handleForward,
        handleUp,
        onCreateFolderRequest,
        onPasteRequest,
        onToggleHiddenFiles,
    ]);

    return (
        <div style={{ display: isActive ? 'flex' : 'none', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>
            {/* Top Bar (Breadcrumb/Path + Quick Actions) */}
            {currentPath !== 'app://dashboard' && (
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', padding: '10px 20px 0' }}>
                    <div style={{ display: 'flex', gap: '2px' }}>
                        <IconButton
                            onClick={handleBack}
                            disabled={historyState.index <= 0}
                            variant="standard"
                            title="Back (Alt+Left)"
                        >
                            <Icon name="arrow_back" />
                        </IconButton>
                        <IconButton
                            onClick={handleForward}
                            disabled={historyState.index >= historyState.entries.length - 1}
                            variant="standard"
                            title="Forward (Alt+Right)"
                        >
                            <Icon name="arrow_forward" />
                        </IconButton>
                        <IconButton
                            onClick={handleUp}
                            disabled={!currentPath || currentPath === '/'}
                            variant="standard"
                            title="Up (Alt+Up)"
                        >
                            <Icon name="arrow_upward" />
                        </IconButton>
                    </div>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                        <Omnibar
                            currentPath={currentPath}
                            onNavigate={loadPath}
                            onSearch={handleSearch}
                        />
                    </div>
                    {/* Quick Action & Sort Controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {onCreateFolderRequest && (
                            <IconButton
                                variant="standard"
                                onClick={onCreateFolderRequest}
                                title="New Folder (Ctrl+Shift+N)"
                            >
                                <Icon name="create_new_folder" />
                            </IconButton>
                        )}
                        {onToggleHiddenFiles && (
                            <IconButton
                                variant={showHiddenFiles ? 'tonal' : 'standard'}
                                onClick={onToggleHiddenFiles}
                                title={showHiddenFiles ? 'Hide Hidden Files (Ctrl+H)' : 'Show Hidden Files (Ctrl+H)'}
                            >
                                <Icon name={showHiddenFiles ? 'visibility' : 'visibility_off'} />
                            </IconButton>
                        )}
                        <IconButton
                            variant={groupingEnabled ? 'tonal' : 'standard'}
                            onClick={() => setGroupingEnabled(!groupingEnabled)}
                            title={groupingEnabled ? 'Disable Category Grouping' : 'Enable Category Grouping'}
                        >
                            <Icon name="view_agenda" />
                        </IconButton>

                        <div style={{ width: '1px', height: '24px', background: 'var(--md-sys-color-outline-variant)', margin: '0 4px' }} />

                        <IconButton
                            variant={sortBy === 'name' ? 'tonal' : 'standard'}
                            onClick={() => handleSortChange('name')}
                            title={`Sort by Name (${sortBy === 'name' ? (sortOrder === 'asc' ? 'A-Z' : 'Z-A') : 'click to sort'})`}
                        >
                            <Icon name="sort_by_alpha" />
                        </IconButton>
                        <IconButton
                            variant={sortBy === 'date' ? 'tonal' : 'standard'}
                            onClick={() => handleSortChange('date')}
                            title={`Sort by Date (${sortBy === 'date' ? (sortOrder === 'asc' ? 'Oldest' : 'Newest') : 'click to sort'})`}
                        >
                            <Icon name="calendar_today" />
                        </IconButton>
                        <IconButton
                            variant={sortBy === 'size' ? 'tonal' : 'standard'}
                            onClick={() => handleSortChange('size')}
                            title={`Sort by Size (${sortBy === 'size' ? (sortOrder === 'asc' ? 'Smallest' : 'Largest') : 'click to sort'})`}
                        >
                            <Icon name="straighten" />
                        </IconButton>
                        <IconButton
                            variant="standard"
                            onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                            title={sortOrder === 'asc' ? 'Ascending (Click for Descending)' : 'Descending (Click for Ascending)'}
                        >
                            <Icon name={sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'} />
                        </IconButton>

                        {onViewModeChange && (
                            <>
                                <div style={{ width: '1px', height: '24px', background: 'var(--md-sys-color-outline-variant)', margin: '0 4px' }} />
                                <IconButton
                                    variant="tonal"
                                    onClick={() => onViewModeChange(viewMode === 'grid' ? 'list' : 'grid')}
                                    title={viewMode === 'grid' ? 'Switch to List View' : 'Switch to Grid View'}
                                >
                                    <Icon name={viewMode === 'grid' ? 'view_list' : 'grid_view'} />
                                </IconButton>
                            </>
                        )}
                    </div>
                </div>
            )}

            {currentPath === 'app://dashboard' ? (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>
                    <Dashboard onNavigate={loadPath} />
                </div>
            ) : loading ? (
                <FileListSkeleton viewMode={viewMode} iconSize={iconSize} />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                    {searchActive && (
                        <div style={{ padding: '8px 20px', background: 'var(--md-sys-color-surface-container)', color: 'var(--md-sys-color-on-surface-variant)', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Icon name="search" />
                            <span>Found {sortedFiles.length} results for "{searchQuery}"</span>
                            <IconButton onClick={() => loadPath(currentPath, false)} variant="standard" title="Clear Search">
                                <Icon name="close" />
                            </IconButton>
                        </div>
                    )}
                    <div
                        style={{ flex: 1, overflow: 'auto' }}
                        onDragStartCapture={markDragStarted}
                        onDragStart={markDragStarted}
                        onDragEnd={clearDrag}
                        onClick={(e) => {
                            if (e.target === e.currentTarget || !(e.target as HTMLElement).closest('.file-list-item')) {
                                setSelectedFiles(new Set());
                            }
                        }}
                        onContextMenu={(e) => {
                            if (!(e.target as HTMLElement).closest('.file-list-item')) {
                                onContextMenu(e, null, []);
                            }
                        }}
                        onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'copy';
                        }}
                        onDrop={async (e) => {
                            clearDrag();
                            e.preventDefault();
                            const droppedFiles = Array.from(e.dataTransfer.files);
                            if (droppedFiles.length > 0 && currentPath) {
                                let count = 0;
                                for (const file of droppedFiles) {
                                    const sourcePath = (file as File & { path?: string }).path;
                                    if (sourcePath) {
                                        const fileName = sourcePath.split(/[/\\]/).pop();
                                        const destPath = `${currentPath}/${fileName}`.replace(/\\+/g, '/');
                                        if (window.electron && window.electron.copyFile) {
                                            await window.electron.copyFile(sourcePath, destPath);
                                            count++;
                                        }
                                    }
                                }
                                if (count > 0) {
                                    showToast(`Imported ${count} files`, 'success');
                                    loadPath(currentPath, false);
                                }
                            }
                        }}
                    >
                        <FileList
                            files={sortedFiles}
                            selectedFiles={selectedFiles}
                            onSelect={handleSelect}
                            onNavigate={handleNavigate}
                            onContextMenu={(e, file) => {
                                let effectiveSelection: IFile[];
                                if (selectedFiles.has(file.path)) {
                                    effectiveSelection = sortedFiles.filter((f) => selectedFiles.has(f.path));
                                } else {
                                    handleSelect(file, false, false);
                                    effectiveSelection = [file];
                                }
                                onContextMenu(e, file, effectiveSelection);
                            }}
                            iconSize={iconSize}
                            viewMode={viewMode}
                            filledIcons={filledIcons}
                            groupingEnabled={groupingEnabled}
                            sortBy={sortBy}
                            sortOrder={sortOrder}
                            onSortChange={handleSortChange}
                            isSearch={searchActive}
                        />
                    </div>
                </div>
            )}

            {currentPath !== 'app://dashboard' && (
                <StatusBar
                    totalItems={files.length}
                    visibleItems={sortedFiles.length}
                    hiddenCount={showHiddenFiles ? 0 : hiddenCount}
                    selectedCount={selectedFiles.size}
                    selectedSize={selectedSize}
                />
            )}
        </div>
    );
}
