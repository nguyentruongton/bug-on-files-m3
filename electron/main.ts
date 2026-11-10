import { app, BrowserWindow, ipcMain, protocol, net, shell, dialog } from 'electron';
import path from 'path';
import { promises as fs } from 'fs';
import url from 'url';
import os from 'os';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { setupPtyHandlers, setMainWindow, killAllPty } from './pty';
import { getExtractCommand, parseDesktopEntry, matchesMimeType, resolvePlaces } from './systemUtils';
import { DirWatchers } from './dirWatcher';
import { readTextPreview } from './textPreview';

const execFileAsync = promisify(execFile);

// --- State ---
let mainWindow: BrowserWindow | null = null;

const dirWatchers = new DirWatchers((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('fs:watch-event', event);
    }
});

// Initialize PTY handlers
setupPtyHandlers();

// Register protocol before app ready
protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { secure: true, supportFetchAPI: true, bypassCSP: true } }
]);

// Wayland & GPU Flags
// Suppress "Incomplete image description" warning on Wayland
app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
// Optional: Disable GPU rasterization if glitches persist, but 'auto' ozone hint often fixes it.
// app.commandLine.appendSwitch('disable-gpu-compositing');

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false
        },
        autoHideMenuBar: true,
    });
    setMainWindow(mainWindow);

    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

// --- IPC Handlers ---

ipcMain.handle('theme:get-css', async () => {
    const homeDir = os.homedir();
    const themePath = path.join(homeDir, '.config/matugen/theme.css');
    try {
        const css = await fs.readFile(themePath, 'utf-8');
        return css;
    } catch {
        return null;
    }
});

ipcMain.handle('fs:list-dir', async (_, dirPath: string) => {
    try {
        const targetPath = dirPath || os.homedir();
        const entries = await fs.readdir(targetPath, { withFileTypes: true });
        const results = await Promise.all(entries.map(async (entry) => {
            try {
                const stats = await fs.stat(path.join(targetPath, entry.name));
                return {
                    name: entry.name,
                    path: path.join(targetPath, entry.name),
                    isDirectory: entry.isDirectory(),
                    size: stats.size,
                    mtime: stats.mtime
                };
            } catch {
                return null;
            }
        }));
        return results.filter(r => r !== null);
    } catch (error) {
        console.error('Failed to list dir', dirPath, error);
        throw error;
    }
});

ipcMain.handle('fs:get-places', () => {
    const home = app.getPath('home');
    return resolvePlaces(home, (key) => app.getPath(key));
});

ipcMain.handle('fs:copy', async (_, source: string, dest: string) => {
    // Simple copy for now. For directories, we might need recursive copy.
    // fs.cp is available in Node 16.7.0+
    await fs.cp(source, dest, { recursive: true, force: false });
    return true;
});

ipcMain.handle('fs:move', async (_, source: string, dest: string) => {
    await fs.rename(source, dest);
    return true;
});

ipcMain.handle('fs:trash', async (_, filePath: string) => {
    await shell.trashItem(filePath);
    return true;
});

ipcMain.handle('fs:rename', async (_, oldPath: string, newPath: string) => {
    await fs.rename(oldPath, newPath);
    return true;
});

ipcMain.handle('fs:mkdir', async (_, dirPath: string) => {
    await fs.mkdir(dirPath, { recursive: true });
    return true;
});

ipcMain.handle('fs:open', async (_, filePath: string) => {
    const error = await shell.openPath(filePath);
    return error; // returns error string or empty if success
});

ipcMain.handle('fs:extract', async (_, filePath: string) => {
    try {
        const extractCmd = getExtractCommand(filePath);
        if (!extractCmd) return false;
        await execFileAsync(extractCmd.cmd, extractCmd.args);
        return true;
    } catch (e) {
        console.error('Extract failed', e);
        return false;
    }
});

ipcMain.handle('fs:watch-start', (_, dir: string) => {
    return dirWatchers.start(dir);
});

ipcMain.handle('fs:watch-stop', (_, id: number) => {
    dirWatchers.stop(id);
});

// Cache for apps
let appsCache: { name: string; icon: string; exec: string; }[] | null = null;

ipcMain.handle('system:get-apps', async () => {
    if (appsCache) return appsCache;

    const apps: { name: string; icon: string; exec: string; }[] = [];
    const dirs = ['/usr/share/applications', '/usr/local/share/applications', path.join(os.homedir(), '.local/share/applications')];

    for (const dir of dirs) {
        try {
            const files = await fs.readdir(dir);
            for (const file of files) {
                if (!file.endsWith('.desktop')) continue;
                try {
                    const content = await fs.readFile(path.join(dir, file), 'utf-8');
                    const entry = parseDesktopEntry(content);
                    if (entry && !entry.noDisplay) {
                        apps.push({
                            name: entry.name,
                            icon: entry.icon || '',
                            exec: entry.exec
                        });
                    }
                } catch { /* ignore unreadable desktop file */ }
            }
        } catch { /* ignore missing application dir */ }
    }

    appsCache = apps.sort((a, b) => a.name.localeCompare(b.name));
    return appsCache;
});

