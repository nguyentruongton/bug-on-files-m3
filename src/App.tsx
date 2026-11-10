import { useState, useEffect, useCallback } from 'react';
import './index.css';
import { ToastProvider } from './contexts/ToastContext';
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
import { TerminalPane } from './components/TerminalPane'; // Import TerminalPane
import type { IFile } from './types/files';
import { Dialog } from './components/Dialog';
import { Button } from './components/Button';
import { TabBar } from './components/TabBar';
import { ExplorerTab } from './components/ExplorerTab';
import { OpenWithDialog } from './components/OpenWithDialog';
import { PropertiesDialog } from './components/PropertiesDialog';
import { useLocalStorage } from './hooks/useLocalStorage';
import { resolveTerminalTargetDir, resolveAfterTabClose } from './utils/navigationHistory';

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

  // Note: loading/files state is now internal to ExplorerTab
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

  // Clipboard State (from Context)
  const { clipboard, copy, cut, clear: clearClipboard } = useClipboard();

  // Settings State
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

  const [showHiddenFiles, setShowHiddenFiles] = useLocalStorage<boolean>('settings.showHiddenFiles', true);
  const [iconSize, setIconSize] = useLocalStorage<number>('settings.iconSize', 64);
  const [viewMode, setViewMode] = useLocalStorage<'grid' | 'list'>('settings.viewMode', 'grid');
  const [filledIcons, setFilledIcons] = useLocalStorage<boolean>('settings.filledIcons', false);
  const [customCssPath, setCustomCssPath] = useState<string>('');

  // -- Handlers (Defined before effects) --

  const handleLoadCustomCss = async (path: string) => {
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
  };

  const handleImportCss = async () => {
    const path = await window.electron.openFileDialog();
    if (path) {
      handleLoadCustomCss(path);
    }
  };

  const loadHome = async () => {
    handleAddTab('app://dashboard');
  };

  // -- Effects --

  useEffect(() => {
    ThemeService.loadTheme();
    ThemeService.init();

    // Check for startup args
    const init = async () => {
      if (window.electron) {
        const startupPath = await window.electron.getStartupPath();
        if (startupPath) {
          handleAddTab(startupPath);
        } else {
          loadHome();
        }
      }
    };
    init();

    const storedCssPath = localStorage.getItem('customCssPath');
    if (storedCssPath) {
      handleLoadCustomCss(storedCssPath);
    }
  }, []);

  const currentPath = tabs.find(t => t.id === activeTabId)?.path || '';

  // Tab Handlers
  const handleAddTab = useCallback((path?: string) => {
    const newTabId = Date.now().toString();
    const newPath = path || currentPath || '/'; // Default to current or root
    const newTab: TabState = { id: newTabId, title: 'New Tab', path: newPath };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTabId);
  }, [currentPath]);

  const handleCloseTab = useCallback((id: string) => {
    const next = resolveAfterTabClose(tabs, activeTabId, id, terminalCwd);
    setTabs(next.tabs);
    setActiveTabId(next.activeTabId);
    setTerminalCwd(next.terminalCwd);
  }, [tabs, activeTabId, terminalCwd]);

  const handleTabPathUpdate = useCallback((id: string, path: string) => {
    const folderName = path === 'app://dashboard' ? 'Dashboard' : (path.split('/').pop() || path);
    setTabs(prev => prev.map(t => {
      if (t.id === id) return { ...t, path, title: folderName };
      return t;
    }));
    if (id === activeTabId && path && !path.startsWith('app://')) {
      setTerminalCwd(path);
    }
  }, [activeTabId]);

  const handleSelectTab = useCallback((id: string) => {
    setActiveTabId(id);
    const target = tabs.find(t => t.id === id);
    if (target && target.path && !target.path.startsWith('app://')) {
      setTerminalCwd(target.path);
    }
  }, [tabs]);

  const refreshActiveTab = useCallback(() => {
    setTabs(prev =>
      prev.map(t => (t.id === activeTabId ? { ...t, refreshTrigger: (t.refreshTrigger ?? 0) + 1 } : t))
    );
  }, [activeTabId]);

  const toggleTerminal = () => {
    setTerminalOpen(prev => !prev);
  };

  const handleSidebarNavigate = useCallback((path: string) => {
    setTabs(prev => {
      if (prev.length === 0) {
        const newTabId = Date.now().toString();
        const folderName = path === 'app://dashboard' ? 'Dashboard' : (path.split('/').pop() || path);
        const newTab: TabState = { id: newTabId, title: folderName, path };
        setActiveTabId(newTabId);
        return [newTab];
      }
      return prev.map(t => t.id === activeTabId ? { ...t, path } : t);
    });
  }, [activeTabId]);

  const handleContextMenu = useCallback((e: React.MouseEvent, file: IFile | null, selectedItems: IFile[]) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, item: file, selectedItems });
  }, []);

  const handleCopy = (filesToCopy: IFile[]) => {
    copy(filesToCopy);
    setContextMenu(null);
  };

  const handleCut = (filesToCut: IFile[]) => {
    cut(filesToCut);
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
      refreshActiveTab();
    } catch (err) {
      console.error('Paste failed', err);
    }
    setContextMenu(null);
  };

  const handleOpenNewFolder = useCallback(() => {
    if (!currentPath || currentPath.startsWith('app://')) return;
    setNewFolderName('');
    setNewFolderDialogOpen(true);
    setContextMenu(null);
  }, [currentPath]);

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (trimmed && !trimmed.includes('/') && currentPath && !currentPath.startsWith('app://')) {
      const targetDir = currentPath === '/' ? `/${trimmed}` : `${currentPath}/${trimmed}`;
      try {
        await FileSystemService.mkdir(targetDir);
        refreshActiveTab();
      } catch (err) {
        console.error('Create folder failed', err);
      }
    }
    setNewFolderDialogOpen(false);
    setNewFolderName('');
  };

  const targetItems = contextMenu?.item
    ? (contextMenu.selectedItems.length > 0 ? contextMenu.selectedItems : [contextMenu.item])
    : [];
  const selectionSuffix = targetItems.length > 1 ? ` (${targetItems.length})` : '';

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
        for (const item of targetItems) {
          await FileSystemService.trash(item.path);
        }
        refreshActiveTab();
        setContextMenu(null);
      }
    },
    {
      label: 'Extract Here',
      icon: 'unarchive',
      action: async () => {
        const file = contextMenu.item!;
        const isArchive = ['.zip', '.tar', '.gz', '.xz', '.tgz'].some(ext => file.name.toLowerCase().endsWith(ext));
        if (isArchive) {
          await window.electron.extractFile(file.path);
          refreshActiveTab();
        }
      }
    },
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
    if (renameFile && newName && newName !== renameFile.name) {
      const lastSlashIndex = renameFile.path.lastIndexOf('/');
      const parentDir = renameFile.path.substring(0, lastSlashIndex);
      const newPathString = `${parentDir}/${newName}`;

      await FileSystemService.rename(renameFile.path, newPathString);
      refreshActiveTab();
    }
    setRenameDialogOpen(false);
    setRenameFile(null);
  };

  return (
    <div className="app-shell" style={{ display: 'flex', height: '100vh', width: '100vw', background: 'var(--md-sys-color-background)' }} onClick={() => setContextMenu(null)}>
      <NavigationRail
        items={[
          {
            icon: <Icon name="dashboard" />,
            activeIcon: <Icon name="dashboard" filled />,
            label: 'Dashboard',
            active: currentPath === 'app://dashboard',
            onClick: () => {
              const existing = tabs.find(t => t.path.startsWith('app://dashboard'));
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
            active: currentPath.startsWith('/home'),
            onClick: async () => {
              const home = await window.electron.getHomePath();
              const existingHomeTab = tabs.find(t => t.path === home);
              if (existingHomeTab) {
                setActiveTabId(existingHomeTab.id);
              } else {
                handleAddTab(home);
              }
            }
          },
          {
            icon: <Icon name="folder" />,
            activeIcon: <Icon name="folder" filled />,
            label: 'Files',
            active: currentPath === '/',
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
      <Sidebar onNavigate={handleSidebarNavigate} currentPath={currentPath} />

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
          {tabs.map(tab => (
            <div key={tab.id} style={{ display: tab.id === activeTabId ? 'block' : 'none', height: '100%' }}>
              <ExplorerTab
                tabId={tab.id}
                isActive={tab.id === activeTabId}
                initialPath={tab.path}
                refreshTrigger={tab.refreshTrigger}
                onPathChange={handleTabPathUpdate} // Stable reference
                onContextMenu={handleContextMenu}
                onCreateFolderRequest={handleOpenNewFolder}
                showHiddenFiles={showHiddenFiles}
                iconSize={iconSize}
                viewMode={viewMode}
                filledIcons={filledIcons}
              />
            </div>
          ))}
          {tabs.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
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
          <div style={{ height: '300px', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', background: 'var(--surface-variant)' }}>
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

        {
          contextMenu && menuItems.length > 0 && (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              items={menuItems}
              onClose={() => setContextMenu(null)}
            />
          )
        }

        <Dialog
          title="New Folder"
          open={newFolderDialogOpen}
          onClose={() => setNewFolderDialogOpen(false)}
          actions={
            <>
              <Button variant="text" onClick={() => setNewFolderDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateFolder} disabled={!newFolderName.trim()}>Create</Button>
            </>
          }
        >
          <input
            type="text"
            placeholder="Folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            className="md3-text-field"
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '4px',
              border: '1px solid var(--md-sys-color-outline)',
              background: 'var(--md-sys-color-surface)',
              color: 'var(--md-sys-color-on-surface)',
              fontSize: '16px',
              boxSizing: 'border-box'
            }}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFolder();
            }}
          />
        </Dialog>

        <Dialog
          title="Rename"
          open={renameDialogOpen}
          onClose={() => setRenameDialogOpen(false)}
          actions={
            <>
              <Button variant="text" onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleRename}>Rename</Button>
            </>
          }
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="md3-text-field"
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '4px',
              border: '1px solid var(--md-sys-color-outline)',
              background: 'var(--md-sys-color-surface)',
              color: 'var(--md-sys-color-on-surface)',
              fontSize: '16px',
              boxSizing: 'border-box'
            }}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
            }}
          />
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
