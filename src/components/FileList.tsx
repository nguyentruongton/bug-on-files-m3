import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { List, ListItem } from '@bug-on/m3-expressive';
import type { ListItemPosition } from '@bug-on/m3-expressive/layout';
import { ExpressiveShape } from './ExpressiveShape';
import type { IFile } from '../types/files';
import { Icon } from './Icon';
import { api } from '../api';
import {
    formatFileDate,
    formatFileSize,
    getFileIconInfo,
    getSemanticGroup,
    isHiddenFile,
    isImageFile,
} from '../utils/fileUtils';
import { buildDisplayEntries, type SortField } from '../utils/fileListUtils';
import { getFileGroupShapePair, shouldEnableItemMorph } from '../utils/shapeUtils';
import { toMediaUrl } from '../utils/quickLook';
import { useVirtualWindow } from '../hooks/useVirtualWindow';

const LIST_TOP_PADDING = 8;
const HEADER_ROW_HEIGHT_WITH_GAP = 38;
const FILE_ROW_HEIGHT = 56;
const FILE_ROW_HEIGHT_WITH_GAP = 58;

interface FileListProps {
    files: IFile[];
    selectedFiles: Set<string>;
    onSelect: (file: IFile, toggle: boolean, range: boolean) => void;
    onNavigate: (file: IFile) => void;
    onContextMenu?: (e: React.MouseEvent, file: IFile) => void;
    viewMode: 'grid' | 'list';
    iconSize: number;
    filledIcons: boolean;
    groupingEnabled?: boolean;
    sortBy?: SortField;
    sortOrder?: 'asc' | 'desc';
    onSortChange?: (field: SortField) => void;
    scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
    isSearch?: boolean;
}

interface FileListRowProps {
    file: IFile;
    fileIndex: number;
    isSelected: boolean;
    position: ListItemPosition;
    morphEnabled: boolean;
    filledIcons: boolean;
    onItemClick: (e: React.MouseEvent, file: IFile) => void;
    onNavigate: (file: IFile) => void;
    onContextMenu?: (e: React.MouseEvent, file: IFile) => void;
    onItemDragStart: (e: React.DragEvent, file: IFile) => void;
    onItemKeyDown: (e: React.KeyboardEvent, file: IFile, fileIndex: number) => void;
}

const noop = () => {};

function focusFileRowByPath(root: HTMLElement | null, targetPath: string): boolean {
    if (!root) return false;
    const nodes = root.querySelectorAll('[data-file-path]');
    for (const node of nodes) {
        if (node.getAttribute('data-file-path') === targetPath) {
            (node as HTMLElement).focus({ preventScroll: true });
            return true;
        }
    }
    return false;
}

const FileListRow: React.FC<FileListRowProps> = React.memo(
    ({
        file,
        fileIndex,
        isSelected,
        position,
        morphEnabled,
        filledIcons,
        onItemClick,
        onNavigate,
        onContextMenu,
        onItemDragStart,
        onItemKeyDown,
    }) => {
        const hidden = isHiddenFile(file.name);
        const iconInfo = getFileIconInfo(file);
        const groupName = getSemanticGroup(file);
        const shapePair = getFileGroupShapePair(groupName, file.isDirectory, file.name);
        const fileGroupLabel = file.isDirectory ? 'Folder' : groupName.replace(/s$/, '');

        const leadingContent = (
            <ExpressiveShape
                shape={isSelected ? shapePair.morph : shapePair.rest}
                morphTo={
                    morphEnabled
                        ? isSelected
                            ? shapePair.rest
                            : shapePair.morph
                        : undefined
                }
                morphOn="hover"
                width={32}
                height={32}
                className={shapePair.containerClass}
            >
                {!file.isDirectory && isImageFile(file.name) ? (
                    <img
                        src={toMediaUrl(file.path)}
                        alt={file.name}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                            e.currentTarget.style.display = 'none';
                        }}
                    />
                ) : (
                    <Icon
                        name={iconInfo.icon}
                        size={18}
                        filled={filledIcons || file.isDirectory}
                    />
                )}
            </ExpressiveShape>
        );

        const trailingContent = (
            <div className="file-meta-grid items-center text-xs text-m3-on-surface-variant">
                <span className="hidden md:block truncate">
                    {formatFileDate(file.mtime)}
                </span>
                <span className="hidden sm:block truncate">{fileGroupLabel}</span>
                <span className="text-right tabular-nums">
                    {file.isDirectory ? '—' : formatFileSize(file.size)}
                </span>
            </div>
        );

        return (
            <ListItem
                value={file.path}
                position={position}
                selected={isSelected}
                headline={file.name}
                leadingType="custom"
                leadingContent={leadingContent}
                trailingType="custom"
                trailingContent={trailingContent}
                asChild
                className={hidden ? 'opacity-60' : undefined}
            >
                <div
                    role="option"
                    aria-selected={isSelected}
                    data-file-path={file.path}
                    draggable
                    onDragStart={(e) => onItemDragStart(e, file)}
                    onClick={(e) => onItemClick(e, file)}
                    onDoubleClick={() => onNavigate(file)}
                    onContextMenu={(e) => onContextMenu?.(e, file)}
                    onKeyDown={(e) => onItemKeyDown(e, file, fileIndex)}
                    className="file-list-item h-14 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-m3-primary"
                />
            </ListItem>
        );
    }
);
FileListRow.displayName = 'FileListRow';

