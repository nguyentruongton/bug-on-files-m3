import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IFile } from '../../types/files';
import { getGridCardHeight } from '../../utils/fileListUtils';
import type { ResolvedDropTarget } from '../../utils/dropTargetUtils';
import { FileList } from '../FileList';
import { Sidebar } from '../Sidebar';
import { TabBar, type Tab } from '../TabBar';

function makeFile(name: string, overrides: Partial<IFile> = {}): IFile {
    return {
        name,
        path: `/home/u/${name}`,
        isDirectory: false,
        size: 1024,
        mtime: new Date('2026-05-01T10:00:00Z'),
        ...overrides,
    };
}

describe('FileList drop target markup', () => {
    const files: IFile[] = [
        makeFile('docs', { isDirectory: true }),
        makeFile('notes', { isDirectory: true }),
        makeFile('readme.txt'),
    ];

    test('renders folder drop attributes and active highlight in list mode without changing h-14', () => {
        const activeTarget: ResolvedDropTarget = {
            kind: 'folder',
            path: '/home/u/docs',
            source: 'filelist',
        };

        const html = renderToStaticMarkup(
            <FileList
                files={files}
                selectedFiles={new Set()}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="list"
                iconSize={64}
                filledIcons
                groupingEnabled={false}
                activeDropTarget={activeTarget}
            />
        );

        expect(html).toContain('data-drop-scroll-container="true"');
        expect(html).toContain('data-drop-folder-path="/home/u/docs"');
        expect(html).toContain('data-drop-folder-path="/home/u/notes"');
        expect(html).not.toContain('data-drop-folder-path="/home/u/readme.txt"');

        const docsRow = html.match(/<div[^>]*data-file-path="\/home\/u\/docs"[^>]*>/)?.[0] ?? '';
        expect(docsRow).toContain('data-drop-active="true"');
        expect(docsRow).toContain('ring-2 ring-inset ring-m3-primary');
        expect(docsRow).toContain('h-14');

        const notesRow = html.match(/<div[^>]*data-file-path="\/home\/u\/notes"[^>]*>/)?.[0] ?? '';
        expect(notesRow).not.toContain('data-drop-active="true"');
        expect(notesRow).not.toContain('bg-m3-primary-container/35');
    });

    test('renders folder drop attributes and active highlight in grid mode without changing card height', () => {
        const activeTarget: ResolvedDropTarget = {
            kind: 'folder',
            path: '/home/u/docs',
            source: 'filelist',
        };
        const expectedHeight = getGridCardHeight(64);

        const html = renderToStaticMarkup(
            <FileList
                files={files}
                selectedFiles={new Set()}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="grid"
                iconSize={64}
                filledIcons
                groupingEnabled={false}
                activeDropTarget={activeTarget}
            />
        );

        expect(html).toContain('data-drop-scroll-container="true"');
        expect(html).toContain('data-drop-folder-path="/home/u/docs"');
        expect(html).not.toContain('data-drop-folder-path="/home/u/readme.txt"');
        expect(html).toContain(`height:${expectedHeight}px`);

        const docsCard = html.match(/<div[^>]*data-file-path="\/home\/u\/docs"[^>]*>/)?.[0] ?? '';
        expect(docsCard).toContain('data-drop-active="true"');
        expect(docsCard).toContain('ring-2 ring-inset ring-m3-primary');
        expect(docsCard).toContain('h-full');
    });

    test('omits data-drop-folder-path when isTrash is true in both list and grid modes', () => {
        for (const viewMode of ['list', 'grid'] as const) {
            const html = renderToStaticMarkup(
                <FileList
                    files={files}
                    selectedFiles={new Set()}
                    onSelect={() => {}}
                    onNavigate={() => {}}
                    viewMode={viewMode}
                    iconSize={64}
                    filledIcons={false}
                    isTrash={true}
                    activeDropTarget={{ kind: 'folder', path: '/home/u/docs', source: 'filelist' }}
                />
            );

            expect(html).not.toContain('data-drop-folder-path=');
            expect(html).not.toContain('data-drop-active="true"');
        }
    });

    test('does not highlight FileList folder when activeDropTarget comes from sidebar or explorer-root', () => {
        for (const source of ['sidebar', 'explorer-root'] as const) {
            const html = renderToStaticMarkup(
                <FileList
                    files={files}
                    selectedFiles={new Set()}
                    onSelect={() => {}}
                    onNavigate={() => {}}
                    viewMode="list"
                    iconSize={64}
                    filledIcons
                    activeDropTarget={{ kind: 'folder', path: '/home/u/docs', source }}
                />
            );

            expect(html).not.toContain('data-drop-active="true"');
        }
    });
});