ipcMain.handle('system:open-with', async (_, execPath: string, filePath: string) => {
    try {
        const parts = execPath.match(/(?:[^\s"]+|"[^"]*")+/g) || [execPath];
        const cmd = parts[0].replace(/^"|"$/g, '');
        const args = parts.slice(1).map(a => a.replace(/^"|"$/g, ''));
        const child = spawn(cmd, [...args, filePath], { detached: true, stdio: 'ignore' });
        child.unref();
        return true;
    } catch (e) {
        console.error('Open With failed', e);
        return false;
    }
});

ipcMain.handle('fs:get-parent', (_, dirPath: string) => {
    return path.dirname(dirPath);
});

ipcMain.handle('fs:get-home', () => {
    return os.homedir();
});

ipcMain.handle('dialog:open-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'CSS Files', extensions: ['css'] }]
    });
    if (canceled) return null;
    return filePaths[0];
});

ipcMain.handle('dialog:open-directory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    if (canceled) return null;
    return filePaths[0];
});

ipcMain.on('dnd:start', (event, filePath: string, iconPath?: string) => {
    // For startDrag, we need an icon. 
    // If iconPath is not provided, we should probably generate one or use a default?
    // Electron requires 'file' (absolute path) and 'icon' (path to png). 
    // Ideally we generate a dynamic icon or pass one.
    // For now we can accept an icon path or default to a generic file icon if manageable, 
    // but startDrag REQUIRES an icon.
    // Let's rely on the frontend to pass a valid icon path (maybe generated or static asset).
    // Or we can use a system icon?

    // Minimal implementation:
    event.sender.startDrag({
        file: filePath,
        icon: iconPath || filePath // Fallback to file itself? might not work for non-images
    });
});

ipcMain.handle('fs:exists', async (_, filePath: string) => {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
});

ipcMain.handle('system:get-drives', async () => {
    interface LsblkDevice {
        name: string;
        label?: string | null;
        mountpoint?: string | null;
        size?: string;
        type?: string;
        tran?: string | null;
        rm?: boolean;
        children?: LsblkDevice[];
    }
    interface DriveInfo {
        name: string;
        label: string;
        mountpoint: string;
        size: string | undefined;
        type: string | undefined;
        removable: boolean;
        usb: boolean;
    }
    try {
        const { stdout } = await execFileAsync('lsblk', ['--json', '-o', 'NAME,LABEL,MOUNTPOINT,SIZE,TYPE,TRAN,RM']);
        const data = JSON.parse(stdout) as { blockdevices?: LsblkDevice[] };
        const devices = data.blockdevices || [];

        const drives: DriveInfo[] = [];
        const processDevice = (dev: LsblkDevice) => {
            if (dev.mountpoint) {
                drives.push({
                    name: dev.name,
                    label: dev.label || dev.name,
                    mountpoint: dev.mountpoint,
                    size: dev.size,
                    type: dev.type,
                    removable: Boolean(dev.rm || dev.tran === 'usb'),
                    usb: dev.tran === 'usb'
                });
            }
            if (dev.children) {
                dev.children.forEach(processDevice);
            }
        };

        devices.forEach(processDevice);
        return drives.filter(d => d.removable || d.mountpoint.startsWith('/run/media'));
    } catch (e) {
        console.error('Failed to get drives', e);
        return [];
    }
});

ipcMain.handle('system:get-storage-usage', async () => {
    try {
        // Linux: df -kP / (output in 1K blocks)
        // Output format: Filesystem 1024-blocks Used Available Capacity Mounted on
        const { stdout } = await execFileAsync('df', ['-kP', '/']);
        const lines = stdout.trim().split('\n');
        if (lines.length < 2) return null;

        const parts = lines[1].split(/\s+/);
        // parts[1] = total, parts[2] = used, parts[3] = available, parts[4] = percent
        const total = parseInt(parts[1]) * 1024; // Convert to bytes
        const used = parseInt(parts[2]) * 1024;
        const free = parseInt(parts[3]) * 1024;

        return { total, used, free };
    } catch (e) {
        console.error('Failed to get storage usage', e);
        return null;
    }
});

ipcMain.handle('fs:read-file', async (_, filePath: string) => {
    try {
        return await fs.readFile(filePath, 'utf-8');
    } catch {
        return null;
    }
});

ipcMain.handle('fs:read-text-preview', async (_, filePath: string) => {
    return readTextPreview(filePath);
});

