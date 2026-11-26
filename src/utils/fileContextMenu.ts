import type { ContextMenuItem } from '../components/ContextMenu';
import type { IFile } from '../types/files';
import { getArchiveStem } from './archiveUtils';

export type ToastSeverity = 'success' | 'info' | 'error';

export interface FileContextMenuParams {
  item: IFile | null;
  targetItems: IFile[];
  isTrashView: boolean;
  currentPath: string;
  hasClipboardFiles: boolean;
  allSelectedAreArchives: boolean;
  onOpenFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
  onOpenInNewTab: (path: string) => void;
  onOpenInTerminal: (item: IFile) => void;
  onCopyPath: (path: string) => void;
  onCopy: (items: IFile[]) => void;
  onCut: (items: IFile[]) => void;
  onDelete: (items: IFile[]) => void;
  onExtractHere: (items: IFile[]) => void;
  onExtractToOwnFolder: (items: IFile[]) => void;
  onExtractToDir: (items: IFile[]) => void;
  onCompress: (items: IFile[]) => void;
  onRename: (item: IFile) => void;
  onOpenWith: (item: IFile) => void;
  onProperties: (item: IFile) => void;
  onRestore: (items: IFile[]) => void;
  onPurge: (items: IFile[]) => void;
  onEmptyTrash: () => void;
  onNewFolder: () => void;
  onPaste: () => void;
}

export async function copyPathToClipboard(
  path: string,
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
  showToast: (message: string, severity: ToastSeverity) => void
): Promise<void> {
  if (!clipboard?.writeText) {
    showToast('Failed to copy path', 'error');
    return;
  }
  try {
    await clipboard.writeText(path);
    showToast('Path copied', 'info');
  } catch {
    showToast('Failed to copy path', 'error');
  }
}

export function buildFileContextMenuItems(params: FileContextMenuParams): ContextMenuItem[] {
  const {
    item,
    targetItems,
    isTrashView,
    currentPath,
    hasClipboardFiles,
    allSelectedAreArchives,
    onOpenFolder,
    onOpenFile,
    onOpenInNewTab,
    onOpenInTerminal,
    onCopyPath,
    onCopy,
    onCut,
    onDelete,
    onExtractHere,
    onExtractToOwnFolder,
    onExtractToDir,
    onCompress,
    onRename,
    onOpenWith,
    onProperties,
    onRestore,
    onPurge,
    onEmptyTrash,
    onNewFolder,
    onPaste,
  } = params;

  const selectionSuffix = targetItems.length > 1 ? ` (${targetItems.length})` : '';

  if (item) {
    if (isTrashView) {
      return [
        {
          label: `Restore${selectionSuffix}`,
          icon: 'restore_from_trash',
          action: () => onRestore(targetItems),
        },
        {
          label: `Delete Permanently${selectionSuffix}`,
          icon: 'delete_forever',
          action: () => onPurge(targetItems),
        },
        { divider: true, label: '', action: () => {} },
        {
          label: 'Properties',
          icon: 'info',
          action: () => onProperties(item),
        },
      ];
    }

    return [
      {
        label: 'Open',
        icon: 'open_in_new',
        action: () => (item.isDirectory ? onOpenFolder(item.path) : onOpenFile(item.path)),
      },
      ...(targetItems.length === 1 && item.isDirectory
        ? [
            {
              label: 'Open in New Tab',
              icon: 'tab_new_right',
              action: () => onOpenInNewTab(item.path),
            },
          ]
        : []),
      {
        label: 'Open in Terminal',
        icon: 'terminal',
        action: () => onOpenInTerminal(item),
      },
      { divider: true, label: '', action: () => {} },
      ...(targetItems.length === 1
        ? [
            {
              label: 'Copy Path',
              icon: 'content_paste_go',
              action: () => onCopyPath(item.path),
            },
          ]
        : []),
      {
        label: `Copy${selectionSuffix}`,
        icon: 'content_copy',
        action: () => onCopy(targetItems),
      },
      {
        label: `Cut${selectionSuffix}`,
        icon: 'content_cut',
        action: () => onCut(targetItems),
      },
      {
        label: `Delete${selectionSuffix}`,
        icon: 'delete',
        action: () => onDelete(targetItems),
      },
      ...(allSelectedAreArchives
        ? [
            {
              label: `Extract Here${selectionSuffix}`,
              icon: 'unarchive',
              action: () => onExtractHere(targetItems),
            },
            {
              label:
                targetItems.length === 1
                  ? `Extract to "${getArchiveStem(targetItems[0].name)}/"`
                  : `Extract Each to Own Folder (${targetItems.length})`,
              icon: 'drive_file_move',
              action: () => onExtractToOwnFolder(targetItems),
            },
            {
              label: 'Extract to...',
              icon: 'folder_open',
              action: () => onExtractToDir(targetItems),
            },
          ]
        : []),
      ...(targetItems.length > 0
        ? [
            {
              label: `Compress${selectionSuffix}...`,
              icon: 'folder_zip',
              action: () => onCompress(targetItems),
            },
          ]
        : []),
      {
        label: 'Rename',
        icon: 'edit',
        action: () => onRename(item),
      },
      { divider: true, label: '', action: () => {} },
      {
        label: 'Open With...',
        icon: 'apps',
        action: () => onOpenWith(item),
      },
      {
        label: 'Properties',
        icon: 'info',
        action: () => onProperties(item),
      },
    ];
  }

  if (isTrashView) {
    return [
      {
        label: 'Empty Trash',
        icon: 'delete_forever',
        action: onEmptyTrash,
      },
    ];
  }

  const isExplorerDir = Boolean(currentPath && !currentPath.startsWith('app://'));
  return [
    ...(isExplorerDir
      ? [{ label: 'New Folder', icon: 'create_new_folder', action: onNewFolder }]
      : []),
    ...(hasClipboardFiles && isExplorerDir
      ? [{ label: 'Paste', icon: 'content_paste', action: onPaste }]
      : []),
  ];
}