export const FileList: React.FC<FileListProps> = ({
    files,
    selectedFiles,
    onSelect,
    onNavigate,
    onContextMenu,
    viewMode,
    iconSize,
    filledIcons,
    groupingEnabled,
    sortBy = 'name',
    sortOrder = 'asc',
    onSortChange,
    scrollContainerRef,
    isSearch = false,
}) => {
    const sortedFiles = files;

    const listRootRef = useRef<HTMLDivElement>(null);
    const localScrollRef = useRef<HTMLDivElement>(null);
    const activeScrollRef = scrollContainerRef ?? localScrollRef;
    const pendingFocusPathRef = useRef<string | null>(null);
    const isProgrammaticScrollRef = useRef(false);

    const { displayEntries, fileIndexToEntryIndex } = useMemo(() => {
        const entries = buildDisplayEntries(sortedFiles, Boolean(groupingEnabled));
        const indexMap = new Map<number, number>();
        entries.forEach((entry, idx) => {
            if (entry.kind === 'file') {
                indexMap.set(entry.fileIndex, idx);
            }
        });
        return { displayEntries: entries, fileIndexToEntryIndex: indexMap };
    }, [sortedFiles, groupingEnabled]);

    const getEntryHeight = useCallback(
        (index: number) =>
            displayEntries[index]?.kind === 'header'
                ? HEADER_ROW_HEIGHT_WITH_GAP
                : FILE_ROW_HEIGHT_WITH_GAP,
        [displayEntries]
    );

    const { startIndex, endIndex, topSpacerHeight, bottomSpacerHeight, offsets } = useVirtualWindow({
        containerRef: activeScrollRef,
        itemCount: displayEntries.length,
        getItemHeight: getEntryHeight,
        overscan: 6,
        topOffset: LIST_TOP_PADDING,
        fallbackHeight: 600,
    });

    const latestRef = useRef({
        selectedFiles,
        sortedFiles,
        onSelect,
        onNavigate,
        onContextMenu,
        offsets,
        fileIndexToEntryIndex,
        scrollEl: null as HTMLDivElement | null,
    });

    useLayoutEffect(() => {
        latestRef.current = {
            selectedFiles,
            sortedFiles,
            onSelect,
            onNavigate,
            onContextMenu,
            offsets,
            fileIndexToEntryIndex,
            scrollEl: activeScrollRef.current,
        };
    });

    const selectedArray = useMemo(() => Array.from(selectedFiles), [selectedFiles]);

    // Clear pending keyboard focus target when directory contents change
    const directorySignature = sortedFiles[0]?.path ?? '';
    useEffect(() => {
        pendingFocusPathRef.current = null;
    }, [directorySignature]);

    // Clear pending keyboard focus target on manual scroll
    useEffect(() => {
        const scroller = activeScrollRef.current;
        if (!scroller) return;

        const handleScroll = () => {
            if (isProgrammaticScrollRef.current) {
                isProgrammaticScrollRef.current = false;
                return;
            }
            pendingFocusPathRef.current = null;
        };

        const handleManualInput = () => {
            pendingFocusPathRef.current = null;
        };

        scroller.addEventListener('scroll', handleScroll, { passive: true });
        scroller.addEventListener('wheel', handleManualInput, { passive: true });
        return () => {
            scroller.removeEventListener('scroll', handleScroll);
            scroller.removeEventListener('wheel', handleManualInput);
        };
    }, [activeScrollRef]);

    // Restore keyboard focus once virtualized row mounts after scroll
    useLayoutEffect(() => {
        const pendingPath = pendingFocusPathRef.current;
        if (!pendingPath) return;
        if (focusFileRowByPath(listRootRef.current, pendingPath)) {
            pendingFocusPathRef.current = null;
        }
    }, [startIndex, endIndex, displayEntries]);

    const handleItemClick = useCallback((e: React.MouseEvent, file: IFile) => {
        const { selectedFiles: currentSelected, onNavigate: navigate, onSelect: select } =
            latestRef.current;
        const isModifier = e.ctrlKey || e.metaKey || e.shiftKey;
        const isSelected = currentSelected.has(file.path);
        if (!isModifier && isSelected) {
            navigate(file);
        } else {
            select(file, e.ctrlKey || e.metaKey, e.shiftKey);
        }
    }, []);

    const handleStableNavigate = useCallback((file: IFile) => {
        latestRef.current.onNavigate(file);
    }, []);

    const handleStableContextMenu = useCallback((e: React.MouseEvent, file: IFile) => {
        latestRef.current.onContextMenu?.(e, file);
    }, []);

    const handleItemDragStart = useCallback((e: React.DragEvent, file: IFile) => {
        e.preventDefault();
        if (api && api.startDrag) {
            api.startDrag(file.path, file.path);
        }
    }, []);

    const handleItemKeyDown = useCallback(
        (e: React.KeyboardEvent, file: IFile, fileIndex: number) => {
            const {
                onNavigate: navigate,
                sortedFiles: currentFiles,
                offsets: currentOffsets,
                fileIndexToEntryIndex: entryMap,
                scrollEl: scroller,
            } = latestRef.current;

            if (e.key === 'Enter') {
                e.preventDefault();
                navigate(file);
                return;
            }

            if (e.key === ' ') {
                e.preventDefault();
                return;
            }

            if (currentFiles.length === 0) return;

            let nextFileIndex = -1;
            if (e.key === 'ArrowDown') {
                nextFileIndex = Math.min(currentFiles.length - 1, fileIndex + 1);
            } else if (e.key === 'ArrowUp') {
                nextFileIndex = Math.max(0, fileIndex - 1);
            } else if (e.key === 'Home') {
                nextFileIndex = 0;
            } else if (e.key === 'End') {
                nextFileIndex = currentFiles.length - 1;
            }

            if (nextFileIndex === -1) return;

            e.preventDefault();
            e.stopPropagation();

            const nextFile = currentFiles[nextFileIndex];
            if (!nextFile) return;

            pendingFocusPathRef.current = nextFile.path;

            const entryIdx = entryMap.get(nextFileIndex);
            if (scroller && entryIdx !== undefined) {
                const rowTop = LIST_TOP_PADDING + (currentOffsets[entryIdx] ?? 0);
                const rowBottom = rowTop + FILE_ROW_HEIGHT;
                const visibleTop = scroller.scrollTop;
                const visibleBottom = scroller.scrollTop + scroller.clientHeight;

                if (nextFileIndex === 0 && scroller.scrollTop > 0) {
                    isProgrammaticScrollRef.current = true;
                    scroller.scrollTop = 0;
                } else if (rowTop < visibleTop) {
                    isProgrammaticScrollRef.current = true;
                    scroller.scrollTop = Math.max(0, rowTop);
                } else if (rowBottom > visibleBottom) {
                    isProgrammaticScrollRef.current = true;
                    scroller.scrollTop = Math.max(0, rowBottom - scroller.clientHeight);
                }
            }

            if (focusFileRowByPath(listRootRef.current, nextFile.path)) {
                pendingFocusPathRef.current = null;
            }
        },
        []
    );

    if (files.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full min-h-[300px] px-6 py-12 text-center select-none bg-m3-surface-container-low">
                <ExpressiveShape
                    shape="clover4Leaf"
                    morphTo="flower"
                    morphOn="hover"
                    width={88}
                    height={88}
                    className="bg-m3-secondary-container text-m3-on-secondary-container mb-4"
                >
                    <Icon name={isSearch ? 'search_off' : 'folder_open'} size={42} />
                </ExpressiveShape>
                <div className="text-lg font-medium text-m3-on-surface mb-1">
                    {isSearch ? 'No matching files found' : 'This folder is empty'}
                </div>
                <div className="text-sm text-m3-on-surface-variant max-w-sm">
                    {isSearch
                        ? 'Try a different keyword or clear the search filter.'
                        : 'Drop files here or use the action menu to create a new folder.'}
                </div>
            </div>
        );
    }

    if (viewMode === 'list') {
        const visibleEntries =
            endIndex >= startIndex ? displayEntries.slice(startIndex, endIndex + 1) : [];

        const renderSortIcon = (field: SortField) => {
            if (sortBy !== field) return null;
            return (
                <Icon
                    name={sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                    size={14}
                />
            );
        };

        const getAriaSort = (field: SortField): 'ascending' | 'descending' | 'none' => {
            if (sortBy !== field) return 'none';
            return sortOrder === 'asc' ? 'ascending' : 'descending';
        };

        return (
            <div ref={listRootRef} className="flex flex-col flex-1 min-h-0 w-full bg-m3-surface-container-low">
                <div
                    role="row"
                    className="file-list-header shrink-0 h-10 bg-m3-surface-container-high px-7 flex items-center gap-3 select-none"
                >
                    <div className="w-8 shrink-0" aria-hidden="true" />
                    <button
                        type="button"
                        aria-sort={getAriaSort('name')}
                        onClick={(e) => {
                            e.stopPropagation();
                            onSortChange?.('name');
                        }}
                        className="flex-1 min-w-0 flex items-center gap-1 text-left text-xs font-medium text-m3-on-surface-variant hover:text-m3-on-surface transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-m3-primary rounded-sm"
                    >
                        <span className="truncate">Name</span>
                        {renderSortIcon('name')}
                    </button>
                    <div className="file-meta-grid items-center shrink-0 text-xs font-medium text-m3-on-surface-variant">
                        <button
                            type="button"
                            aria-sort={getAriaSort('date')}
                            onClick={(e) => {
                                e.stopPropagation();
                                onSortChange?.('date');
                            }}
                            className="hidden md:flex items-center gap-1 min-w-0 truncate text-left hover:text-m3-on-surface transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-m3-primary rounded-sm"
                        >
                            <span className="truncate">Date Modified</span>
                            {renderSortIcon('date')}
                        </button>
                        <button
                            type="button"
                            aria-sort={getAriaSort('type')}
                            onClick={(e) => {
                                e.stopPropagation();
                                onSortChange?.('type');
                            }}
                            className="hidden sm:flex items-center gap-1 min-w-0 truncate text-left hover:text-m3-on-surface transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-m3-primary rounded-sm"
                        >
                            <span className="truncate">Type</span>
                            {renderSortIcon('type')}
                        </button>
                        <button
                            type="button"
                            aria-sort={getAriaSort('size')}
                            onClick={(e) => {
                                e.stopPropagation();
                                onSortChange?.('size');
                            }}
                            className="flex items-center justify-end gap-1 text-right hover:text-m3-on-surface transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-m3-primary rounded-sm w-full"
                        >
                            <span>Size</span>
                            {renderSortIcon('size')}
                        </button>
                    </div>
                </div>

                <div
                    ref={activeScrollRef}
                    className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-m3-surface-container-low"
                >
                <div className="px-3 pt-2 pb-24 min-h-full bg-m3-surface-container-low">
                <List
                    variant="expressive"
                    listStyle="segmented"
                    selectionMode="multi-select"
                    value={selectedArray}
                    onChange={noop}
                    aria-label="Files"
                >
                    {topSpacerHeight > 0 && (
                        <li
                            role="presentation"
                            aria-hidden="true"
                            className="shrink-0 pointer-events-none"
                            style={{ height: topSpacerHeight }}
                        />
                    )}
                    {visibleEntries.map((entry) => {
                        if (entry.kind === 'header') {
                            return (
                                <li
                                    key={entry.key}
                                    role="presentation"
                                    onClick={(e) => e.stopPropagation()}
                                    className="h-9 px-4 flex items-center select-none"
                                >
                                    <span className="px-3 py-0.5 rounded-full bg-m3-secondary-container text-m3-on-secondary-container text-xs font-semibold">
                                        {entry.group}
                                    </span>
                                </li>
                            );
                        }

                        const isSelected = selectedFiles.has(entry.file.path);
                        return (
                            <FileListRow
                                key={entry.key}
                                file={entry.file}
                                fileIndex={entry.fileIndex}
                                isSelected={isSelected}
                                position={entry.position}
                                morphEnabled={shouldEnableItemMorph(
                                    sortedFiles.length,
                                    isSelected
                                )}
                                filledIcons={filledIcons}
                                onItemClick={handleItemClick}
                                onNavigate={handleStableNavigate}
                                onContextMenu={
                                    onContextMenu ? handleStableContextMenu : undefined
                                }
                                onItemDragStart={handleItemDragStart}
                                onItemKeyDown={handleItemKeyDown}
                            />
                        );
                    })}
                    {bottomSpacerHeight > 0 && (
                        <li
                            role="presentation"
                            aria-hidden="true"
                            className="shrink-0 pointer-events-none"
                            style={{ height: bottomSpacerHeight }}
                        />
                    )}
                </List>
                </div>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={activeScrollRef}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-m3-surface-container-low"
        >
        <div
            className="grid content-start gap-3 p-4 pb-24 min-h-full bg-m3-surface-container-low"
            style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(116, iconSize + 48)}px, 1fr))`,
            }}
        >
            {sortedFiles.map((file, index) => {
                const currentGroup = groupingEnabled ? getSemanticGroup(file) : '';
                const prevGroup =
                    groupingEnabled && index > 0 ? getSemanticGroup(sortedFiles[index - 1]) : '';
                const showHeader = Boolean(groupingEnabled && currentGroup !== prevGroup);

                const isSelected = selectedFiles.has(file.path);
                const hidden = isHiddenFile(file.name);
                const iconInfo = getFileIconInfo(file);
                const groupName = getSemanticGroup(file);
                const shapePair = getFileGroupShapePair(groupName, file.isDirectory, file.name);
                const enableMorph = shouldEnableItemMorph(sortedFiles.length, isSelected);
                const containerSize = iconSize + 16;

                return (
                    <React.Fragment key={file.path}>
                        {showHeader && (
                            <div
                                className="flex items-center col-span-full"
                                style={{ marginTop: index > 0 ? '12px' : '2px' }}
                            >
                                <span className="px-3 py-1 rounded-full bg-m3-secondary-container text-m3-on-secondary-container text-xs font-semibold">
                                    {currentGroup}
                                </span>
                            </div>
                        )}
                        <div
                            data-file-path={file.path}
                            className={`file-list-item group relative flex flex-col items-center p-2.5 rounded-m3-lg transition-colors cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-m3-primary ${
                                isSelected
                                    ? 'bg-m3-secondary-container text-m3-on-secondary-container'
                                    : 'hover:bg-m3-surface-container-high text-m3-on-surface'
                            } ${hidden ? 'opacity-60' : ''}`}
                            title={file.name}
                            onClick={(e) => handleItemClick(e, file)}
                            onDoubleClick={() => onNavigate(file)}
                            onContextMenu={(e) => onContextMenu?.(e, file)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    onNavigate(file);
                                } else if (e.key === ' ') {
                                    e.preventDefault();
                                }
                            }}
                            draggable
                            onDragStart={(e) => handleItemDragStart(e, file)}
                            tabIndex={0}
                            role="button"
                            aria-pressed={isSelected}
                        >
                            <ExpressiveShape
                                shape={isSelected ? shapePair.morph : shapePair.rest}
                                morphTo={
                                    enableMorph
                                        ? isSelected
                                            ? shapePair.rest
                                            : shapePair.morph
                                        : undefined
                                }
                                morphOn="hover"
                                width={containerSize}
                                height={containerSize}
                                className={`${shapePair.containerClass} mb-2`}
                            >
                                {!file.isDirectory && isImageFile(file.name) ? (
                                    <img
                                        src={toMediaUrl(file.path)}
                                        alt={file.name}
                                        loading="lazy"
                                        decoding="async"
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                            e.currentTarget.style.display = 'none';
                                        }}
                                    />
                                ) : (
                                    <Icon
                                        name={iconInfo.icon}
                                        size={Math.max(24, Math.round(iconSize * 0.56))}
                                        filled={filledIcons || file.isDirectory}
                                    />
                                )}
                            </ExpressiveShape>

                            <span className="text-xs font-medium text-center leading-tight line-clamp-2 break-all w-full px-1">
                                {file.name}
                            </span>

                            {!file.isDirectory && (
                                <span className="text-[11px] text-m3-on-surface-variant mt-0.5">
                                    {formatFileSize(file.size)}
                                </span>
                            )}
                        </div>
                    </React.Fragment>
                );
            })}
        </div>
        </div>
    );
};
