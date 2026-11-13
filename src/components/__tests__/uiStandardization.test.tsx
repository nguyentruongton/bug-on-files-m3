import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IFile } from '../../types/files';
import { AppThemeProvider } from '../../contexts/AppThemeContext';
import { ClipboardProvider } from '../../contexts/ClipboardContext';
import { ToastProvider } from '../../contexts/ToastContext';
import type { SortField } from '../../utils/fileListUtils';
import { resolveSpaceQuickLookTarget } from '../../utils/quickLook';
import { shouldEnableItemMorph } from '../../utils/shapeUtils';
import { ContextMenu } from '../ContextMenu';
import { Dashboard } from '../Dashboard';
import { ExplorerTab } from '../ExplorerTab';
import { FileList } from '../FileList';
import { FileListSkeleton } from '../FileListSkeleton';
import { Omnibar } from '../Omnibar';
import { OpenWithDialog } from '../OpenWithDialog';
import { PropertiesDialog } from '../PropertiesDialog';
import { QuickLook } from '../QuickLook';
import { SettingsDialog } from '../SettingsDialog';
import { Sidebar } from '../Sidebar';
import { StatusBar } from '../StatusBar';
import { TabBar, type Tab } from '../TabBar';

function makeFile(name: string, overrides: Partial<IFile> = {}): IFile {
    return {
        name,
        path: `/tmp/${name}`,
        isDirectory: false,
        size: 1024,
        mtime: new Date('2026-05-01T10:00:00Z'),
        ...overrides,
    };
}

function withMockLocalStorage<T>(
    run: () => T,
    initialData: Record<string, string> = {}
): T {
    const hadLocalStorage = 'localStorage' in globalThis;
    const prevLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => initialData[key] ?? null,
            setItem: () => {},
            removeItem: () => {},
            clear: () => {},
            key: () => null,
            length: Object.keys(initialData).length,
        },
    });

    try {
        return run();
    } finally {
        if (!hadLocalStorage) {
            Reflect.deleteProperty(globalThis, 'localStorage');
        } else {
            Object.defineProperty(globalThis, 'localStorage', {
                configurable: true,
                value: prevLocalStorage,
            });
        }
    }
}

describe('TabBar standardization', () => {
    const sampleTabs: Tab[] = [
        { id: 't1', path: '/home/user', title: 'Home' },
        { id: 't2', path: '/home/user/Documents', title: 'Documents with a very long folder name' },
    ];

    test('renders connected pill tabs with tonal tokens, valid aria-label, non-nested tab roots, and external New Tab button', () => {
        const html = renderToStaticMarkup(
            <TabBar
                tabs={sampleTabs}
                activeTabId="t1"
                onTabClick={() => {}}
                onTabClose={() => {}}
                onNewTab={() => {}}
            />
        );

        expect(html).toContain('role="tablist"');
        expect(html).toMatch(/role="tablist"[^>]*rounded-m3-full/);
        expect(html).not.toContain('!rounded-m3-full');
        expect(html).toContain('!bg-m3-secondary-container');
        expect(html).toContain('!bg-m3-surface-container-high');
        expect(html).toContain('aria-label="Home"');
        expect(html).toContain('aria-label="Documents with a very long folder name"');
        expect(html).toContain('aria-label="Close Home"');

        // Tab roots use native <button role="tab"> with non-button close triggers (never nested <button> inside <button>)
        expect(html).toMatch(/<button[^>]*role="tab"/);
        expect(html).toContain('<span role="button" tabindex="-1" aria-label="Close Home"');

        // External New Tab button renders outside role="tablist"
        const tablistEnd = html.lastIndexOf('</fieldset>');
        const newTabIdx = html.indexOf('aria-label="New tab"');
        expect(tablistEnd).toBeGreaterThan(-1);
        expect(newTabIdx).toBeGreaterThan(tablistEnd);

        // Connected ButtonGroup drives per-corner radii natively on motion.button without asChild/static border-radius overrides
        const secondTabMatch = html.match(/<button[^>]*data-tab-id="t2"[^>]*>/);
        expect(secondTabMatch?.[0]).toBeDefined();
        expect(secondTabMatch?.[0]).not.toContain('border-radius:9999px');
    });

    test('hides close buttons when only one tab is open', () => {
        const html = renderToStaticMarkup(
            <TabBar
                tabs={[sampleTabs[0]]}
                activeTabId="t1"
                onTabClick={() => {}}
                onTabClose={() => {}}
                onNewTab={() => {}}
            />
        );

        expect(html).not.toContain('aria-label="Close Home"');
        expect(html).toContain('aria-label="New tab"');
    });
});

