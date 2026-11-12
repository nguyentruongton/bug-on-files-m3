import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
    FAST_SPATIAL_SPRING,
    HorizontalFloatingToolbar,
    ToolbarDivider,
    ToolbarIconButton,
} from '@bug-on/m3-expressive';
import { useToast } from '../contexts/ToastContext';
import { useClipboard } from '../contexts/ClipboardContext';
import { StatusBar } from './StatusBar';
import { FileList } from './FileList';
import { FileListSkeleton } from './FileListSkeleton';
import { IconButton } from './IconButton';
import { Icon } from './Icon';
import { FileSystemService } from '../services/FileSystemService';
import type { IFile } from '../types/files';
import { api } from '../api';
import { isModalDialogOpen } from '../utils/themeUtils';

import { Omnibar } from './Omnibar';
import { Dashboard } from './Dashboard';
import { QuickLook } from './QuickLook';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useDirWatch } from '../hooks/useDirWatch';
import {
    pruneSelectedFiles,
    recoverMissingFolder,
    shouldApplyReload,
    resolveDragCompletion,
} from '../utils/explorerTabUtils';
import { getSemanticGroup, GROUP_ORDER, isArchiveFile, isHiddenFile } from '../utils/fileUtils';
import {
    resolveQuickLookTarget,
    resolveQuickLookFallback,
} from '../utils/quickLook';
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
    onRenameRequest?: (file: IFile) => void;
    onPropertiesRequest?: (file: IFile) => void;
    onOpenWithRequest?: (file: IFile) => void;
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
    onRenameRequest,
    onPropertiesRequest,
    onOpenWithRequest,
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
    const reloadSeqRef = useRef(0);
    const isDraggingRef = useRef(false);
    const pendingReloadAfterDragRef = useRef(false);
    const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [historyState, setHistoryState] = useState<HistoryState>(() => createHistory(initialPath));
    const [files, setFiles] = useState<IFile[]>([]);
    const [loading, setLoading] = useState(false);
    const { showToast } = useToast();
    const { copy, cut } = useClipboard();

    // Selection State
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);

    // Quick Look State
    const [quickLookPath, setQuickLookPath] = useState<string | null>(null);

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
            if (api && api.search) {
                const results = await api.search(currentPath, query);
                setFiles(results);
            }
        } catch (e) {
            console.error(e);
            showToast('Search failed', 'error');
        }
        setLoading(false);
    };

    const loadPath = useCallback(async (path: string, recordHistory = true) => {
        reloadSeqRef.current += 1;
        pendingReloadAfterDragRef.current = false;
        searchActiveRef.current = false;
        setSearchActive(false);
        setSearchQuery('');
        setSelectedFiles(new Set());
        setLastSelectedPath(null);
        setQuickLookPath(null);

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
        if (!api?.exists || !api?.getParentPath) return;

        isRecoveringRef.current = true;
        try {
            await recoverMissingFolder(missingPath, {
                exists: (p) => api.exists(p),
                getParentPath: (p) => api.getParentPath(p),
                loadPath,
                showToast,
            });
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

        const seq = ++reloadSeqRef.current;

        try {
            const items = await FileSystemService.listDir(targetPath);
            if (!shouldApplyReload({
                seq,
                expectedSeq: reloadSeqRef.current,
                currentPath: currentPathRef.current,
                targetPath,
                searchActive: searchActiveRef.current,
            })) {
                return;
            }

            setFiles(items);
            setSelectedFiles((prev) => pruneSelectedFiles(prev, items));
        } catch {
            if (!shouldApplyReload({
                seq,
                expectedSeq: reloadSeqRef.current,
                currentPath: currentPathRef.current,
                targetPath,
                searchActive: searchActiveRef.current,
            })) {
                return;
            }
            if (api?.exists) {
                const exists = await api.exists(targetPath);
                if (!shouldApplyReload({
                    seq,
                    expectedSeq: reloadSeqRef.current,
                    currentPath: currentPathRef.current,
                    targetPath,
                    searchActive: searchActiveRef.current,
                })) {
                    return;
                }
                if (!exists) {
                    handleFolderMissing(targetPath);
                }
            }
        }
    }, [handleFolderMissing]);

    // Drag-in-progress tracking
    const clearDrag = useCallback(
        (triggerPendingReload = true) => {
            isDraggingRef.current = false;
            if (dragTimeoutRef.current) {
                clearTimeout(dragTimeoutRef.current);
                dragTimeoutRef.current = null;
            }
            const { shouldReload, nextPendingReload } = resolveDragCompletion(
                triggerPendingReload,
                pendingReloadAfterDragRef.current
            );
            pendingReloadAfterDragRef.current = nextPendingReload;
            if (shouldReload) {
                reloadSilently();
            }
        },
        [reloadSilently]
    );

    const markDragStarted = useCallback(() => {
        isDraggingRef.current = true;
        if (dragTimeoutRef.current) {
            clearTimeout(dragTimeoutRef.current);
        }
        dragTimeoutRef.current = setTimeout(() => {
            clearDrag(true);
        }, 5000);
    }, [clearDrag]);

    useEffect(() => {
        if (!isActive) return;
        const handlePointerUp = () => clearDrag(true);
        const handleFocus = () => clearDrag(true);
        const handleDragEnd = () => clearDrag(true);

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
            clearDrag(false);
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
                    if (isDraggingRef.current) {
                        pendingReloadAfterDragRef.current = true;
                    } else {
                        reloadSilently();
                    }
                } else if (type === 'error') {
                    if (api?.exists) {
                        const exists = await api.exists(currentPath);
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
        if (api && currentPath && currentPath !== 'app://dashboard') {
            const parent = await api.getParentPath(currentPath);
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

    // Quick Look fallback resolution on live reload or active tab change
    const [prevSortedForQuickLook, setPrevSortedForQuickLook] = useState<IFile[]>(sortedFiles);
    const [prevActiveForQuickLook, setPrevActiveForQuickLook] = useState<boolean>(isActive);

    if (prevActiveForQuickLook !== isActive) {
        setPrevActiveForQuickLook(isActive);
        if (!isActive && quickLookPath) {
            setQuickLookPath(null);
        }
    }

    if (quickLookPath !== null && prevSortedForQuickLook !== sortedFiles) {
        setPrevSortedForQuickLook(sortedFiles);
        if (!sortedFiles.some((f) => f.path === quickLookPath)) {
            const fallback = resolveQuickLookFallback(
                quickLookPath,
                prevSortedForQuickLook,
                sortedFiles
            );
            if (fallback) {
                setQuickLookPath(fallback.path);
                setSelectedFiles(new Set([fallback.path]));
                setLastSelectedPath(fallback.path);
            } else {
                setQuickLookPath(null);
            }
        }
    }

    const quickLookFile = useMemo(() => {
        if (!quickLookPath) return null;
        return sortedFiles.find((f) => f.path === quickLookPath) ?? null;
    }, [quickLookPath, sortedFiles]);

    const selectedItems = useMemo(() => {
        if (selectedFiles.size === 0) return [];
        return sortedFiles.filter((f) => selectedFiles.has(f.path));
    }, [sortedFiles, selectedFiles]);

    const selectedSize = useMemo(() => {
        if (selectedItems.length === 0) return 0;
        return selectedItems
            .filter((f) => !f.isDirectory)
            .reduce((acc, f) => acc + (f.size || 0), 0);
    }, [selectedItems]);

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

            // Guard all explorer shortcuts while a modal dialog or QuickLook overlay is active
            if (isModalDialogOpen() || quickLookPath !== null) {
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

            // Quick Look (Space)
            if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                if (currentPath !== 'app://dashboard' && selectedFiles.size > 0) {
                    e.preventDefault();
                    const targetFile = resolveQuickLookTarget(selectedFiles, lastSelectedPath, sortedFiles);
                    if (targetFile) {
                        setQuickLookPath(targetFile.path);
                        setPrevSortedForQuickLook(sortedFiles);
                    }
                    return;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        isActive,
        sortedFiles,
        selectedFiles,
        lastSelectedPath,
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
        quickLookPath,
    ]);

    return (
        <div
            className={`flex-col flex-1 h-full overflow-hidden ${isActive ? 'flex' : 'hidden'}`}
        >
            {/* Top Bar (Breadcrumb/Path + Quick Actions) */}
            {currentPath !== 'app://dashboard' && (
                <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-m3-surface-container-low border-b border-m3-outline-variant/30">
                    <div className="flex items-center gap-0.5 shrink-0">
                        <IconButton
                            onClick={handleBack}
                            disabled={historyState.index <= 0}
                            variant="standard"
                            aria-label="Back"
                            title="Back (Alt+Left)"
                        >
                            <Icon name="arrow_back" />
                        </IconButton>
                        <IconButton
                            onClick={handleForward}
                            disabled={historyState.index >= historyState.entries.length - 1}
                            variant="standard"
                            aria-label="Forward"
                            title="Forward (Alt+Right)"
                        >
                            <Icon name="arrow_forward" />
                        </IconButton>
                        <IconButton
                            onClick={handleUp}
                            disabled={!currentPath || currentPath === '/'}
                            variant="standard"
                            aria-label="Up"
                            title="Up (Alt+Up)"
                        >
                            <Icon name="arrow_upward" />
                        </IconButton>
                    </div>

                    <div className="flex-1 min-w-0">
                        <Omnibar
                            currentPath={currentPath}
                            onNavigate={loadPath}
                            onSearch={handleSearch}
                        />
                    </div>

                    {/* Quick Action & Sort Controls */}
                    <div className="flex items-center gap-1 shrink-0">
                        {onCreateFolderRequest && (
                            <IconButton
                                variant="standard"
                                onClick={onCreateFolderRequest}
                                aria-label="New Folder"
                                title="New Folder (Ctrl+Shift+N)"
                            >
                                <Icon name="create_new_folder" />
                            </IconButton>
                        )}
                        {onToggleHiddenFiles && (
                            <IconButton
                                variant={showHiddenFiles ? 'tonal' : 'standard'}
                                onClick={onToggleHiddenFiles}
                                aria-label={showHiddenFiles ? 'Hide Hidden Files' : 'Show Hidden Files'}
                                title={showHiddenFiles ? 'Hide Hidden Files (Ctrl+H)' : 'Show Hidden Files (Ctrl+H)'}
                            >
                                <Icon name={showHiddenFiles ? 'visibility' : 'visibility_off'} />
                            </IconButton>
                        )}
                        <IconButton
                            variant={groupingEnabled ? 'tonal' : 'standard'}
                            onClick={() => setGroupingEnabled(!groupingEnabled)}
                            aria-label={groupingEnabled ? 'Disable Category Grouping' : 'Enable Category Grouping'}
                            title={groupingEnabled ? 'Disable Category Grouping' : 'Enable Category Grouping'}
                        >
                            <Icon name="view_agenda" />
                        </IconButton>

                        <div className="w-px h-6 bg-m3-outline-variant/50 mx-1" />

                        <IconButton
                            variant={sortBy === 'name' ? 'tonal' : 'standard'}
                            onClick={() => handleSortChange('name')}
                            aria-label="Sort by Name"
                            title={`Sort by Name (${sortBy === 'name' ? (sortOrder === 'asc' ? 'A-Z' : 'Z-A') : 'click to sort'})`}
                        >
                            <Icon name="sort_by_alpha" />
                        </IconButton>
                        <IconButton
                            variant={sortBy === 'date' ? 'tonal' : 'standard'}
                            onClick={() => handleSortChange('date')}
                            aria-label="Sort by Date"
                            title={`Sort by Date (${sortBy === 'date' ? (sortOrder === 'asc' ? 'Oldest' : 'Newest') : 'click to sort'})`}
                        >
                            <Icon name="calendar_today" />
                        </IconButton>
                        <IconButton
                            variant={sortBy === 'size' ? 'tonal' : 'standard'}
                            onClick={() => handleSortChange('size')}
                            aria-label="Sort by Size"
                            title={`Sort by Size (${sortBy === 'size' ? (sortOrder === 'asc' ? 'Smallest' : 'Largest') : 'click to sort'})`}
                        >
                            <Icon name="straighten" />
                        </IconButton>
                        <IconButton
                            variant="standard"
                            onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                            aria-label="Toggle Sort Order"
                            title={sortOrder === 'asc' ? 'Ascending (Click for Descending)' : 'Descending (Click for Ascending)'}
                        >
                            <Icon name={sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'} />
                        </IconButton>

                        {onViewModeChange && (
                            <>
                                <div className="w-px h-6 bg-m3-outline-variant/50 mx-1" />
                                <IconButton
                                    variant="tonal"
                                    onClick={() => onViewModeChange(viewMode === 'grid' ? 'list' : 'grid')}
                                    aria-label={viewMode === 'grid' ? 'Switch to List View' : 'Switch to Grid View'}
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
                <div className="flex flex-col flex-1 h-full overflow-hidden">
                    <Dashboard onNavigate={loadPath} />
                </div>
            ) : loading ? (
                <FileListSkeleton viewMode={viewMode} iconSize={iconSize} />
            ) : (
                <div className="relative flex flex-col flex-1 overflow-hidden">
                    {searchActive && (
                        <div className="px-5 py-2 bg-m3-surface-container text-m3-on-surface-variant text-sm flex items-center gap-2 shrink-0 border-b border-m3-outline-variant/30">
                            <Icon name="search" size={18} />
                            <span className="flex-1 truncate">
                                Found {sortedFiles.length} results for &ldquo;{searchQuery}&rdquo;
                            </span>
                            <IconButton
                                onClick={() => loadPath(currentPath, false)}
                                variant="standard"
                                aria-label="Clear Search"
                                title="Clear Search"
                            >
                                <Icon name="close" size={18} />
                            </IconButton>
                        </div>
                    )}
                    <div
                        className="flex-1 overflow-auto"
                        onDragStartCapture={markDragStarted}
                        onDragStart={markDragStarted}
                        onDragEnd={() => clearDrag(true)}
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
                                        if (api && api.copyFile) {
                                            await api.copyFile(sourcePath, destPath);
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

                    <AnimatePresence>
                        {selectedItems.length > 0 && (
                            <motion.div
                                initial={{ opacity: 0, y: 20, scale: 0.96 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 16, scale: 0.96 }}
                                transition={FAST_SPATIAL_SPRING}
                                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20"
                            >
                                <HorizontalFloatingToolbar
                                    expanded
                                    variant="vibrant"
                                    shape="full"
                                    aria-label="Selection actions"
                                    startContent={
                                        <div className="flex items-center gap-1 pl-2 pr-1">
                                            <span className="text-xs font-semibold whitespace-nowrap">
                                                {selectedItems.length} selected
                                            </span>
                                            <ToolbarIconButton
                                                aria-label="Clear selection"
                                                title="Clear selection"
                                                width="narrow"
                                                onClick={() => setSelectedFiles(new Set())}
                                            >
                                                <Icon name="close" size={18} />
                                            </ToolbarIconButton>
                                            <ToolbarDivider />
                                        </div>
                                    }
                                >
                                    {selectedItems.length === 1 && (
                                        <>
                                            <ToolbarIconButton
                                                emphasis="tonal"
                                                aria-label="Open"
                                                title="Open"
                                                onClick={() => handleNavigate(selectedItems[0])}
                                            >
                                                <Icon name="open_in_new" size={20} />
                                            </ToolbarIconButton>
                                            <ToolbarIconButton
                                                aria-label="Quick Look"
                                                title="Quick Look (Space)"
                                                onClick={() => {
                                                    setQuickLookPath(selectedItems[0].path);
                                                    setPrevSortedForQuickLook(sortedFiles);
                                                }}
                                            >
                                                <Icon name="visibility" size={20} />
                                            </ToolbarIconButton>
                                            {!selectedItems[0].isDirectory && onOpenWithRequest && (
                                                <ToolbarIconButton
                                                    aria-label="Open With"
                                                    title="Open With..."
                                                    onClick={() => onOpenWithRequest(selectedItems[0])}
                                                >
                                                    <Icon name="apps" size={20} />
                                                </ToolbarIconButton>
                                            )}
                                            {!selectedItems[0].isDirectory && isArchiveFile(selectedItems[0].name) && (
                                                <ToolbarIconButton
                                                    aria-label="Extract Here"
                                                    title="Extract Here"
                                                    onClick={async () => {
                                                        const archiveFile = selectedItems[0];
                                                        try {
                                                            const ok = await api.extractFile(archiveFile.path);
                                                            if (!ok) throw new Error('Extract returned false');
                                                            showToast(`Extracted "${archiveFile.name}"`, 'success');
                                                            loadPath(currentPath, false);
                                                        } catch (err) {
                                                            console.error('Extract failed', err);
                                                            showToast(`Failed to extract "${archiveFile.name}"`, 'error');
                                                        }
                                                    }}
                                                >
                                                    <Icon name="unarchive" size={20} />
                                                </ToolbarIconButton>
                                            )}
                                            <ToolbarDivider />
                                        </>
                                    )}

                                    <ToolbarIconButton
                                        aria-label="Copy"
                                        title="Copy (Ctrl+C)"
                                        onClick={() => {
                                            copy(selectedItems);
                                            showToast(`Copied ${selectedItems.length} item(s)`, 'info');
                                        }}
                                    >
                                        <Icon name="content_copy" size={20} />
                                    </ToolbarIconButton>
                                    <ToolbarIconButton
                                        aria-label="Cut"
                                        title="Cut (Ctrl+X)"
                                        onClick={() => {
                                            cut(selectedItems);
                                            showToast(`Cut ${selectedItems.length} item(s)`, 'info');
                                        }}
                                    >
                                        <Icon name="content_cut" size={20} />
                                    </ToolbarIconButton>

                                    {selectedItems.length === 1 && onRenameRequest && (
                                        <ToolbarIconButton
                                            aria-label="Rename"
                                            title="Rename"
                                            onClick={() => onRenameRequest(selectedItems[0])}
                                        >
                                            <Icon name="edit" size={20} />
                                        </ToolbarIconButton>
                                    )}
                                    {selectedItems.length === 1 && onPropertiesRequest && (
                                        <ToolbarIconButton
                                            aria-label="Properties"
                                            title="Properties"
                                            onClick={() => onPropertiesRequest(selectedItems[0])}
                                        >
                                            <Icon name="info" size={20} />
                                        </ToolbarIconButton>
                                    )}

                                    <ToolbarDivider />

                                    <ToolbarIconButton
                                        aria-label="Move to Trash"
                                        title="Move to Trash (Del)"
                                        onClick={async () => {
                                            try {
                                                for (const item of selectedItems) {
                                                    await FileSystemService.trash(item.path);
                                                }
                                                showToast(`Moved ${selectedItems.length} item(s) to Trash`, 'success');
                                                setSelectedFiles(new Set());
                                                loadPath(currentPath, false);
                                            } catch (err) {
                                                console.error('Delete failed', err);
                                                showToast('Failed to delete selected item(s)', 'error');
                                            }
                                        }}
                                    >
                                        <Icon name="delete" size={20} />
                                    </ToolbarIconButton>
                                </HorizontalFloatingToolbar>
                            </motion.div>
                        )}
                    </AnimatePresence>
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

            {quickLookFile && (
                <QuickLook
                    file={quickLookFile}
                    files={sortedFiles}
                    viewMode={viewMode}
                    onClose={() => setQuickLookPath(null)}
                    onNavigate={(nextFile) => {
                        handleSelect(nextFile, false, false);
                        setQuickLookPath(nextFile.path);
                    }}
                    onOpen={(fileToOpen) => {
                        handleNavigate(fileToOpen);
                    }}
                />
            )}
        </div>
    );
}
