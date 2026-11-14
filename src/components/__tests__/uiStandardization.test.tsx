import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IFile } from '../../types/files';
import { AppThemeProvider } from '../../contexts/AppThemeContext';
import { ClipboardProvider } from '../../contexts/ClipboardContext';
import { ToastProvider } from '../../contexts/ToastContext';
import type { SortField } from '../../utils/fileListUtils';
import { resolveExtractProgressPercent } from '../../utils/explorerTabUtils';
import { resolveSpaceQuickLookTarget } from '../../utils/quickLook';
import { getFileGroupShapePair, shouldEnableItemMorph } from '../../utils/shapeUtils';
import { AboutDialog } from '../AboutDialog';
import { ContextMenu } from '../ContextMenu';
import { Dashboard } from '../Dashboard';
import { Dialog } from '../Dialog';
import { ExplorerTab } from '../ExplorerTab';
import { ExpressiveShape } from '../ExpressiveShape';
import { FileList } from '../FileList';
import { FileListSkeleton } from '../FileListSkeleton';
import { Icon } from '../Icon';
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

        // Active tab icon uses filled Material Symbol ('FILL' 1), inactive uses outlined ('FILL' 0)
        const tab1Match = html.match(/<button[^>]*data-tab-id="t1"[\s\S]*?<\/button>/);
        const tab2Match = html.match(/<button[^>]*data-tab-id="t2"[\s\S]*?<\/button>/);
        expect(tab1Match?.[0]).toMatch(/(&#x27;|')FILL(&#x27;|')\s*1/);
        expect(tab2Match?.[0]).toMatch(/(&#x27;|')FILL(&#x27;|')\s*0/);
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

    test('renders FileList item shapes by selection state without hover morphing', () => {
        const docs = makeFile('Documents', { isDirectory: true });
        const downloads = makeFile('Downloads', { isDirectory: true });
        const selected = new Set([docs.path]);

        const folderPair = getFileGroupShapePair('Folders', true);
        const expectedMorphHtml = renderToStaticMarkup(
            <ExpressiveShape shape={folderPair.morph} width={80} height={80} />
        );
        const expectedRestHtml = renderToStaticMarkup(
            <ExpressiveShape shape={folderPair.rest} width={80} height={80} />
        );
        const morphClip = expectedMorphHtml.match(/clip-path:(path\([^)]+\))/)?.[1];
        const restClip = expectedRestHtml.match(/clip-path:(path\([^)]+\))/)?.[1];
        expect(morphClip).toBeTruthy();
        expect(restClip).toBeTruthy();
        expect(morphClip).not.toBe(restClip);

        const gridHtml = renderToStaticMarkup(
            <FileList
                files={[docs, downloads]}
                selectedFiles={selected}
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
        expect(gridHtml).toContain(morphClip!);
        expect(gridHtml).toContain(restClip!);

        const fileListSource = readFileSync(
            resolve(import.meta.dir, '../FileList.tsx'),
            'utf8'
        );
        const rowMatch = fileListSource.match(/const leadingContent = \(\s*<ExpressiveShape[\s\S]*?<\/ExpressiveShape>/);
        const gridMatch = fileListSource.match(/aria-pressed=\{isSelected\}[\s\S]*?<ExpressiveShape[\s\S]*?<\/ExpressiveShape>/);
        expect(rowMatch?.[0]).toContain('morphOn="none"');
        expect(rowMatch?.[0]).not.toContain('morphOn="hover"');
        expect(rowMatch?.[0]).not.toContain('morphTo=');
        expect(gridMatch?.[0]).toContain('morphOn="none"');
        expect(gridMatch?.[0]).not.toContain('morphOn="hover"');
        expect(gridMatch?.[0]).not.toContain('morphTo=');
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
    test('renders standalone IconButtons with aria-pressed and animateFill icons, vertical Divider, and zero ButtonGroup fieldsets', () => {
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
                            onToggleHiddenFiles={() => {}}
                            iconSize={64}
                            viewMode="list"
                            onViewModeChange={() => {}}
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
        expect(html.match(/<fieldset\b/g)?.length ?? 0).toBe(0);
        expect(html).toContain('rounded-[24px] overflow-hidden bg-m3-surface-container-low');
        expect(html).not.toContain('[scrollbar-gutter:stable]');
        expect(html).not.toContain('border-b border-m3-outline-variant/30');

        // Enabled toolbar buttons remain keyboard-reachable and expose aria-pressed + FILL state for toggles
        for (const label of ['Up', 'Sort by Name', 'Sort by Date', 'Sort by Type', 'Sort by Size', 'Toggle Sort Order']) {
            const btnMatch = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`));
            expect(btnMatch?.[0]).toBeDefined();
            expect(btnMatch?.[0]).not.toContain('tabindex="-1"');
        }

        const toggleExpectations: Array<{ label: string; pressed: 'true' | 'false'; fill: '0' | '1' }> = [
            { label: 'Show Hidden Files', pressed: 'false', fill: '0' },
            { label: 'Disable Category Grouping', pressed: 'true', fill: '1' },
            { label: 'Sort by Name', pressed: 'true', fill: '1' },
            { label: 'Sort by Date', pressed: 'false', fill: '0' },
            { label: 'Sort by Type', pressed: 'false', fill: '0' },
            { label: 'Sort by Size', pressed: 'false', fill: '0' },
            { label: 'Switch to Grid View', pressed: 'true', fill: '1' },
        ];
        for (const item of toggleExpectations) {
            const fullBtn = html.match(
                new RegExp(`<button[^>]*aria-label="${item.label}"[\\s\\S]*?<\\/button>`)
            );
            expect(fullBtn?.[0]).toContain(`aria-pressed="${item.pressed}"`);
            expect(fullBtn?.[0]).toMatch(new RegExp(`(&#x27;|')FILL(&#x27;|')\\s*${item.fill}`));
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

    test('resolveExtractProgressPercent maps null/undefined/NaN to undefined for indeterminate wavy ProgressIndicator', () => {
        expect(resolveExtractProgressPercent(null)).toBeUndefined();
        expect(resolveExtractProgressPercent(undefined)).toBeUndefined();
        expect(resolveExtractProgressPercent(Number.NaN)).toBeUndefined();
        expect(resolveExtractProgressPercent(0)).toBe(0);
        expect(resolveExtractProgressPercent(42.6)).toBe(43);
        expect(resolveExtractProgressPercent(100)).toBe(100);
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
    test('Dialog adds pt-2 to DialogBody content container so outlined TextField floating labels are not clipped', () => {
        const html = renderToStaticMarkup(
            <Dialog open onClose={() => {}} title="New Folder">
                <div>Body content</div>
            </Dialog>
        );
        expect(html).toContain('pt-2');
    });

    test('Icon supports fill={1}, fill={0}, and animateFill with font-variation-settings', () => {
        const filledHtml = renderToStaticMarkup(<Icon name="folder" fill={1} animateFill />);
        expect(filledHtml).toMatch(/(&#x27;|')FILL(&#x27;|')\s*1/);

        const outlinedHtml = renderToStaticMarkup(<Icon name="folder" fill={0} animateFill />);
        expect(outlinedHtml).toMatch(/(&#x27;|')FILL(&#x27;|')\s*0/);
    });

    test('ContextMenu uses Expressive VerticalMenu, VerticalMenuGroup role="group", MenuItem role="menuitem", and filters empty divider groups', () => {
        const html = renderToStaticMarkup(
            <ContextMenu
                x={120}
                y={80}
                onClose={() => {}}
                items={[
                    { label: '', divider: true, action: () => {} },
                    { label: 'Open', icon: 'open_in_new', action: () => {} },
                    { label: '', divider: true, action: () => {} },
                    { label: '', divider: true, action: () => {} },
                    { label: 'Properties', icon: 'info', action: () => {} },
                    { label: '', divider: true, action: () => {} },
                ]}
            />
        );

        expect(html).toContain('role="menu"');
        expect(html.match(/role="group"/g)?.length ?? 0).toBe(2);
        expect(html.match(/role="menuitem"/g)?.length ?? 0).toBe(2);
        expect(html).toContain('bg-m3-surface-container-low');
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

describe('Trash UI support in Sidebar, Omnibar, SettingsDialog, and PropertiesDialog', () => {
    test('Sidebar renders Trash item in Places and marks it selected with filled icon when currentPath is app://trash', () => {
        const html = renderToStaticMarkup(
            <Sidebar onNavigate={() => {}} currentPath="app://trash" collapsed={false} />
        );
        expect(html).toContain('Trash');
        expect(html).toContain('>delete<');
        const trashBtn = html.match(/<button[^>]*aria-label="Trash"[\s\S]*?<\/button>|<button[^>]*>[\s\S]*?>Trash<[\s\S]*?<\/button>/);
        expect(trashBtn?.[0]).toMatch(/(&#x27;|')FILL(&#x27;|')\s*1/);
    });

    test('Omnibar displays Trash title and delete icon when currentPath is app://trash', () => {
        const html = renderToStaticMarkup(
            <Omnibar currentPath="app://trash" onNavigate={() => {}} onSearch={() => {}} />
        );
        expect(html).toContain('Trash');
        expect(html).toContain('>delete<');
    });

    test('SettingsDialog renders Confirm before moving to Trash switch', () => {
        const html = withMockLocalStorage(() =>
            renderToStaticMarkup(
                <AppThemeProvider>
                    <SettingsDialog
                        open={true}
                        onClose={() => {}}
                        showHiddenFiles={true}
                        onToggleHiddenFiles={() => {}}
                        iconSize={64}
                        onIconSizeChange={() => {}}
                        viewMode="grid"
                        onViewModeChange={() => {}}
                        filledIcons={false}
                        onToggleFilledIcons={() => {}}
                        confirmTrash={true}
                        onToggleConfirmTrash={() => {}}
                    />
                </AppThemeProvider>
            )
        );
        expect(html).toContain('Confirm before moving to Trash');
        expect(html).toContain('Ask for confirmation before moving files or folders to Trash');
    });

    test('PropertiesDialog shows Original Location and Deleted timestamp for trashed items', () => {
        const trashedFile = makeFile('old.txt', {
            path: '/home/stark/.local/share/Trash/files/old.txt',
            originalParent: '/home/stark/Documents',
            trashId: '/home/stark/.local/share/Trash/info/old.txt.trashinfo',
        });
        const html = renderToStaticMarkup(
            <PropertiesDialog open={true} onClose={() => {}} file={trashedFile} />
        );
        expect(html).toContain('Original Location');
        expect(html).toContain('/home/stark/Documents');
        expect(html).toContain('Deleted');
    });
});

describe('Trash view in FileList and ExplorerTab', () => {
    test('FileList renders empty trash state when isTrash is true and files is empty', () => {
        const html = renderToStaticMarkup(
            <FileList
                files={[]}
                selectedFiles={new Set()}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="list"
                iconSize={64}
                filledIcons={false}
                isTrash={true}
            />
        );
        expect(html).toContain('Trash is empty');
        expect(html).toContain('Items moved to the trash will appear here.');
        expect(html).toContain('>delete_outline<');
    });

    test('FileList in list and grid view renders Original Location and Date Deleted when isTrash is true', () => {
        const trashed = [
            makeFile('report.pdf', {
                path: '/home/stark/.local/share/Trash/files/report.pdf',
                originalParent: '/home/stark/Documents/work',
                trashId: '/home/stark/.local/share/Trash/info/report.pdf.trashinfo',
            }),
        ];
        const listHtml = renderToStaticMarkup(
            <FileList
                files={trashed}
                selectedFiles={new Set()}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="list"
                iconSize={64}
                filledIcons={false}
                isTrash={true}
                homePath="/home/stark"
            />
        );
        expect(listHtml).toContain('Original Location');
        expect(listHtml).toContain('Date Deleted');
        expect(listHtml).toContain('~/Documents/work');

        const gridHtml = renderToStaticMarkup(
            <FileList
                files={trashed}
                selectedFiles={new Set()}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="grid"
                iconSize={64}
                filledIcons={false}
                isTrash={true}
                homePath="/home/stark"
            />
        );
        expect(gridHtml).toContain('~/Documents/work');
    });

    test('ExplorerTab at app://trash shows Empty Trash button and hides New Folder button', () => {
        const html = withMockLocalStorage(() =>
            renderToStaticMarkup(
                <ToastProvider>
                    <ClipboardProvider>
                        <ExplorerTab
                            tabId="trash-tab"
                            isActive={true}
                            initialPath="app://trash"
                            onPathChange={() => {}}
                            onContextMenu={() => {}}
                            onCreateFolderRequest={() => {}}
                            onEmptyTrashRequest={() => {}}
                            showHiddenFiles={true}
                            iconSize={64}
                            viewMode="list"
                            filledIcons={false}
                        />
                    </ClipboardProvider>
                </ToastProvider>
            )
        );
        expect(html).toContain('Empty Trash');
        expect(html).not.toContain('aria-label="New Folder"');
    });
});

describe('Self-hosted M3 fonts & Icon standardization', () => {
    test('AppThemeProvider wraps tree in MaterialSymbolsProvider source="local" and suppresses Google Fonts CDN preinit', () => {
        const html = withMockLocalStorage(() =>
            renderToStaticMarkup(
                <AppThemeProvider>
                    <Icon name="folder" filled />
                </AppThemeProvider>
            )
        );

        expect(html).not.toContain('fonts.googleapis.com');
        expect(html).toContain('md-icon');
        expect(html).toContain('data-icon="folder"');
        expect(html).toMatch(/(&#x27;|')FILL(&#x27;|')\s*1/);
    });

    test('Icon resolves fill vs filled precedence, opticalSize from size, and forwards className and style', () => {
        const explicitZero = renderToStaticMarkup(<Icon name="folder" filled fill={0} size={16} />);
        expect(explicitZero).toMatch(/(&#x27;|')FILL(&#x27;|')\s*0/);
        expect(explicitZero).toMatch(/(&#x27;|')opsz(&#x27;|')\s*20/);
        expect(explicitZero).toContain('font-size:16px');

        const largeFilled = renderToStaticMarkup(
            <Icon name="movie" filled size={48} className="text-m3-primary" style={{ opacity: 0.5 }} />
        );
        expect(largeFilled).toMatch(/(&#x27;|')FILL(&#x27;|')\s*1/);
        expect(largeFilled).toMatch(/(&#x27;|')opsz(&#x27;|')\s*48/);
        expect(largeFilled).toContain('md-icon');
        expect(largeFilled).toContain('text-m3-primary');
        expect(largeFilled).toContain('opacity:0.5');
    });

    test('index.html and src/index.css configure self-hosted @bug-on/m3-fonts and font-md3-expressive without legacy overrides', async () => {
        const indexHtml = await Bun.file('index.html').text();
        const indexCss = await Bun.file('src/index.css').text();

        expect(indexHtml).toContain('font-md3-expressive');
        expect(indexCss).toContain('@import "@bug-on/m3-fonts/typography.css";');
        expect(indexCss).toContain('@import "@bug-on/m3-fonts/material-symbols.css";');
        expect(indexCss).toContain('@import "@bug-on/m3-expressive/typography.css";');
        expect(indexCss).not.toContain('@fontsource/material-symbols-rounded');
        expect(indexCss).not.toContain('.material-symbols-rounded');
        expect(indexCss).not.toContain("font-family: 'Roboto'");
    });
});

describe('AboutDialog', () => {
    test('renders app name, version, and Close action when open', () => {
        const html = renderToStaticMarkup(<AboutDialog open={true} onClose={() => {}} />);
        expect(html).toContain('About Materials');
        expect(html).toContain('Materials');
        expect(html).toContain('0.1.0');
        expect(html).toContain('Close');
    });
});
