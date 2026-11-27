import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { List, ListItem } from '@bug-on/m3-expressive';
import type { ListItemPosition } from '@bug-on/m3-expressive/layout';
import { ExpressiveShape } from './ExpressiveShape';
import type { IFile } from '../types/files';
import { Icon } from './Icon';
import {
    formatFileDate,
    formatFileSize,
    formatOriginalParent,
    getFileIconInfo,
    getSemanticGroup,
    isHiddenFile,
    isMediaThumbnailCandidate,
    isVideoEntry,
} from '../utils/fileUtils';
import {
    GRID_GAP_PX,
    GRID_HEADER_HEIGHT,
    buildDisplayEntries,
    buildVirtualGridEntries,
    computeGridColumns,
    getGridCardHeight,
    resolveGridArrowTarget,
    type SortField,
} from '../utils/fileListUtils';
import {
    DROP_ACTIVE_CLASS,
    collectOutboundDragItems,
    type ResolvedDropTarget,
} from '../utils/dropTargetUtils';
import { normalizePath } from '../utils/navigationHistory';
import { getFileGroupShapePair, shouldEnableItemMorph } from '../utils/shapeUtils';
import { toThumbnailUrl } from '../utils/quickLook';
import { useVirtualWindow } from '../hooks/useVirtualWindow';

const useIsomorphicLayoutEffect =
    typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const LIST_TOP_PADDING = 8;
const GRID_TOP_PADDING = 16;
const HEADER_ROW_HEIGHT_WITH_GAP = 38;
const FILE_ROW_HEIGHT = 56;
const FILE_ROW_HEIGHT_WITH_GAP = 58;
const DRAG_CLICK_SUPPRESS_MS = 300;

// eslint-disable-next-line react-refresh/only-export-components
export function shouldSuppressClickAfterDrag(suppressedUntilMs: number, nowMs: number): boolean {
    return nowMs < suppressedUntilMs;
}

// eslint-disable-next-line react-refresh/only-export-components
export function shouldSuppressFileClick(
    isDragging: boolean,
    suppressedUntilMs: number,
    nowMs: number
): boolean {
    return isDragging || shouldSuppressClickAfterDrag(suppressedUntilMs, nowMs);
}

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
    initialScrollTop?: number;
    getInitialScrollTop?: () => number;
    onScrollTopChange?: (scrollTop: number) => void;
    isSearch?: boolean;
    isTrash?: boolean;
    homePath?: string;
    isDragging?: boolean;
    activeDropTarget?: ResolvedDropTarget | null;
    onStartOutboundDrag?: (items: IFile[]) => void;
}

