import React from 'react';
import {
    MD3Table,
    MD3TableBody,
    MD3TableCell,
    MD3TableHead,
    MD3TableHeaderCell,
    MD3TableRow,
    MD3TableSortIndicator,
    ShapeMedia,
} from '@bug-on/m3-expressive';
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
import { getFileGroupShapePair, shouldEnableItemMorph } from '../utils/shapeUtils';
import { toMediaUrl } from '../utils/quickLook';

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
    sortBy?: 'name' | 'size' | 'date';
    sortOrder?: 'asc' | 'desc';
    onSortChange?: (field: 'name' | 'size' | 'date') => void;
    isSearch?: boolean;
}

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
    isSearch = false,
}) => {
    if (files.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full min-h-[300px] px-6 py-12 text-center select-none">
                <ShapeMedia
                    shape="clover4Leaf"
                    morphTo="flower"
                    morphOn="hover"
                    width={88}
                    height={88}
                    className="bg-m3-secondary-container text-m3-on-secondary-container flex items-center justify-center mb-4"
                >
                    <Icon name={isSearch ? 'search_off' : 'folder_open'} size={42} />
                </ShapeMedia>
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

    const sortedFiles = files;

    const handleItemClick = (e: React.MouseEvent, file: IFile) => {
        const isModifier = e.ctrlKey || e.metaKey || e.shiftKey;
        const isSelected = selectedFiles.has(file.path);
        if (!isModifier && isSelected) {
            onNavigate(file);
        } else {
            onSelect(file, e.ctrlKey || e.metaKey, e.shiftKey);
        }
    };

    const handleItemDragStart = (e: React.DragEvent, file: IFile) => {
        e.preventDefault();
        if (api && api.startDrag) {
            api.startDrag(file.path, file.path);
        }
    };

    if (viewMode === 'list') {
        return (
            <div className="w-full px-3 py-2">
                <MD3Table density="compact" className="w-full">
                    <MD3TableHead sticky>
                        <MD3TableRow hoverable={false}>
                            <MD3TableHeaderCell className="w-12" aria-label="Type icon" />
                            <MD3TableHeaderCell
                                sortDirection={sortBy === 'name' ? sortOrder : false}
                                onSort={() => onSortChange?.('name')}
                                className="cursor-pointer select-none"
                            >
                                <span className="inline-flex items-center gap-1">
                                    Name
                                    <MD3TableSortIndicator
                                        sortDirection={sortBy === 'name' ? sortOrder : false}
                                    />
                                </span>
                            </MD3TableHeaderCell>
                            <MD3TableHeaderCell
                                sortDirection={sortBy === 'date' ? sortOrder : false}
                                onSort={() => onSortChange?.('date')}
                                className="w-40 cursor-pointer select-none"
                            >
                                <span className="inline-flex items-center gap-1">
                                    Date Modified
                                    <MD3TableSortIndicator
                                        sortDirection={sortBy === 'date' ? sortOrder : false}
                                    />
                                </span>
                            </MD3TableHeaderCell>
                            <MD3TableHeaderCell className="w-28 select-none">
                                Type
                            </MD3TableHeaderCell>
                            <MD3TableHeaderCell
                                numeric
                                sortDirection={sortBy === 'size' ? sortOrder : false}
                                onSort={() => onSortChange?.('size')}
                                className="w-28 cursor-pointer select-none"
                            >
                                <span className="inline-flex items-center justify-end gap-1 w-full">
                                    Size
                                    <MD3TableSortIndicator
                                        sortDirection={sortBy === 'size' ? sortOrder : false}
                                    />
                                </span>
                            </MD3TableHeaderCell>
                        </MD3TableRow>
                    </MD3TableHead>
                    <MD3TableBody>
                        {sortedFiles.map((file, index) => {
                            const currentGroup = groupingEnabled ? getSemanticGroup(file) : '';
                            const prevGroup =
                                groupingEnabled && index > 0
                                    ? getSemanticGroup(sortedFiles[index - 1])
                                    : '';
                            const showHeader = Boolean(groupingEnabled && currentGroup !== prevGroup);

                            const isSelected = selectedFiles.has(file.path);
                            const hidden = isHiddenFile(file.name);
                            const iconInfo = getFileIconInfo(file);
                            const groupName = getSemanticGroup(file);
                            const shapePair = getFileGroupShapePair(groupName, file.isDirectory, file.name);
                            const enableMorph = shouldEnableItemMorph(sortedFiles.length, isSelected);
                            const fileGroupLabel = file.isDirectory
                                ? 'Folder'
                                : groupName.replace(/s$/, '');

                            return (
                                <React.Fragment key={file.path}>
                                    {showHeader && (
                                        <MD3TableRow hoverable={false}>
                                            <MD3TableCell colSpan={5} className="!py-2 !bg-transparent">
                                                <div className="flex items-center gap-3">
                                                    <span className="px-3 py-0.5 rounded-full bg-m3-secondary-container/70 text-m3-on-secondary-container text-xs font-semibold">
                                                        {currentGroup}
                                                    </span>
                                                    <div className="h-px flex-1 bg-m3-outline-variant/40" />
                                                </div>
                                            </MD3TableCell>
                                        </MD3TableRow>
                                    )}
                                    <MD3TableRow
                                        selected={isSelected}
                                        className={`file-list-item cursor-pointer select-none transition-colors ${
                                            hidden ? 'opacity-60' : ''
                                        }`}
                                        onClick={(e) => handleItemClick(e, file)}
                                        onDoubleClick={() => onNavigate(file)}
                                        onContextMenu={(e) => onContextMenu?.(e, file)}
                                        draggable
                                        onDragStart={(e) => handleItemDragStart(e, file)}
                                    >
                                        <MD3TableCell className="w-12">
                                            <ShapeMedia
                                                shape={isSelected ? shapePair.morph : shapePair.rest}
                                                morphTo={
                                                    enableMorph
                                                        ? isSelected
                                                            ? shapePair.rest
                                                            : shapePair.morph
                                                        : undefined
                                                }
                                                morphOn="hover"
                                                width={32}
                                                height={32}
                                                className={`${shapePair.containerClass} flex items-center justify-center overflow-hidden`}
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
                                            </ShapeMedia>
                                        </MD3TableCell>
                                        <MD3TableCell className="font-medium text-m3-on-surface max-w-[360px] truncate">
                                            {file.name}
                                        </MD3TableCell>
                                        <MD3TableCell className="text-m3-on-surface-variant text-xs whitespace-nowrap">
                                            {formatFileDate(file.mtime)}
                                        </MD3TableCell>
                                        <MD3TableCell className="text-m3-on-surface-variant text-xs">
                                            {fileGroupLabel}
                                        </MD3TableCell>
                                        <MD3TableCell numeric className="text-m3-on-surface-variant text-xs">
                                            {file.isDirectory ? '—' : formatFileSize(file.size)}
                                        </MD3TableCell>
                                    </MD3TableRow>
                                </React.Fragment>
                            );
                        })}
                    </MD3TableBody>
                </MD3Table>
            </div>
        );
    }

    return (
        <div
            className="grid gap-3 p-4 pb-24"
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
                                className="flex items-center gap-3 col-span-full"
                                style={{ marginTop: index > 0 ? '12px' : '2px' }}
                            >
                                <span className="px-3 py-1 rounded-full bg-m3-secondary-container/70 text-m3-on-secondary-container text-xs font-semibold">
                                    {currentGroup}
                                </span>
                                <div className="h-px flex-1 bg-m3-outline-variant/40" />
                            </div>
                        )}
                        <div
                            className={`file-list-item group relative flex flex-col items-center p-2.5 rounded-m3-lg transition-all cursor-pointer select-none ${
                                isSelected
                                    ? 'bg-m3-secondary-container text-m3-on-secondary-container ring-2 ring-m3-primary/50'
                                    : 'hover:bg-m3-surface-container-high text-m3-on-surface'
                            } ${hidden ? 'opacity-60' : ''}`}
                            title={file.name}
                            onClick={(e) => handleItemClick(e, file)}
                            onDoubleClick={() => onNavigate(file)}
                            onContextMenu={(e) => onContextMenu?.(e, file)}
                            draggable
                            onDragStart={(e) => handleItemDragStart(e, file)}
                            tabIndex={0}
                            role="button"
                        >
                            <ShapeMedia
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
                                className={`${shapePair.containerClass} flex items-center justify-center overflow-hidden mb-2 shadow-xs`}
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
                            </ShapeMedia>

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
    );
};
