import { useState, useEffect, useCallback } from 'react';
import './index.css';
import { ToastProvider, useToast } from './contexts/ToastContext';
import { ClipboardProvider, useClipboard } from './contexts/ClipboardContext';
import { ThemeService } from './services/ThemeService';
import { FileSystemService } from './services/FileSystemService';
import { NavigationRail } from './components/NavigationRail';
import { Sidebar } from './components/Sidebar';
import { Icon } from './components/Icon';
import { IconButton } from './components/IconButton';
import { ContextMenu } from './components/ContextMenu';
import type { ContextMenuItem } from './components/ContextMenu';
import { SettingsDialog } from './components/SettingsDialog';
import { TerminalPane } from './components/TerminalPane';
import type { IFile } from './types/files';
import { Dialog } from './components/Dialog';
import { Button } from './components/Button';
import { TabBar } from './components/TabBar';
import { ExplorerTab } from './components/ExplorerTab';
import { OpenWithDialog } from './components/OpenWithDialog';
import { PropertiesDialog } from './components/PropertiesDialog';
import { useLocalStorage } from './hooks/useLocalStorage';
import {
  resolveTerminalTargetDir,
  resolveAfterTabClose,
  normalizePath,
} from './utils/navigationHistory';
import { isArchiveFile, validateFileName } from './utils/fileUtils';

interface TabState {
  id: string;
  title: string;
  path: string;
  refreshTrigger?: number;
}