describe('FileList standardization', () => {
    const sampleFiles: IFile[] = [
        makeFile('docs', { isDirectory: true }),
        makeFile('notes.md', { size: 512 }),
        makeFile('photo.png', { size: 4096 }),
    ];

    test('renders single active sort arrow across all 4 fields and exposes .file-list-header and .file-list-item', () => {
        const fields: SortField[] = ['name', 'date', 'type', 'size'];

        for (const field of fields) {
            const ascHtml = renderToStaticMarkup(
                <FileList
                    files={sampleFiles}
                    selectedFiles={new Set()}
                    onSelect={() => {}}
                    onNavigate={() => {}}
                    viewMode="list"
                    iconSize={64}
                    filledIcons
                    groupingEnabled
                    sortBy={field}
                    sortOrder="asc"
                />
            );

            expect(ascHtml).toContain('file-list-header');
            expect(ascHtml).toContain('file-list-item');
            expect(ascHtml).toContain('aria-sort="ascending"');
            expect(ascHtml.match(/>arrow_upward</g)?.length ?? 0).toBe(1);
            expect(ascHtml.match(/>arrow_downward</g)?.length ?? 0).toBe(0);

            const descHtml = renderToStaticMarkup(
                <FileList
                    files={sampleFiles}
                    selectedFiles={new Set()}
                    onSelect={() => {}}
                    onNavigate={() => {}}
                    viewMode="list"
                    iconSize={64}
                    filledIcons
                    groupingEnabled
                    sortBy={field}
                    sortOrder="desc"
                />
            );

            expect(descHtml).toContain('aria-sort="descending"');
            expect(descHtml.match(/>arrow_downward</g)?.length ?? 0).toBe(1);
            expect(descHtml.match(/>arrow_upward</g)?.length ?? 0).toBe(0);
        }
    });

    test('virtualizes 1,500 files down to O(visible + overscan) mounted rows using fallbackHeight', () => {
        const largeFiles = Array.from({ length: 1500 }, (_, i) => makeFile(`file-${i}.txt`));

        const html = renderToStaticMarkup(
            <FileList
                files={largeFiles}
                selectedFiles={new Set()}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="list"
                iconSize={64}
                filledIcons
                groupingEnabled={false}
                sortBy="name"
                sortOrder="asc"
            />
        );

        const mountedRows = html.match(/class="[^"]*\bfile-list-item\b/g)?.length ?? 0;
        expect(mountedRows).toBeGreaterThan(5);
        expect(mountedRows).toBeLessThanOrEqual(25);
        expect(html).toContain('role="presentation" aria-hidden="true"');
    });

    test('gates item morphing via shouldEnableItemMorph in large folders except for selected rows', () => {
        expect(shouldEnableItemMorph(25, false)).toBe(true);
        expect(shouldEnableItemMorph(500, false)).toBe(false);
        expect(shouldEnableItemMorph(500, true)).toBe(true);
    });

    test('uses content-start on grid container with min-h-full so few-item folders do not stretch rows', () => {
        const html = renderToStaticMarkup(
            <FileList
                files={[makeFile('a.txt'), makeFile('b.txt')]}
                selectedFiles={new Set()}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="grid"
                iconSize={64}
                filledIcons
                groupingEnabled={false}
                sortBy="name"
                sortOrder="asc"
            />
        );
        expect(html).toContain('grid content-start gap-3 p-4 pb-24 min-h-full');
    });
});

describe('FileListSkeleton standardization', () => {
    test('renders h-14 segmented list skeleton rows matching FileList geometry', () => {
        const html = renderToStaticMarkup(<FileListSkeleton viewMode="list" count={4} />);

        expect(html).toContain('gap-[2px]');
        expect(html.match(/\bh-14\b/g)?.length ?? 0).toBe(4);
        expect(html).toContain('rounded-t-m3-lg rounded-b-m3-xs');
        expect(html).toContain('rounded-m3-xs');
        expect(html).toContain('rounded-t-m3-xs rounded-b-m3-lg');
        expect(html).toContain('file-meta-grid');
    });
});

