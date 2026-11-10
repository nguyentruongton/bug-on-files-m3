import React from 'react';
import type { IFile } from '../types/files';
import { Icon } from './Icon';
import './FileList.css';
import {
    getSemanticGroup,
    getFileIconInfo,
    isHiddenFile,
    isImageFile,
    formatFileSize,
    formatFileDate,
} from '../utils/fileUtils';

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
            <div className="file-list-empty">
                <Icon
                    name={isSearch ? 'search_off' : 'folder_open'}
                    size={56}
                    className="file-list-empty-icon"
                />
                <div className="file-list-empty-title">
                    {isSearch ? 'No matching files found' : 'This folder is empty'}
                </div>
                <div className="file-list-empty-subtitle">
                    {isSearch
                        ? 'Try a different keyword or clear the search filter.'
                        : 'Drop files here or right-click to create a new folder.'}
                </div>
            </div>
        );
    }

    const sortedFiles = files;
    const listIconColWidth = Math.min(48, Math.max(36, Math.round(iconSize * 0.65) + 12));
    const listIconRenderSize = Math.min(32, Math.max(20, Math.round(iconSize * 0.45)));
    const listColumnsTemplate = `${listIconColWidth}px minmax(180px, 1fr) 156px 110px 96px`;

    const renderSortArrow = (field: 'name' | 'size' | 'date') => {
        if (sortBy !== field) return null;
        return (
            <Icon
                name={sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                size={14}
                className="file-list-sort-icon"
            />
        );
    };

    return (
        <div
            className={`file-list ${viewMode}`}
            style={{
                gridTemplateColumns:
                    viewMode === 'grid'
                        ? `repeat(auto-fill, minmax(${Math.max(112, iconSize + 48)}px, 1fr))`
                        : '1fr',
            }}
        >
            {viewMode === 'list' && (
                <div
                    className="file-list-header"
                    style={{ gridTemplateColumns: listColumnsTemplate }}
                >
                    <span className="file-list-header-spacer" />
                    <button
                        type="button"
                        className={`file-list-header-cell ${sortBy === 'name' ? 'active' : ''}`}
                        onClick={() => onSortChange?.('name')}
                    >
                        <span>Name</span>
                        {renderSortArrow('name')}
                    </button>
                    <button
                        type="button"
                        className={`file-list-header-cell ${sortBy === 'date' ? 'active' : ''}`}
                        onClick={() => onSortChange?.('date')}
                    >
                        <span>Date Modified</span>
                        {renderSortArrow('date')}
                    </button>
                    <span className="file-list-header-cell static">Type</span>
                    <button
                        type="button"
                        className={`file-list-header-cell align-right ${sortBy === 'size' ? 'active' : ''}`}
                        onClick={() => onSortChange?.('size')}
                    >
                        <span>Size</span>
                        {renderSortArrow('size')}
                    </button>
                </div>
            )}

            {sortedFiles.map((file, index) => {
                const currentGroup = groupingEnabled ? getSemanticGroup(file) : '';
                const prevGroup = groupingEnabled && index > 0 ? getSemanticGroup(sortedFiles[index - 1]) : '';
                const showHeader = Boolean(groupingEnabled && currentGroup !== prevGroup);

                const hidden = isHiddenFile(file.name);
                const iconInfo = getFileIconInfo(file);
                const effectiveIconSize = viewMode === 'list' ? listIconRenderSize : iconSize;
                const fileGroupLabel = file.isDirectory ? 'Folder' : getSemanticGroup(file).replace(/s$/, '');

                return (
                    <React.Fragment key={file.path}>
                        {showHeader && (
                            <div
                                className="file-group-header"
                                style={{
                                    gridColumn: '1 / -1',
                                    marginTop: index > 0 ? '16px' : '4px',
                                }}
                            >
                                <span>{currentGroup}</span>
                            </div>
                        )}
                        <div
                            className={`file-list-item ${selectedFiles.has(file.path) ? 'selected' : ''} ${hidden ? 'is-hidden' : ''}`}
                            title={file.name}
                            onClick={(e) => {
                                const isModifier = e.ctrlKey || e.metaKey || e.shiftKey;
                                const isSelected = selectedFiles.has(file.path);

                                if (!isModifier && isSelected) {
                                    onNavigate(file);
                                } else {
                                    onSelect(file, e.ctrlKey || e.metaKey, e.shiftKey);
                                }
                            }}
                            onDoubleClick={() => onNavigate(file)}
                            onContextMenu={(e) => onContextMenu && onContextMenu(e, file)}
                            draggable={true}
                            onDragStart={(e) => {
                                e.preventDefault();
                                if (window.electron && window.electron.startDrag) {
                                    window.electron.startDrag(file.path, file.path);
                                }
                            }}
                            tabIndex={0}
                            role="button"
                            style={
                                viewMode === 'list'
                                    ? {
                                          gridTemplateColumns: listColumnsTemplate,
                                          height: '44px',
                                      }
                                    : undefined
                            }
                        >
                            <span
                                className="file-icon"
                                style={{
                                    width: `${effectiveIconSize}px`,
                                    height: `${effectiveIconSize}px`,
                                    fontSize: `${effectiveIconSize}px`,
                                }}
                            >
                                {!file.isDirectory && isImageFile(file.name) ? (
                                    <img
                                        src={`media://${file.path}`}
                                        alt={file.name}
                                        loading="lazy"
                                        decoding="async"
                                        className="file-thumbnail"
                                        onError={(e) => {
                                            e.currentTarget.style.display = 'none';
                                        }}
                                        style={{
                                            width: viewMode === 'list' ? `${effectiveIconSize}px` : '100%',
                                            height: viewMode === 'list' ? `${effectiveIconSize}px` : '100%',
                                        }}
                                    />
                                ) : (
                                    <Icon
                                        name={iconInfo.icon}
                                        filled={filledIcons || file.isDirectory}
                                        className={iconInfo.colorClass}
                                        style={{ fontSize: `${effectiveIconSize}px` }}
                                    />
                                )}
                            </span>
                            <span className="file-name">{file.name}</span>
                            {viewMode === 'list' && (
                                <>
                                    <span className="file-date">{formatFileDate(file.mtime)}</span>
                                    <span className="file-type">{fileGroupLabel}</span>
                                </>
                            )}
                            <span className="file-size">
                                {file.isDirectory ? '—' : formatFileSize(file.size)}
                            </span>
                        </div>
                    </React.Fragment>
                );
            })}
        </div>
    );
};