ipcMain.handle('app:get-startup-path', async () => {
    const args = process.argv;
    // In dev, args are [electron, ., path?]
    // In prod, args are [app, path?]
    const lastArg = args[args.length - 1];

    if (!lastArg || lastArg === '.' || lastArg === process.execPath) {
        return null; // Ignore if it's the executable itself or current dir placeholder
    }

    try {
        if (path.isAbsolute(lastArg)) {
            const stats = await fs.stat(lastArg);
            if (stats.isDirectory()) {
                return lastArg;
            } else if (stats.isFile()) {
                return path.dirname(lastArg); // Open parent folder if file passed
            }
        }
    } catch {
        // Path doesn't exist or other error
        return null;
    }
    return null;
});

ipcMain.handle('window:set-icon', async (_, iconType: 'light' | 'dark' | string) => {
    if (!mainWindow) return;

    if (path.isAbsolute(iconType)) {
        mainWindow.setIcon(iconType);
    } else {
        // Construct path to assets
        const possiblePaths = [
            path.join(__dirname, `../assets/icon-${iconType}.png`),
            path.join(process.resourcesPath, `assets/icon-${iconType}.png`)
        ];
        for (const p of possiblePaths) {
            try {
                await fs.access(p);
                mainWindow.setIcon(p);
                return;
            } catch { /* ignore missing icon candidate */ }
        }
    }
});

ipcMain.handle('system:get-directory-size', async (_, dirPath: string) => {
    try {
        // Use du -sb for bytes (Linux/GNU). -s = summary, -b = bytes
        const { stdout } = await execFileAsync('du', ['-sb', dirPath]);
        const match = stdout.match(/^(\d+)/);
        if (match) {
            return parseInt(match[1], 10);
        }
        return 0;
    } catch (error: unknown) {
        // du might fail on some files but still return partial
        const partialStdout = (error as { stdout?: string })?.stdout;
        if (partialStdout) {
            const match = partialStdout.match(/^(\d+)/);
            if (match) return parseInt(match[1], 10);
        }
        return 0;
    }
});

ipcMain.handle('system:get-recommended-apps', async (_, filePath: string) => {
    try {
        const { stdout: mimeOut } = await execFileAsync('xdg-mime', ['query', 'filetype', filePath]);
        const mime = mimeOut.trim();
        if (!mime) return [];

        const searchPaths = [
            '/usr/share/applications',
            path.join(os.homedir(), '.local/share/applications'),
            '/var/lib/flatpak/exports/share/applications',
            path.join(os.homedir(), '.local/share/flatpak/exports/share/applications')
        ];

        const apps: { name: string; icon: string | null; exec: string; path: string }[] = [];
        for (const searchPath of searchPaths) {
            try {
                const files = await fs.readdir(searchPath);
                for (const file of files) {
                    if (!file.endsWith('.desktop')) continue;
                    const fullPath = path.join(searchPath, file);
                    try {
                        const content = await fs.readFile(fullPath, 'utf-8');
                        const entry = parseDesktopEntry(content, fullPath);
                        if (entry && !entry.noDisplay && matchesMimeType(entry.mimeTypes, mime)) {
                            apps.push({
                                name: entry.name,
                                icon: entry.icon,
                                exec: entry.exec,
                                path: fullPath
                            });
                        }
                    } catch { /* ignore unreadable desktop file */ }
                }
            } catch { /* ignore missing application dir */ }
        }
        return apps;
    } catch (err) {
        console.error('Error getting recommended apps:', err);
        return [];
    }
});

// Search
ipcMain.handle('system:search', async (_, directory: string, query: string, options?: { type?: 'f' | 'd', minSize?: string, maxSize?: string }) => {
    try {
        // Build find command
        const args = [directory];
        if (options?.type) args.push('-type', options.type);
        if (query) args.push('-iname', `*${query}*`);
        if (options?.minSize) args.push('-size', `+${options.minSize}`);
        if (options?.maxSize) args.push('-size', `-${options.maxSize}`);

        // Limit results logic if needed, but for now standard execution
        const { stdout } = await execFileAsync('find', args, { maxBuffer: 1024 * 1024 * 10 });

        const lines = stdout.split('\n').filter(Boolean);
        const results: Array<{
            name: string;
            path: string;
            isDirectory: boolean;
            size: number;
            mtime: Date;
        }> = [];

        const topLines = lines.slice(0, 100);

        for (const pathStr of topLines) {
            try {
                const stats = await fs.stat(pathStr);
                results.push({
                    name: path.basename(pathStr),
                    path: pathStr,
                    isDirectory: stats.isDirectory(),
                    size: stats.size,
                    mtime: stats.mtime
                });
            } catch { /* ignore inaccessible path */ }
        }
        return results;
    } catch (error) {
        console.error('Search failed:', error);
        return [];
    }
});

// --- App Lifecycle ---

app.whenReady().then(() => {
    protocol.handle('media', (request) => {
        const filePath = request.url.slice('media://'.length);
        // Decode URI component (handle spaces etc)
        const decodedPath = decodeURIComponent(filePath);
        return net.fetch(url.pathToFileURL(decodedPath).toString());
    });
    createWindow();
});

app.on('window-all-closed', () => {
    dirWatchers.stopAll();
    killAllPty();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