describe('ExplorerTab standardization', () => {
    test('renders Type sort button, vertical Divider, and removes toolbar border-b', () => {
        const html = withMockLocalStorage(() =>
            renderToStaticMarkup(
                <ToastProvider>
                    <ClipboardProvider>
                        <ExplorerTab
                            tabId="t1"
                            isActive
                            initialPath="/tmp/demo"
                            onPathChange={() => {}}
                            onContextMenu={() => {}}
                            showHiddenFiles={false}
                            iconSize={64}
                            viewMode="list"
                            filledIcons
                        />
                    </ClipboardProvider>
                </ToastProvider>
            )
        );

        expect(html).toContain('aria-label="Back"');
        expect(html).toContain('aria-label="Forward"');
        expect(html).toContain('aria-label="Up"');
        expect(html).toContain('aria-label="Sort by Type"');
        expect(html).toContain('>category<');
        expect(html).toContain('aria-orientation="vertical"');
        expect(html.match(/<fieldset\b/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
        expect(html).toContain('rounded-[24px] overflow-hidden bg-m3-surface-container-low');
        expect(html).not.toContain('[scrollbar-gutter:stable]');
        expect(html).not.toContain('border-b border-m3-outline-variant/30');

        // Enabled toolbar buttons inside ButtonGroups remain keyboard-reachable (never forced to tabindex="-1")
        for (const label of ['Up', 'Sort by Name', 'Sort by Date', 'Sort by Type', 'Sort by Size', 'Toggle Sort Order']) {
            const btnMatch = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`));
            expect(btnMatch?.[0]).toBeDefined();
            expect(btnMatch?.[0]).not.toContain('tabindex="-1"');
        }
    });

    test('resolves Space Quick Look target from selection first and falls back to focused .file-list-item', () => {
        const fileA = makeFile('alpha.txt');
        const fileB = makeFile('beta.txt');
        const files = [fileA, fileB];

        const fakeFocusedItem = {
            closest: (selector: string) =>
                selector === '.file-list-item'
                    ? { getAttribute: (attr: string) => (attr === 'data-file-path' ? fileB.path : null) }
                    : null,
        } as unknown as Element;

        // With active selection, selection takes precedence
        expect(
            resolveSpaceQuickLookTarget(new Set([fileA.path]), fileA.path, files, fakeFocusedItem)
        ).toEqual(fileA);

        // With empty selection, falls back to focused .file-list-item[data-file-path]
        expect(resolveSpaceQuickLookTarget(new Set(), null, files, fakeFocusedItem)).toEqual(fileB);

        // Returns null when neither selected nor focused in sortedFiles
        expect(resolveSpaceQuickLookTarget(new Set(), null, files, null)).toBeNull();
    });
});

describe('Omnibar standardization', () => {
    test('uses tonal bg-m3-surface-container-highest in edit mode without ring-2', () => {
        const html = renderToStaticMarkup(
            <Omnibar
                currentPath="/home/user"
                onNavigate={() => {}}
                onSearch={() => {}}
                defaultEditing
            />
        );

        expect(html).toContain('bg-m3-surface-container-highest');
        expect(html).toContain('aria-label="Location or search"');
        expect(html).not.toContain('ring-2');
    });
});

describe('Phase 4 Views & Overlays standardization', () => {
    test('ContextMenu uses role="menu", role="menuitem", MD3 Divider role="separator", and zero shadow-xl/border', () => {
        const html = renderToStaticMarkup(
            <ContextMenu
                x={120}
                y={80}
                onClose={() => {}}
                items={[
                    { label: 'Open', icon: 'open_in_new', action: () => {} },
                    { label: '', divider: true, action: () => {} },
                    { label: 'Properties', icon: 'info', action: () => {} },
                ]}
            />
        );

        expect(html).toContain('role="menu"');
        expect(html.match(/role="menuitem"/g)?.length ?? 0).toBe(2);
        expect(html).toContain('role="separator"');
        expect(html).toContain('bg-m3-surface-container-high');
        expect(html).not.toContain('shadow-xl');
        expect(html).not.toContain('border-m3-outline-variant/40');
    });

    test('OpenWithDialog renders two separate segmented List sections with external Divider', () => {
        const sharedApp = { name: 'Neovim', icon: null, exec: 'nvim %F' };
        const html = renderToStaticMarkup(
            <OpenWithDialog
                open
                onClose={() => {}}
                onSelect={() => {}}
                path="/tmp/test.ts"
                initialRecommendedApps={[sharedApp]}
                initialAllApps={[sharedApp, { name: 'Code', icon: null, exec: 'code %F' }]}
            />
        );

        expect(html).toContain('Recommended');
        expect(html).toContain('All Applications');
        expect(html).toContain('role="separator"');
        expect(html.match(/role="listbox"/g)?.length ?? 0).toBe(2);
        expect(html).toContain('aria-label="Recommended applications"');
        expect(html).toContain('aria-label="All applications"');
    });

    test('Dashboard removes shadows, dashed borders, and uses opaque tonal Bento cards', () => {
        const html = withMockLocalStorage(
            () => renderToStaticMarkup(<Dashboard onNavigate={() => {}} />),
            {
                'dashboard.pinned': JSON.stringify([{ name: 'Home', path: '/home/user' }]),
                'dashboard.recent': JSON.stringify([]),
            }
        );

        expect(html).not.toContain('shadow-xs');
        expect(html).not.toContain('border-dashed');
        expect(html).not.toContain('border-m3-outline-variant/50');
        expect(html).not.toContain('bg-m3-surface-container-highest/90');
        expect(html).toContain('bg-m3-surface-container-highest');
        expect(html).toContain('bg-m3-surface-container');
    });

    test('SettingsDialog removes section borders and swatch rings/shadows while keeping opaque containers', () => {
        const html = withMockLocalStorage(
            () =>
                renderToStaticMarkup(
                    <AppThemeProvider>
                        <SettingsDialog
                            open
                            onClose={() => {}}
                            showHiddenFiles={false}
                            onToggleHiddenFiles={() => {}}
                            iconSize={64}
                            onIconSizeChange={() => {}}
                            viewMode="grid"
                            onViewModeChange={() => {}}
                            filledIcons
                            onToggleFilledIcons={() => {}}
                        />
                    </AppThemeProvider>
                ),
            {
                customCssPath: JSON.stringify('/tmp/custom.css'),
            }
        );

        expect(html).not.toContain('bg-m3-surface-container-high/60');
        expect(html).not.toContain('border-t border-m3-outline-variant/40');
        expect(html).not.toContain('ring-2 ring-m3-on-surface');
        expect(html).not.toContain('shadow-xs');
        expect(html).not.toContain('bg-m3-primary-container/30');
        expect(html).toContain('bg-m3-surface-container');
        expect(html).toContain('bg-m3-surface-container-low');
        expect(html).toContain('bg-m3-secondary-container');
        expect(html).toContain('backdrop-blur-sm');
        expect(html.match(/<div[^>]*data-radix-scroll-area-viewport/g)?.length ?? 0).toBe(1);
    });

    test('QuickLook retains backdrop scrim while removing modal borders, shadows, and header rule', () => {
        const imageFile = makeFile('preview.png');
        const html = renderToStaticMarkup(
            <QuickLook
                file={imageFile}
                files={[imageFile]}
                onClose={() => {}}
                onSelectFile={() => {}}
                onOpenExternal={() => {}}
            />
        );

        expect(html).toContain('bg-black/55 backdrop-blur-xs');
        expect(html).toContain('bg-m3-surface-container-high');
        expect(html).toContain('bg-m3-surface-container');
        expect(html).not.toContain('shadow-2xl');
        expect(html).not.toContain('shadow-md');
        expect(html).not.toContain('border-b border-m3-outline-variant/40');
        expect(html).not.toContain('border border-m3-outline-variant/40');
    });

    test('PropertiesDialog uses opaque bg-m3-surface-container instead of translucent bg-m3-surface-container-high/50', () => {
        const html = renderToStaticMarkup(
            <PropertiesDialog
                file={makeFile('report.pdf')}
                open
                onClose={() => {}}
            />
        );

        expect(html).toContain('bg-m3-surface-container');
        expect(html).not.toContain('bg-m3-surface-container-high/50');
    });
});

describe('Shell & StatusBar radius standardization', () => {
    test('StatusBar uses rounded-m3-full and Sidebar NavigationDrawer uses !rounded-[24px]', () => {
        const statusHtml = renderToStaticMarkup(
            <StatusBar itemCount={5} selectedCount={0} />
        );
        expect(statusHtml).toContain('rounded-m3-full');
        expect(statusHtml).not.toContain('rounded-m3-lg');

        const sidebarHtml = withMockLocalStorage(() =>
            renderToStaticMarkup(
                <Sidebar
                    currentPath="/tmp"
                    onNavigate={() => {}}
                    collapsed={false}
                />
            )
        );
        expect(sidebarHtml).toContain('!rounded-[24px]');
        expect(sidebarHtml).not.toContain('rounded-m3-xl');
    });
});