describe('Sidebar drop target markup', () => {
    const places = [
        { name: 'Home', path: '/home/u', icon: 'home' },
        { name: 'Downloads', path: '/home/u/Downloads', icon: 'download' },
    ];
    const drives = [
        {
            name: 'nvme0n1p2',
            label: 'System',
            mountpoint: '/',
            size: '500G',
            type: 'ext4',
            removable: false,
            usb: false,
        },
        {
            name: 'sdb1',
            label: 'USB Drive',
            mountpoint: '/mnt/usb',
            size: '32G',
            type: 'vfat',
            removable: true,
            usb: true,
        },
    ];

    function extractDivWrapper(html: string, startRegex: RegExp): string {
        const match = html.match(startRegex);
        if (!match || match.index === undefined) return '';
        const start = match.index;
        let depth = 0;
        let cursor = start;
        while (cursor < html.length) {
            const openIdx = html.indexOf('<div', cursor);
            const closeIdx = html.indexOf('</div>', cursor);
            if (closeIdx === -1) break;
            if (openIdx !== -1 && openIdx < closeIdx) {
                depth += 1;
                cursor = openIdx + 4;
            } else {
                depth -= 1;
                cursor = closeIdx + 6;
                if (depth === 0) {
                    return html.slice(start, cursor);
                }
            }
        }
        return '';
    }

    function expectActiveDropOverlay(wrapperHtml: string) {
        const openTag = wrapperHtml.match(/^<div[^>]*>/)?.[0] ?? '';
        expect(openTag).toContain('relative');
        expect(openTag).toContain('data-drop-active="true"');

        const buttonTag = wrapperHtml.match(/<button[^>]*>/)?.[0] ?? '';
        expect(buttonTag).not.toContain('ring-2 ring-inset ring-m3-primary');

        expect(wrapperHtml).toMatch(
            /<div[^>]*aria-hidden="true"[^>]*class="[^"]*pointer-events-none[^"]*absolute[^"]*inset-0[^"]*z-20[^"]*rounded-full[^"]*ring-2[^"]*ring-inset[^"]*ring-m3-primary[^"]*bg-m3-primary-container\/35[^"]*"/
        );
    }

    test('renders sidebar, scroll viewport, trash, place, and device drop markup', () => {
        const html = renderToStaticMarkup(
            <Sidebar
                currentPath="/home/u"
                onNavigate={() => {}}
                initialPlaces={places}
                initialDrives={drives}
                activeDropTarget={{ kind: 'trash' }}
            />
        );

        expect(html).toContain('data-drop-sidebar="true"');
        expect(html).toContain('data-drop-scroll-container="true"');
        expect(html).toContain('data-drop-trash="true"');
        expect(html).toContain('data-drop-folder-path="/home/u/Downloads"');
        expect(html).toContain('data-drop-folder-path="/mnt/usb"');

        const trashSection = extractDivWrapper(html, /<div[^>]*data-drop-trash="true"[^>]*>/);
        expectActiveDropOverlay(trashSection);
    });

    test('highlights matching Place or Device path in Sidebar when activeDropTarget matches', () => {
        const placeHtml = renderToStaticMarkup(
            <Sidebar
                currentPath="/home/u"
                onNavigate={() => {}}
                initialPlaces={places}
                initialDrives={drives}
                activeDropTarget={{ kind: 'folder', path: '/home/u/Downloads', source: 'sidebar' }}
            />
        );

        const placeSection = extractDivWrapper(
            placeHtml,
            /<div[^>]*data-drop-folder-path="\/home\/u\/Downloads"[^>]*>/
        );
        expectActiveDropOverlay(placeSection);

        const driveHtml = renderToStaticMarkup(
            <Sidebar
                currentPath="/home/u"
                onNavigate={() => {}}
                initialPlaces={places}
                initialDrives={drives}
                activeDropTarget={{ kind: 'folder', path: '/mnt/usb', source: 'sidebar' }}
            />
        );

        const driveSection = extractDivWrapper(
            driveHtml,
            /<div[^>]*data-drop-folder-path="\/mnt\/usb"[^>]*>/
        );
        expectActiveDropOverlay(driveSection);

        const fallbackHtml = renderToStaticMarkup(
            <Sidebar
                currentPath="/home/u"
                onNavigate={() => {}}
                activeDropTarget={{ kind: 'folder', path: '/', source: 'sidebar' }}
            />
        );
        const computerSection = extractDivWrapper(
            fallbackHtml,
            /<div[^>]*data-drop-folder-path="\/"[^>]*>/
        );
        expectActiveDropOverlay(computerSection);
    });

    test('renders z-20 drop overlay above selected Sidebar items (Place, Device, Trash)', () => {
        const selectedPlaceHtml = renderToStaticMarkup(
            <Sidebar
                currentPath="/home/u/Downloads"
                onNavigate={() => {}}
                initialPlaces={places}
                initialDrives={drives}
                activeDropTarget={{ kind: 'folder', path: '/home/u/Downloads', source: 'sidebar' }}
            />
        );
        const selectedPlaceSection = extractDivWrapper(
            selectedPlaceHtml,
            /<div[^>]*data-drop-folder-path="\/home\/u\/Downloads"[^>]*>/
        );
        expect(selectedPlaceSection).toContain('aria-current="page"');
        expect(selectedPlaceSection).toContain('bg-m3-secondary-container');
        expectActiveDropOverlay(selectedPlaceSection);

        const selectedDeviceHtml = renderToStaticMarkup(
            <Sidebar
                currentPath="/etc"
                onNavigate={() => {}}
                initialPlaces={places}
                initialDrives={drives}
                activeDropTarget={{ kind: 'folder', path: '/', source: 'sidebar' }}
            />
        );
        const selectedDeviceSection = extractDivWrapper(
            selectedDeviceHtml,
            /<div[^>]*data-drop-folder-path="\/"[^>]*>/
        );
        expect(selectedDeviceSection).toContain('aria-current="page"');
        expect(selectedDeviceSection).toContain('bg-m3-secondary-container');
        expectActiveDropOverlay(selectedDeviceSection);

        const selectedTrashHtml = renderToStaticMarkup(
            <Sidebar
                currentPath="app://trash"
                onNavigate={() => {}}
                initialPlaces={places}
                initialDrives={drives}
                activeDropTarget={{ kind: 'trash' }}
            />
        );
        const selectedTrashSection = extractDivWrapper(
            selectedTrashHtml,
            /<div[^>]*data-drop-trash="true"[^>]*>/
        );
        expect(selectedTrashSection).toContain('aria-current="page"');
        expect(selectedTrashSection).toContain('bg-m3-secondary-container');
        expectActiveDropOverlay(selectedTrashSection);
    });
});