function AppContent() {
  // Tabs State
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [homePath, setHomePath] = useState<string>('/home');

  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalCwd, setTerminalCwd] = useState<string | undefined>(undefined);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: IFile | null;
    selectedItems: IFile[];
  } | null>(null);

  // Rename Dialog State
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameFile, setRenameFile] = useState<IFile | null>(null);
  const [newName, setNewName] = useState('');

  // New Folder Dialog State
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Properties Dialog State
  const [propertiesDialogOpen, setPropertiesDialogOpen] = useState(false);
  const [propertiesFile, setPropertiesFile] = useState<IFile | null>(null);

  // Open With Dialog State
  const [openWithFile, setOpenWithFile] = useState<IFile | null>(null);

  // Clipboard & Toast State
  const { clipboard, copy, cut, clear: clearClipboard } = useClipboard();
  const { showToast } = useToast();

  // Settings & Layout State
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useLocalStorage<boolean>('settings.sidebarOpen', true);
  const [showHiddenFiles, setShowHiddenFiles] = useLocalStorage<boolean>('settings.showHiddenFiles', true);
  const [iconSize, setIconSize] = useLocalStorage<number>('settings.iconSize', 64);
  const [viewMode, setViewMode] = useLocalStorage<'grid' | 'list'>('settings.viewMode', 'grid');
  const [filledIcons, setFilledIcons] = useLocalStorage<boolean>('settings.filledIcons', false);
  const [customCssPath, setCustomCssPath] = useState<string>('');

  const currentPath = tabs.find((t) => t.id === activeTabId)?.path || '';

  // -- Handlers --

  const handleLoadCustomCss = useCallback(async (path: string) => {
    try {
      const css = await window.electron.readFile(path);
      if (css) {
        let style = document.getElementById('custom-user-css');
        if (!style) {
          style = document.createElement('style');
          style.id = 'custom-user-css';
          document.head.appendChild(style);
        }
        style.textContent = css;
        setCustomCssPath(path);
        localStorage.setItem('customCssPath', path);
      }
    } catch (err) {
      console.error('Failed to load custom css', err);
    }
  }, []);

  const handleImportCss = async () => {
    const path = await window.electron.openFileDialog();
    if (path) {
      handleLoadCustomCss(path);
    }
  };

  // Tab Handlers
  const handleAddTab = useCallback((path?: string) => {
    const newTabId = Date.now().toString();
    const newPath = path || currentPath || '/';
    const folderName =
      newPath === 'app://dashboard'
        ? 'Dashboard'
        : newPath.split('/').pop() || newPath;
    const newTab: TabState = { id: newTabId, title: folderName, path: newPath };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTabId);
    if (newPath && !newPath.startsWith('app://')) {
      setTerminalCwd(newPath);
    }
  }, [currentPath]);

  // -- Effects --

  useEffect(() => {
    ThemeService.loadTheme();
    ThemeService.init();

    const init = async () => {
      if (window.electron) {
        try {
          const resolvedHome = await window.electron.getHomePath();
          if (resolvedHome) {
            setHomePath(resolvedHome);
          }
        } catch (err) {
          console.error('Failed to get home path', err);
        }

        const startupPath = await window.electron.getStartupPath();
        const initialPath = startupPath || 'app://dashboard';
        const initialTitle =
          initialPath === 'app://dashboard'
            ? 'Dashboard'
            : initialPath.split('/').pop() || initialPath;
        const firstTabId = Date.now().toString();
        setTabs([{ id: firstTabId, title: initialTitle, path: initialPath }]);
        setActiveTabId(firstTabId);
      }
    };
    init();

    const storedCssPath = localStorage.getItem('customCssPath');
    if (storedCssPath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      handleLoadCustomCss(storedCssPath);
    }
  }, [handleLoadCustomCss]);

  const handleCloseTab = useCallback((id: string) => {
    const next = resolveAfterTabClose(tabs, activeTabId, id, terminalCwd);
    setTabs(next.tabs);
    setActiveTabId(next.activeTabId);
    setTerminalCwd(next.terminalCwd);
  }, [tabs, activeTabId, terminalCwd]);

  const handleTabPathUpdate = useCallback((id: string, path: string) => {
    const folderName = path === 'app://dashboard' ? 'Dashboard' : (path.split('/').pop() || path);
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id === id) return { ...t, path, title: folderName };
        return t;
      })
    );
    if (id === activeTabId && path && !path.startsWith('app://')) {
      setTerminalCwd(path);
    }
  }, [activeTabId]);

  const handleSelectTab = useCallback((id: string) => {
    setActiveTabId(id);
    const target = tabs.find((t) => t.id === id);
    if (target && target.path && !target.path.startsWith('app://')) {
      setTerminalCwd(target.path);
    }
  }, [tabs]);

  const refreshActiveTab = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, refreshTrigger: (t.refreshTrigger ?? 0) + 1 } : t))
    );
  }, [activeTabId]);

  const toggleTerminal = () => {
    setTerminalOpen((prev) => !prev);
  };

  const handleSidebarNavigate = useCallback((path: string) => {
    setTabs((prev) => {
      if (prev.length === 0) {
        const newTabId = Date.now().toString();
        const folderName = path === 'app://dashboard' ? 'Dashboard' : (path.split('/').pop() || path);
        const newTab: TabState = { id: newTabId, title: folderName, path };
        setActiveTabId(newTabId);
        return [newTab];
      }
      return prev.map((t) => (t.id === activeTabId ? { ...t, path } : t));
    });
    if (path && !path.startsWith('app://')) {
      setTerminalCwd(path);
    }
  }, [activeTabId]);

  const handleContextMenu = useCallback((e: React.MouseEvent, file: IFile | null, selectedItems: IFile[]) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, item: file, selectedItems });
  }, []);

  const handleCopy = (filesToCopy: IFile[]) => {
    copy(filesToCopy);
    showToast(`Copied ${filesToCopy.length} item(s)`, 'info');
    setContextMenu(null);
  };

  const handleCut = (filesToCut: IFile[]) => {
    cut(filesToCut);
    showToast(`Cut ${filesToCut.length} item(s)`, 'info');
    setContextMenu(null);
  };

  const handlePaste = async () => {
    if (!clipboard || clipboard.files.length === 0 || !currentPath || currentPath.startsWith('app://')) return;

    try {
      for (const file of clipboard.files) {
        const destPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        if (clipboard.operation === 'copy') {
          await FileSystemService.copy(file.path, destPath);
        } else {
          await FileSystemService.move(file.path, destPath);
        }
      }

      if (clipboard.operation === 'cut') {
        clearClipboard();
      }
      showToast(`Pasted ${clipboard.files.length} item(s)`, 'success');
      refreshActiveTab();
    } catch (err) {
      console.error('Paste failed', err);
      showToast('Failed to paste items', 'error');
    }
    setContextMenu(null);
  };

  const handleOpenNewFolder = useCallback(() => {
    if (!currentPath || currentPath.startsWith('app://')) return;
    setNewFolderName('');
    setNewFolderDialogOpen(true);
    setContextMenu(null);
  }, [currentPath]);

  const newFolderValidation = validateFileName(newFolderName);
  const renameValidation = validateFileName(newName);

  const handleCreateFolder = async () => {
    if (!newFolderValidation.valid || !currentPath || currentPath.startsWith('app://')) return;
    const trimmed = newFolderName.trim();
    const targetDir = currentPath === '/' ? `/${trimmed}` : `${currentPath}/${trimmed}`;
    try {
      await FileSystemService.mkdir(targetDir);
      showToast(`Created folder "${trimmed}"`, 'success');
      refreshActiveTab();
      setNewFolderDialogOpen(false);
      setNewFolderName('');
    } catch (err) {
      console.error('Create folder failed', err);
      showToast(`Failed to create folder "${trimmed}"`, 'error');
    }
  };

  const targetItems = contextMenu?.item
    ? (contextMenu.selectedItems.length > 0 ? contextMenu.selectedItems : [contextMenu.item])
    : [];
  const selectionSuffix = targetItems.length > 1 ? ` (${targetItems.length})` : '';
  const canExtractContextItem = Boolean(
    contextMenu?.item && !contextMenu.item.isDirectory && isArchiveFile(contextMenu.item.name)
  );

  const menuItems: ContextMenuItem[] = contextMenu?.item ? [
    {
      label: 'Open', icon: 'open_in_new', action: () => {
        FileSystemService.open(contextMenu.item!.path);
        setContextMenu(null);
      }
    },
    {
      label: 'Open in Terminal', icon: 'terminal', action: () => {
        const targetDir = resolveTerminalTargetDir(contextMenu.item!.path, contextMenu.item!.isDirectory);
        if (targetDir) {
          setTerminalCwd(targetDir);
          setTerminalOpen(true);
        }
        setContextMenu(null);
      }
    },
    { divider: true, label: '', action: () => { } },
    { label: `Copy${selectionSuffix}`, icon: 'content_copy', action: () => handleCopy(targetItems) },
    { label: `Cut${selectionSuffix}`, icon: 'content_cut', action: () => handleCut(targetItems) },
    {
      label: `Delete${selectionSuffix}`, icon: 'delete', action: async () => {
        try {
          for (const item of targetItems) {
            await FileSystemService.trash(item.path);
          }
          showToast(`Moved ${targetItems.length} item(s) to Trash`, 'success');
          refreshActiveTab();
        } catch (err) {
          console.error('Delete failed', err);
          showToast('Failed to delete selected item(s)', 'error');
        }
        setContextMenu(null);
      }
    },
    ...(canExtractContextItem
      ? [{
          label: 'Extract Here',
          icon: 'unarchive',
          action: async () => {
            const file = contextMenu.item!;
            setContextMenu(null);
            try {
              await window.electron.extractFile(file.path);
              showToast(`Extracted "${file.name}"`, 'success');
              refreshActiveTab();
            } catch (err) {
              console.error('Extract failed', err);
              showToast(`Failed to extract "${file.name}"`, 'error');
            }
          }
        }]
      : []),
    {
      label: 'Rename', icon: 'edit', action: () => {
        setRenameFile(contextMenu.item);
        setNewName(contextMenu.item!.name);
        setRenameDialogOpen(true);
        setContextMenu(null);
      }
    },
    { divider: true, label: '', action: () => { } },
    {
      label: 'Open With...', icon: 'apps', action: () => {
        setOpenWithFile(contextMenu.item);
        setContextMenu(null);
      }
    },
    {
      label: 'Properties', icon: 'info', action: () => {
        setPropertiesFile(contextMenu.item);
        setPropertiesDialogOpen(true);
        setContextMenu(null);
      }
    }
  ] : [
    // Background Context Menu
    ...(currentPath && !currentPath.startsWith('app://')
      ? [{ label: 'New Folder', icon: 'create_new_folder', action: handleOpenNewFolder }]
      : []),
    ...(clipboard && clipboard.files.length > 0 && currentPath && !currentPath.startsWith('app://')
      ? [{ label: 'Paste', icon: 'content_paste', action: handlePaste }]
      : []),
  ];

  const handleRename = async () => {
    if (!renameFile || !renameValidation.valid) return;
    const trimmed = newName.trim();
    if (trimmed === renameFile.name) {
      setRenameDialogOpen(false);
      setRenameFile(null);
      return;
    }
    const lastSlashIndex = renameFile.path.lastIndexOf('/');
    const parentDir = renameFile.path.substring(0, lastSlashIndex);
    const newPathString = `${parentDir}/${trimmed}`;

    try {
      await FileSystemService.rename(renameFile.path, newPathString);
      showToast(`Renamed to "${trimmed}"`, 'success');
      refreshActiveTab();
      setRenameDialogOpen(false);
      setRenameFile(null);
    } catch (err) {
      console.error('Rename failed', err);
      showToast(`Failed to rename "${renameFile.name}"`, 'error');
    }
  };

  const normalizedCurrent = normalizePath(currentPath);
  const normalizedHome = normalizePath(homePath);
  const isInHome = Boolean(
    normalizedCurrent &&
    !normalizedCurrent.startsWith('app://') &&
    (normalizedCurrent === normalizedHome || normalizedCurrent.startsWith(`${normalizedHome}/`))
  );
  const isRootOrSystemFiles = Boolean(
    normalizedCurrent &&
    !normalizedCurrent.startsWith('app://') &&
    !isInHome
  );

  return (
    <div className="app-shell" style={{ display: 'flex', height: '100vh', width: '100vw', background: 'var(--md-sys-color-background)' }} onClick={() => setContextMenu(null)}>
      <NavigationRail
        headerAction={
          <IconButton
            variant="standard"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? 'Collapse Places Sidebar' : 'Expand Places Sidebar'}
          >
            <Icon name={sidebarOpen ? 'menu_open' : 'menu'} />
          </IconButton>
        }
        items={[
          {
            icon: <Icon name="dashboard" />,
            activeIcon: <Icon name="dashboard" filled />,
            label: 'Dashboard',
            active: currentPath === 'app://dashboard',
            onClick: () => {
              const existing = tabs.find((t) => t.path.startsWith('app://dashboard'));
              if (existing) {
                setActiveTabId(existing.id);
              } else {
                handleAddTab('app://dashboard');
              }
            }
          },
          {
            icon: <Icon name="home" />,
            activeIcon: <Icon name="home" filled />,
            label: 'Home',
            active: isInHome,
            onClick: async () => {
              const home = await window.electron.getHomePath();
              if (home) setHomePath(home);
              const existingHomeTab = tabs.find((t) => normalizePath(t.path) === normalizePath(home));
              if (existingHomeTab) {
                handleSelectTab(existingHomeTab.id);
              } else {
                handleAddTab(home);
              }
            }
          },
          {
            icon: <Icon name="folder" />,
            activeIcon: <Icon name="folder" filled />,
            label: 'Files',
            active: isRootOrSystemFiles,
            onClick: () => handleSidebarNavigate('/')
          },
          {
            icon: <Icon name="terminal" />,
            activeIcon: <Icon name="terminal" filled />,
            label: 'Terminal',
            active: terminalOpen,
            onClick: toggleTerminal
          },
          {
            icon: <Icon name="settings" />,
            activeIcon: <Icon name="settings" filled />,
            label: 'Settings',
            onClick: () => setSettingsDialogOpen(true)
          }
        ]}
      />

      {/* Places Sidebar */}
      <Sidebar
        onNavigate={handleSidebarNavigate}
        currentPath={currentPath}
        collapsed={!sidebarOpen}
      />

      {/* Main Content Area */}
      <main className="main-content" style={{
        flex: 1,
        height: '100%',
        background: 'var(--md-sys-color-background)',
        borderRadius: '24px 0 0 0',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Top Bar */}
        <header style={{ height: 'auto', display: 'flex', flexDirection: 'column', background: 'var(--md-sys-color-surface)' }}>
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onTabClick={handleSelectTab}
            onTabClose={handleCloseTab}
            onNewTab={() => handleAddTab()}
          />
        </header>

        {/* File Tabs Content */}
        <div className="content-area" style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {tabs.map((tab) => (
            <div key={tab.id} style={{ display: tab.id === activeTabId ? 'block' : 'none', height: '100%' }}>
              <ExplorerTab
                tabId={tab.id}
                isActive={tab.id === activeTabId}
                initialPath={tab.path}
                refreshTrigger={tab.refreshTrigger}
                onPathChange={handleTabPathUpdate}
                onContextMenu={handleContextMenu}
                onCreateFolderRequest={handleOpenNewFolder}
                showHiddenFiles={showHiddenFiles}
                onToggleHiddenFiles={() => setShowHiddenFiles(!showHiddenFiles)}
                iconSize={iconSize}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                filledIcons={filledIcons}
              />
            </div>
          ))}
          {tabs.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--md-sys-color-on-surface-variant)' }}>
              <div style={{ textAlign: 'center' }}>
                <Icon name="tab" size={48} />
                <p>No tabs open</p>
                <Button onClick={() => handleAddTab()}>Open New Tab</Button>
              </div>
            </div>
          )}
        </div>

        {/* Terminal Panel */}
        {terminalOpen && (
          <div style={{ height: '300px', borderTop: '1px solid var(--md-sys-color-outline-variant)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '4px 12px', background: 'var(--md-sys-color-surface-container-high)', color: 'var(--md-sys-color-on-surface)' }}>
              <span style={{ fontSize: '12px', fontWeight: 500 }}>Terminal</span>
              <div style={{ flex: 1 }} />
              <IconButton onClick={() => setTerminalOpen(false)} style={{ width: 24, height: 24 }}>
                <Icon name="close" size={16} />
              </IconButton>
            </div>
            <div style={{ flex: 1, position: 'relative' }}>
              <TerminalPane cwd={terminalCwd || (currentPath && !currentPath.startsWith('app://') ? currentPath : undefined)} />
            </div>
          </div>
        )}

        {contextMenu && menuItems.length > 0 && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={menuItems}
            onClose={() => setContextMenu(null)}
          />
        )}

        <Dialog
          title="New Folder"
          open={newFolderDialogOpen}
          onClose={() => setNewFolderDialogOpen(false)}
          actions={
            <>
              <Button variant="text" onClick={() => setNewFolderDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateFolder} disabled={!newFolderValidation.valid}>Create</Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <input
              type="text"
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              className="md3-text-field"
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: `1px solid ${newFolderValidation.error ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-outline)'}`,
                background: 'var(--md-sys-color-surface)',
                color: 'var(--md-sys-color-on-surface)',
                fontSize: '16px',
                boxSizing: 'border-box'
              }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newFolderValidation.valid) handleCreateFolder();
              }}
            />
            {newFolderValidation.error && (
              <span style={{ fontSize: '12px', color: 'var(--md-sys-color-error)' }}>
                {newFolderValidation.error}
              </span>
            )}
          </div>
        </Dialog>

        <Dialog
          title="Rename"
          open={renameDialogOpen}
          onClose={() => setRenameDialogOpen(false)}
          actions={
            <>
              <Button variant="text" onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleRename} disabled={!renameValidation.valid}>Rename</Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="md3-text-field"
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: `1px solid ${renameValidation.error ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-outline)'}`,
                background: 'var(--md-sys-color-surface)',
                color: 'var(--md-sys-color-on-surface)',
                fontSize: '16px',
                boxSizing: 'border-box'
              }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameValidation.valid) handleRename();
              }}
            />
            {renameValidation.error && (
              <span style={{ fontSize: '12px', color: 'var(--md-sys-color-error)' }}>
                {renameValidation.error}
              </span>
            )}
          </div>
        </Dialog>

        <PropertiesDialog
          open={propertiesDialogOpen}
          onClose={() => setPropertiesDialogOpen(false)}
          file={propertiesFile}
        />
        {openWithFile && (
          <OpenWithDialog
            open={!!openWithFile}
            path={openWithFile.path}
            onClose={() => setOpenWithFile(null)}
            onSelect={(exec) => {
              if (openWithFile) {
                window.electron.openWith(exec, openWithFile.path);
              }
              setOpenWithFile(null);
            }}
          />
        )}

        <SettingsDialog
          open={settingsDialogOpen}
          onClose={() => setSettingsDialogOpen(false)}
          showHiddenFiles={showHiddenFiles}
          onToggleHiddenFiles={() => setShowHiddenFiles(!showHiddenFiles)}
          iconSize={iconSize}
          onIconSizeChange={setIconSize}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          filledIcons={filledIcons}
          onToggleFilledIcons={() => setFilledIcons(!filledIcons)}
          customCssPath={customCssPath}
          onImportCss={handleImportCss}
        />
      </main>
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <ClipboardProvider>
        <AppContent />
      </ClipboardProvider>
    </ToastProvider>
  );
}

export default App;