interface FileListRowProps {
    file: IFile;
    fileIndex: number;
    isSelected: boolean;
    isDropTarget: boolean;
    position: ListItemPosition;
    morphEnabled: boolean;
    filledIcons: boolean;
    isTrash: boolean;
    homePath?: string;
    onItemClick: (e: React.MouseEvent, file: IFile) => void;
    onItemPointerDown: () => void;
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

export interface MediaThumbnailProps {
    file: IFile;
    iconName: string;
    iconSize: number;
    filled?: boolean;
    initialFailedPath?: string | null;
}

export const MediaThumbnail: React.FC<MediaThumbnailProps> = ({
    file,
    iconName,
    iconSize,
    filled = false,
    initialFailedPath = null,
}) => {
    const [failedPath, setFailedPath] = useState<string | null>(initialFailedPath);
    const [prevPath, setPrevPath] = useState(file.path);

    if (prevPath !== file.path) {
        setPrevPath(file.path);
        setFailedPath(null);
    }

    if (isMediaThumbnailCandidate(file) && failedPath !== file.path) {
        const isVideo = isVideoEntry(file);
        const playIconSize = Math.max(12, Math.round(iconSize * 0.45));
        return (
            <>
                <img
                    src={toThumbnailUrl(file.path, 'grid')}
                    alt={file.name}
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                    onError={() => setFailedPath(file.path)}
                />
                {isVideo && (
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    >
                        <span className="flex items-center justify-center rounded-full bg-black/50 text-white p-1 shadow-sm">
                            <Icon name="play_arrow" size={playIconSize} filled />
                        </span>
                    </div>
                )}
            </>
        );
    }

    return <Icon name={iconName} size={iconSize} filled={filled} />;
};

const FileListRow: React.FC<FileListRowProps> = React.memo(
    ({
        file,
        fileIndex,
        isSelected,
        isDropTarget,
        position,
        morphEnabled,
        filledIcons,
        isTrash,
        homePath,
        onItemClick,
        onItemPointerDown,
        onNavigate,
        onContextMenu,
        onItemDragStart,
        onItemKeyDown,
    }) => {
        const hidden = isHiddenFile(file.name);
        const iconInfo = getFileIconInfo(file);
        const groupName = getSemanticGroup(file);
        const shapePair = getFileGroupShapePair(groupName, file.isDirectory, file.name, file.mediaKind);
        const fileGroupLabel = file.isDirectory ? 'Folder' : groupName.replace(/s$/, '');

        const leadingContent = (
            <ExpressiveShape
                shape={isSelected ? shapePair.morph : shapePair.rest}
                morphOn="none"
                disabled={!morphEnabled}
                width={32}
                height={32}
                className={shapePair.containerClass}
            >
                <MediaThumbnail
                    file={file}
                    iconName={iconInfo.icon}
                    iconSize={18}
                    filled={filledIcons || file.isDirectory}
                />
            </ExpressiveShape>
        );

        const trailingContent = isTrash ? (
            <div className="file-meta-grid-trash items-center text-xs text-m3-on-surface-variant">
                <span className="hidden sm:block truncate" title={file.originalParent}>
                    {formatOriginalParent(file.originalParent, homePath)}
                </span>
                <span className="hidden md:block truncate">
                    {formatFileDate(file.mtime)}
                </span>
                <span className="hidden lg:block truncate">{fileGroupLabel}</span>
                <span className="text-right tabular-nums">
                    {file.isDirectory ? '—' : formatFileSize(file.size)}
                </span>
            </div>
        ) : (
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
                    data-drop-folder-path={!isTrash && file.isDirectory ? file.path : undefined}
                    data-drop-active={isDropTarget ? 'true' : undefined}
                    draggable={!isTrash}
                    onPointerDown={onItemPointerDown}
                    onDragStart={(e) => onItemDragStart(e, file)}
                    onClick={(e) => onItemClick(e, file)}
                    onDoubleClick={() => onNavigate(file)}
                    onContextMenu={(e) => onContextMenu?.(e, file)}
                    onKeyDown={(e) => onItemKeyDown(e, file, fileIndex)}
                    className={`file-list-item h-14 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-m3-primary ${
                        isDropTarget ? DROP_ACTIVE_CLASS : ''
                    }`}
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
    initialScrollTop = 0,
    getInitialScrollTop,
    onScrollTopChange,
    isSearch = false,
    isTrash = false,
    homePath,
    isDragging = false,
    activeDropTarget = null,
    onStartOutboundDrag,
}) => {
    const sortedFiles = files;

    const listRootRef = useRef<HTMLDivElement>(null);
    const localScrollRef = useRef<HTMLDivElement>(null);
    const activeScrollRef = scrollContainerRef ?? localScrollRef;
    const pendingFocusPathRef = useRef<string | null>(null);
    const isProgrammaticScrollRef = useRef(false);
    const suppressClickUntilRef = useRef<number>(0);
    const prevIsDraggingRef = useRef(Boolean(isDragging));
    const [containerWidth, setContainerWidth] = useState(800);
    const [widthMeasured, setWidthMeasured] = useState(false);

    const rebindKey = `${viewMode}-${sortedFiles.length > 0}`;
    const isList = viewMode === 'list';

    useIsomorphicLayoutEffect(() => {
        const scroller = activeScrollRef.current;
        if (!scroller) return;

        const updateWidth = () => {
            if (scroller.clientWidth > 0) {
                setContainerWidth(scroller.clientWidth);
                setWidthMeasured(true);
            }
        };

        updateWidth();
        const resizeObserver =
            typeof ResizeObserver !== 'undefined'
                ? new ResizeObserver(() => {
                      updateWidth();
                  })
                : null;
        resizeObserver?.observe(scroller);

        return () => {
            resizeObserver?.disconnect();
        };
    }, [activeScrollRef, rebindKey]);

    const resolveInitialScrollTop = useCallback(
        () => (getInitialScrollTop ? getInitialScrollTop() : initialScrollTop),
        [getInitialScrollTop, initialScrollTop]
    );

    const markProgrammaticScroll = useCallback(() => {
        isProgrammaticScrollRef.current = true;
    }, []);

    const columnCount = useMemo(
        () => computeGridColumns(containerWidth, iconSize, GRID_GAP_PX),
        [containerWidth, iconSize]
    );
    const gridCardHeight = getGridCardHeight(iconSize);

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

    const gridLayout = useMemo(
        () =>
            buildVirtualGridEntries(
                sortedFiles,
                Boolean(groupingEnabled),
                columnCount,
                iconSize,
                GRID_GAP_PX
            ),
        [sortedFiles, groupingEnabled, columnCount, iconSize]
    );

    const getVirtualEntryHeight = useCallback(
        (index: number) => {
            if (isList) {
                return displayEntries[index]?.kind === 'header'
                    ? HEADER_ROW_HEIGHT_WITH_GAP
                    : FILE_ROW_HEIGHT_WITH_GAP;
            }
            return gridLayout.entries[index]?.height ?? gridCardHeight + GRID_GAP_PX;
        },
        [isList, displayEntries, gridLayout.entries, gridCardHeight]
    );

    const scrollRestoreReady = isList || widthMeasured;

    const { startIndex, endIndex, topSpacerHeight, bottomSpacerHeight, offsets } = useVirtualWindow({
        containerRef: activeScrollRef,
        itemCount: isList ? displayEntries.length : gridLayout.entries.length,
        getItemHeight: getVirtualEntryHeight,
        overscan: isList ? 6 : 3,
        topOffset: isList ? LIST_TOP_PADDING : GRID_TOP_PADDING,
        fallbackHeight: 600,
        gapPx: isList ? 2 : GRID_GAP_PX,
        rebindKey,
        getInitialScrollTop: resolveInitialScrollTop,
        scrollRestoreReady,
        onProgrammaticScroll: markProgrammaticScroll,
    });

    const latestRef = useRef({
        selectedFiles,
        sortedFiles,
        onSelect,
        onNavigate,
        onContextMenu,
        onScrollTopChange,
        onStartOutboundDrag,
        isDragging: Boolean(isDragging),
        isTrash,
        offsets,
        fileIndexToEntryIndex,
        gridEntries: gridLayout.entries,
        gridFileIndexToRowIndex: gridLayout.fileIndexToRowIndex,
        isList,
        scrollRestoreReady,
        gridCardHeight,
        scrollEl: null as HTMLDivElement | null,
    });

    useIsomorphicLayoutEffect(() => {
        latestRef.current = {
            selectedFiles,
            sortedFiles,
            onSelect,
            onNavigate,
            onContextMenu,
            onScrollTopChange,
            onStartOutboundDrag,
            // Hold true across the true -> false commit gap until useEffect arms suppressClickUntilRef
            isDragging: latestRef.current.isDragging || Boolean(isDragging),
            isTrash,
            offsets,
            fileIndexToEntryIndex,
            gridEntries: gridLayout.entries,
            gridFileIndexToRowIndex: gridLayout.fileIndexToRowIndex,
            isList,
            scrollRestoreReady,
            gridCardHeight,
            scrollEl: activeScrollRef.current,
        };
    });

    useEffect(() => {
        const dragging = Boolean(isDragging);
        if (prevIsDraggingRef.current && !dragging) {
            suppressClickUntilRef.current = Date.now() + DRAG_CLICK_SUPPRESS_MS;
        }
        prevIsDraggingRef.current = dragging;
        latestRef.current.isDragging = dragging;
    }, [isDragging]);

    const selectedArray = useMemo(() => Array.from(selectedFiles), [selectedFiles]);

    // Clear pending keyboard focus target when directory contents change
    const directorySignature = sortedFiles[0]?.path ?? '';
    useEffect(() => {
        pendingFocusPathRef.current = null;
    }, [directorySignature]);

    // Report scroll position continuously and clear pending keyboard focus target on manual scroll
    useEffect(() => {
        const scroller = activeScrollRef.current;
        if (!scroller) return;

        const handleScroll = () => {
            if (latestRef.current.scrollRestoreReady) {
                latestRef.current.onScrollTopChange?.(scroller.scrollTop);
            }
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
    }, [activeScrollRef, rebindKey]);

    // Restore keyboard focus once virtualized row mounts after scroll
    useIsomorphicLayoutEffect(() => {
        const pendingPath = pendingFocusPathRef.current;
        if (!pendingPath) return;
        if (focusFileRowByPath(listRootRef.current, pendingPath)) {
            pendingFocusPathRef.current = null;
        }
    }, [startIndex, endIndex, displayEntries, gridLayout.entries]);

    const handleItemPointerDown = useCallback(() => {
        suppressClickUntilRef.current = 0;
    }, []);

    const handleItemClick = useCallback((e: React.MouseEvent, file: IFile) => {
        if (
            shouldSuppressFileClick(
                Boolean(latestRef.current.isDragging),
                suppressClickUntilRef.current,
                Date.now()
            )
        ) {
            suppressClickUntilRef.current = 0;
            return;
        }
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
        const {
            sortedFiles: currentFiles,
            selectedFiles: currentSelected,
            onSelect: select,
            onStartOutboundDrag: startOutboundDrag,
            isTrash: currentIsTrash,
        } = latestRef.current;
        if (currentIsTrash) return;
        suppressClickUntilRef.current = Date.now() + DRAG_CLICK_SUPPRESS_MS;
        const dragItems = collectOutboundDragItems(file, currentFiles, currentSelected);
        if (!currentSelected.has(file.path)) {
            select(file, false, false);
        }
        startOutboundDrag?.(dragItems);
    }, []);

    const handleItemKeyDown = useCallback(
        (e: React.KeyboardEvent, file: IFile, fileIndex: number) => {
            const {
                onNavigate: navigate,
                sortedFiles: currentFiles,
                offsets: currentOffsets,
                fileIndexToEntryIndex: entryMap,
                gridEntries: currentGridEntries,
                gridFileIndexToRowIndex: gridRowMap,
                isList: currentIsList,
                gridCardHeight: cardHeight,
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
            if (currentIsList) {
                if (e.key === 'ArrowDown') {
                    nextFileIndex = Math.min(currentFiles.length - 1, fileIndex + 1);
                } else if (e.key === 'ArrowUp') {
                    nextFileIndex = Math.max(0, fileIndex - 1);
                } else if (e.key === 'Home') {
                    nextFileIndex = 0;
                } else if (e.key === 'End') {
                    nextFileIndex = currentFiles.length - 1;
                }
            } else {
                nextFileIndex = resolveGridArrowTarget(
                    currentGridEntries,
                    gridRowMap,
                    fileIndex,
                    e.key,
                    currentFiles.length
                );
            }

            if (nextFileIndex === -1) return;

            e.preventDefault();
            e.stopPropagation();

            const nextFile = currentFiles[nextFileIndex];
            if (!nextFile) return;

            pendingFocusPathRef.current = nextFile.path;

            const entryIdx = currentIsList
                ? entryMap.get(nextFileIndex)
                : gridRowMap[nextFileIndex];
            if (scroller && entryIdx !== undefined) {
                const topPad = currentIsList ? LIST_TOP_PADDING : GRID_TOP_PADDING;
                const rowHeight = currentIsList ? FILE_ROW_HEIGHT : cardHeight;
                const rowTop = topPad + (currentOffsets[entryIdx] ?? 0);
                const rowBottom = rowTop + rowHeight;
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
        const emptyIcon = isSearch
            ? 'search_off'
            : isTrash
                ? 'delete_outline'
                : 'folder_open';
        const emptyTitle = isSearch
            ? 'No matching files found'
            : isTrash
                ? 'Trash is empty'
                : 'This folder is empty';
        const emptySubtitle = isSearch
            ? 'Try a different keyword or clear the search filter.'
            : isTrash
                ? 'Items moved to the trash will appear here.'
                : 'Drop files here or use the action menu to create a new folder.';

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
                    <Icon name={emptyIcon} size={42} />
                </ExpressiveShape>
                <div className="text-lg font-medium text-m3-on-surface mb-1">
                    {emptyTitle}
                </div>
                <div className="text-sm text-m3-on-surface-variant max-w-sm">
                    {emptySubtitle}
                </div>
            </div>
        );
    }

    const activeFileListDropPath =
        !isTrash &&
        activeDropTarget?.kind === 'folder' &&
        activeDropTarget.source === 'filelist'
            ? normalizePath(activeDropTarget.path)
            : null;

    if (isList) {
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
                    <div className={`${isTrash ? 'file-meta-grid-trash' : 'file-meta-grid'} items-center shrink-0 text-xs font-medium text-m3-on-surface-variant`}>
                        {isTrash && (
                            <span className="hidden sm:flex items-center truncate">
                                Original Location
                            </span>
                        )}
                        <button
                            type="button"
                            aria-sort={getAriaSort('date')}
                            onClick={(e) => {
                                e.stopPropagation();
                                onSortChange?.('date');
                            }}
                            className="hidden md:flex items-center gap-1 min-w-0 truncate text-left hover:text-m3-on-surface transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-m3-primary rounded-sm"
                        >
                            <span className="truncate">{isTrash ? 'Date Deleted' : 'Date Modified'}</span>
                            {renderSortIcon('date')}
                        </button>
                        <button
                            type="button"
                            aria-sort={getAriaSort('type')}
                            onClick={(e) => {
                                e.stopPropagation();
                                onSortChange?.('type');
                            }}
                            className={`${isTrash ? 'hidden lg:flex' : 'hidden sm:flex'} items-center gap-1 min-w-0 truncate text-left hover:text-m3-on-surface transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-m3-primary rounded-sm`}
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
                    data-drop-scroll-container="true"
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
                        const isDropTarget =
                            !isTrash &&
                            entry.file.isDirectory &&
                            activeFileListDropPath !== null &&
                            normalizePath(entry.file.path) === activeFileListDropPath;
                        return (
                            <FileListRow
                                key={entry.key}
                                file={entry.file}
                                fileIndex={entry.fileIndex}
                                isSelected={isSelected}
                                isDropTarget={isDropTarget}
                                position={entry.position}
                                morphEnabled={shouldEnableItemMorph(
                                    sortedFiles.length,
                                    isSelected
                                )}
                                filledIcons={filledIcons}
                                isTrash={isTrash}
                                homePath={homePath}
                                onItemClick={handleItemClick}
                                onItemPointerDown={handleItemPointerDown}
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

    const visibleGridEntries =
        endIndex >= startIndex ? gridLayout.entries.slice(startIndex, endIndex + 1) : [];
    const containerSize = iconSize + 16;

    return (
        <div ref={listRootRef} className="flex flex-col flex-1 min-h-0 w-full bg-m3-surface-container-low">
            <div
                ref={activeScrollRef}
                data-drop-scroll-container="true"
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-m3-surface-container-low"
            >
                <div className="grid content-start gap-3 p-4 pb-24 min-h-full bg-m3-surface-container-low">
                    {topSpacerHeight > 0 && (
                        <div
                            role="presentation"
                            aria-hidden="true"
                            className="shrink-0 pointer-events-none"
                            style={{ height: topSpacerHeight }}
                        />
                    )}
                    {visibleGridEntries.map((entry) => {
                        if (entry.kind === 'header') {
                            return (
                                <div
                                    key={entry.key}
                                    className="flex items-center shrink-0 select-none"
                                    style={{ height: GRID_HEADER_HEIGHT }}
                                >
                                    <span className="px-3 py-1 rounded-full bg-m3-secondary-container text-m3-on-secondary-container text-xs font-semibold">
                                        {entry.group}
                                    </span>
                                </div>
                            );
                        }

                        return (
                            <div
                                key={entry.key}
                                className="grid gap-3 shrink-0"
                                style={{
                                    gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                                    height: gridCardHeight,
                                }}
                            >
                                {entry.items.map((file, colIdx) => {
                                    const fileIndex = entry.startIndex + colIdx;
                                    const isSelected = selectedFiles.has(file.path);
                                    const isDropTarget =
                                        !isTrash &&
                                        file.isDirectory &&
                                        activeFileListDropPath !== null &&
                                        normalizePath(file.path) === activeFileListDropPath;
                                    const hidden = isHiddenFile(file.name);
                                    const iconInfo = getFileIconInfo(file);
                                    const groupName = getSemanticGroup(file);
                                    const shapePair = getFileGroupShapePair(
                                        groupName,
                                        file.isDirectory,
                                        file.name,
                                        file.mediaKind
                                    );
                                    const enableMorph = shouldEnableItemMorph(
                                        sortedFiles.length,
                                        isSelected
                                    );

                                    return (
                                        <div
                                            key={file.path}
                                            data-file-path={file.path}
                                            data-drop-folder-path={!isTrash && file.isDirectory ? file.path : undefined}
                                            data-drop-active={isDropTarget ? 'true' : undefined}
                                            className={`file-list-item group relative flex flex-col items-center h-full p-2.5 rounded-m3-lg transition-colors cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-m3-primary ${
                                                isDropTarget
                                                    ? `${DROP_ACTIVE_CLASS} text-m3-on-surface`
                                                    : isSelected
                                                        ? 'bg-m3-secondary-container text-m3-on-secondary-container'
                                                        : 'hover:bg-m3-surface-container-high text-m3-on-surface'
                                            } ${hidden ? 'opacity-60' : ''}`}
                                            title={file.name}
                                            onPointerDown={handleItemPointerDown}
                                            onClick={(e) => handleItemClick(e, file)}
                                            onDoubleClick={() => onNavigate(file)}
                                            onContextMenu={(e) => onContextMenu?.(e, file)}
                                            onKeyDown={(e) => handleItemKeyDown(e, file, fileIndex)}
                                            draggable={!isTrash}
                                            onDragStart={(e) => handleItemDragStart(e, file)}
                                            tabIndex={0}
                                            role="button"
                                            aria-pressed={isSelected}
                                        >
                                            <ExpressiveShape
                                                shape={isSelected ? shapePair.morph : shapePair.rest}
                                                morphOn="none"
                                                disabled={!enableMorph}
                                                width={containerSize}
                                                height={containerSize}
                                                className={`${shapePair.containerClass} mb-2 shrink-0`}
                                            >
                                                <MediaThumbnail
                                                    file={file}
                                                    iconName={iconInfo.icon}
                                                    iconSize={Math.max(24, Math.round(iconSize * 0.56))}
                                                    filled={filledIcons || file.isDirectory}
                                                />
                                            </ExpressiveShape>

                                            <span className="h-[30px] overflow-hidden text-xs font-medium text-center leading-tight line-clamp-2 break-all w-full px-1">
                                                {file.name}
                                            </span>

                                            <span
                                                className="h-[18px] text-[11px] text-m3-on-surface-variant mt-0.5 truncate max-w-full px-1"
                                                title={isTrash ? file.originalParent : undefined}
                                            >
                                                {isTrash
                                                    ? formatOriginalParent(file.originalParent, homePath)
                                                    : !file.isDirectory
                                                        ? formatFileSize(file.size)
                                                        : ''}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                    {bottomSpacerHeight > 0 && (
                        <div
                            role="presentation"
                            aria-hidden="true"
                            className="shrink-0 pointer-events-none"
                            style={{ height: bottomSpacerHeight }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};