describe('TabBar drop target markup', () => {
    const tabs: Tab[] = [
        { id: 't1', path: '/home/u', title: 'Home' },
        { id: 't2', path: '/home/u/Documents', title: 'Documents' },
        { id: 't3', path: 'app://trash', title: 'Trash' },
    ];

    test('renders data-drop-tab-id on tab buttons and highlights matching tab target', () => {
        const html = renderToStaticMarkup(
            <TabBar
                tabs={tabs}
                activeTabId="t1"
                onTabClick={() => {}}
                onTabClose={() => {}}
                onNewTab={() => {}}
                activeDropTarget={{ kind: 'tab', tabId: 't2', path: '/home/u/Documents' }}
            />
        );

        expect(html).toContain('data-drop-tab-id="t1"');
        expect(html).toContain('data-drop-tab-id="t2"');
        expect(html).toContain('data-drop-tab-id="t3"');

        const tab2 = html.match(/<button[^>]*data-drop-tab-id="t2"[^>]*>/)?.[0] ?? '';
        expect(tab2).toContain('data-drop-active="true"');
        expect(tab2).toContain('ring-2 ring-inset ring-m3-primary');

        const tab1 = html.match(/<button[^>]*data-drop-tab-id="t1"[^>]*>/)?.[0] ?? '';
        expect(tab1).not.toContain('data-drop-active="true"');
    });

    test('highlights app://trash tab when activeDropTarget is trash', () => {
        const html = renderToStaticMarkup(
            <TabBar
                tabs={tabs}
                activeTabId="t1"
                onTabClick={() => {}}
                onTabClose={() => {}}
                onNewTab={() => {}}
                activeDropTarget={{ kind: 'trash' }}
            />
        );

        const trashTab = html.match(/<button[^>]*data-drop-tab-id="t3"[^>]*>/)?.[0] ?? '';
        expect(trashTab).toContain('data-drop-active="true"');
        expect(trashTab).toContain('ring-2 ring-inset ring-m3-primary');

        const homeTab = html.match(/<button[^>]*data-drop-tab-id="t1"[^>]*>/)?.[0] ?? '';
        expect(homeTab).not.toContain('data-drop-active="true"');
    });
});
