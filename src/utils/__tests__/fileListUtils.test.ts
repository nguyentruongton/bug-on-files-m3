import { describe, expect, test } from 'bun:test';
import type { IFile } from '../../types/files';
import {
    buildDisplayEntries,
    buildVirtualGridEntries,
    collectOutboundDragPaths,
    compareFiles,
    computeGridColumns,
    normalizeSortField,
    resolveGridArrowTarget,
} from '../fileListUtils';
import { calculateVirtualRange, shouldRestoreVirtualScroll } from '../../hooks/useVirtualWindow';

function makeFile(
    name: string,
    overrides: Partial<IFile> = {}
): IFile {
    return {
        name,
        path: `/tmp/${name}`,
        isDirectory: false,
        size: 100,
        mtime: new Date('2026-01-01T00:00:00Z'),
        ...overrides,
    };
}

describe('normalizeSortField', () => {
    test('preserves supported sort fields and defaults unknown values to name', () => {
        expect(normalizeSortField('name')).toBe('name');
        expect(normalizeSortField('date')).toBe('date');
        expect(normalizeSortField('type')).toBe('type');
        expect(normalizeSortField('size')).toBe('size');
        expect(normalizeSortField('legacy')).toBe('name');
        expect(normalizeSortField(undefined)).toBe('name');
        expect(normalizeSortField(42)).toBe('name');
    });
});

describe('compareFiles', () => {
    test('uses natural numeric collation for name sort', () => {
        const files = [makeFile('file10.txt'), makeFile('file2.txt'), makeFile('File1.txt')];
        const asc = [...files].sort((a, b) => compareFiles(a, b, 'name', 'asc', false));
        expect(asc.map((f) => f.name)).toEqual(['File1.txt', 'file2.txt', 'file10.txt']);

        const desc = [...files].sort((a, b) => compareFiles(a, b, 'name', 'desc', false));
        expect(desc.map((f) => f.name)).toEqual(['file10.txt', 'file2.txt', 'File1.txt']);
    });

    test('sorts by extension -> semantic group -> natural name for type sort while keeping GROUP_ORDER', () => {
        const dirA = makeFile('z-folder', { isDirectory: true });
        const md2 = makeFile('note2.md');
        const md10 = makeFile('note10.md');
        const docx = makeFile('a.docx');
        const tsFile = makeFile('index.ts');

        const groupedDesc = [tsFile, docx, md10, md2, dirA].sort((a, b) =>
            compareFiles(a, b, 'type', 'desc', true)
        );
        // Folders group stays first even on desc; Documents precede Code; within Documents, md > docx
        expect(groupedDesc.map((f) => f.name)).toEqual([
            'z-folder',
            'note10.md',
            'note2.md',
            'a.docx',
            'index.ts',
        ]);
    });

    test('keeps folders-first when groupingEnabled is false across type sort directions', () => {
        const dir = makeFile('docs', { isDirectory: true });
        const zip = makeFile('bundle.zip');
        const app = makeFile('main.ts');
        const md = makeFile('readme.md');

        const asc = [zip, app, dir, md].sort((a, b) =>
            compareFiles(a, b, 'type', 'asc', false)
        );
        expect(asc.map((f) => f.name)).toEqual(['docs', 'readme.md', 'main.ts', 'bundle.zip']);

        const desc = [zip, app, dir, md].sort((a, b) =>
            compareFiles(a, b, 'type', 'desc', false)
        );
        expect(desc.map((f) => f.name)).toEqual(['docs', 'bundle.zip', 'main.ts', 'readme.md']);
    });

    test('applies natural name tie-breaker on size and date equality', () => {
        const sameTime = new Date('2026-06-01T12:00:00Z');
        const f10 = makeFile('item10.txt', { size: 512, mtime: sameTime });
        const f2 = makeFile('item2.txt', { size: 512, mtime: sameTime });

        expect(compareFiles(f2, f10, 'size', 'asc', false)).toBeLessThan(0);
        expect(compareFiles(f2, f10, 'date', 'asc', false)).toBeLessThan(0);
    });
});

describe('buildDisplayEntries', () => {
    test('resets segmented position across group header boundaries', () => {
        const files = [
            makeFile('src', { isDirectory: true }),
            makeFile('a.png'),
            makeFile('b.png'),
            makeFile('c.png'),
            makeFile('notes.md'),
        ];

        const entries = buildDisplayEntries(files, true);
        expect(entries.map((e) => (e.kind === 'header' ? `#${e.group}` : `${e.file.name}:${e.position}:${e.fileIndex}`))).toEqual([
            '#Folders',
            'src:solo:0',
            '#Media',
            'a.png:leading:1',
            'b.png:middle:2',
            'c.png:trailing:3',
            '#Documents',
            'notes.md:solo:4',
        ]);
    });

    test('assigns contiguous segmented positions when groupingEnabled is false', () => {
        const files = [makeFile('a.txt'), makeFile('b.txt'), makeFile('c.txt')];
        const entries = buildDisplayEntries(files, false);
        expect(entries.map((e) => (e.kind === 'file' ? `${e.file.name}:${e.position}` : e.key))).toEqual([
            'a.txt:leading',
            'b.txt:middle',
            'c.txt:trailing',
        ]);
    });
});

describe('calculateVirtualRange', () => {
    function buildPrefixSum(heights: number[]) {
        const offsets = new Array<number>(heights.length + 1);
        offsets[0] = 0;
        for (let i = 0; i < heights.length; i++) {
            offsets[i + 1] = offsets[i] + heights[i];
        }
        const totalHeight = heights.length > 0 ? offsets[heights.length] - 2 : 0;
        return { offsets, totalHeight };
    }

    test('returns empty range when itemCount is 0', () => {
        expect(calculateVirtualRange([0], 0, 0, 500, 4)).toEqual({
            startIndex: 0,
            endIndex: -1,
            topSpacerHeight: 0,
            bottomSpacerHeight: 0,
            totalHeight: 0,
        });
    });

    test('uses fallbackHeight when viewportHeight is 0', () => {
        const heights = Array.from({ length: 50 }, () => 58);
        const { offsets, totalHeight } = buildPrefixSum(heights);
        const range = calculateVirtualRange(offsets, totalHeight, 0, 0, 2, 600);
        expect(range.startIndex).toBe(0);
        // ceil(600 / 58) = 11 rows (indices 0..10) + overscan 2 => index 12
        expect(range.endIndex).toBe(12);
        expect(range.topSpacerHeight).toBe(0);
        expect(range.bottomSpacerHeight).toBe(totalHeight - offsets[13]);
    });

    test('computes mixed header (38px) + file (58px) offsets and subtracts 2px List gap from spacers cleanly', () => {
        // 1 header (38), 100 files (58 each)
        const heights = [38, ...Array.from({ length: 100 }, () => 58)];
        const { offsets, totalHeight } = buildPrefixSum(heights);

        const range = calculateVirtualRange(offsets, totalHeight, 600, 400, 2);
        expect(range.startIndex).toBeGreaterThan(0);
        expect(range.endIndex).toBeLessThan(100);
        // Rendered block sum inside flex <List className="gap-[2px]"> equals totalHeight:
        // topSpacer + 2 + sum(rendered element heights + 2 between each) + 2 + bottomSpacer === totalHeight
        let renderedBlockHeight = 0;
        for (let i = range.startIndex; i <= range.endIndex; i++) {
            renderedBlockHeight += heights[i] - 2;
            if (i > range.startIndex) renderedBlockHeight += 2;
        }
        const reconstructedTotal =
            (range.topSpacerHeight > 0 ? range.topSpacerHeight + 2 : 0) +
            renderedBlockHeight +
            (range.bottomSpacerHeight > 0 ? 2 + range.bottomSpacerHeight : 0);

        expect(reconstructedTotal).toBe(totalHeight);
    });

    test('parameterizes gapPx for Grid View (12px gap) and reconstructs totalHeight cleanly', () => {
        const gapPx = 12;
        const rowHeightWithGap = 156 + gapPx; // 64 + 92 + 12 = 168
        const heights = Array.from({ length: 100 }, () => rowHeightWithGap);
        const offsets = new Array<number>(heights.length + 1);
        offsets[0] = 0;
        for (let i = 0; i < heights.length; i++) {
            offsets[i + 1] = offsets[i] + heights[i];
        }
        const totalHeight = offsets[heights.length] - gapPx;

        const range = calculateVirtualRange(offsets, totalHeight, 1200, 600, 2, 600, gapPx);
        expect(range.startIndex).toBeGreaterThan(0);
        expect(range.endIndex).toBeLessThan(99);

        let renderedBlockHeight = 0;
        for (let i = range.startIndex; i <= range.endIndex; i++) {
            renderedBlockHeight += heights[i] - gapPx;
            if (i > range.startIndex) renderedBlockHeight += gapPx;
        }
        const reconstructedTotal =
            (range.topSpacerHeight > 0 ? range.topSpacerHeight + gapPx : 0) +
            renderedBlockHeight +
            (range.bottomSpacerHeight > 0 ? gapPx + range.bottomSpacerHeight : 0);

        expect(reconstructedTotal).toBe(totalHeight);
    });
});

describe('Grid View virtualization helpers', () => {
    test('computeGridColumns matches responsive formula and clamps to minimum 1', () => {
        expect(computeGridColumns(0, 64)).toBe(1);
        expect(computeGridColumns(100, 64)).toBe(1);
        // cardMin = max(116, 64 + 48) = 116; available = 800 - 32 = 768; floor((768 + 12) / (116 + 12)) = floor(780 / 128) = 6
        expect(computeGridColumns(800, 64)).toBe(6);
        // iconSize = 96 -> cardMin = 144; available = 800 - 32 = 768; floor(780 / 156) = 5
        expect(computeGridColumns(800, 96)).toBe(5);
    });

    test('buildVirtualGridEntries chunks flat and grouped files into fixed-height rows with fileIndexToRowIndex mapping', () => {
        const files = [
            makeFile('dir1', { isDirectory: true }),
            makeFile('a.png'),
            makeFile('b.png'),
            makeFile('c.png'),
            makeFile('d.png'),
        ];

        const flat = buildVirtualGridEntries(files, false, 3, 64, 12);
        expect(flat.entries.length).toBe(2);
        expect(flat.entries[0]).toMatchObject({ kind: 'grid-row', startIndex: 0, height: 64 + 92 + 12 });
        expect(flat.entries[1]).toMatchObject({ kind: 'grid-row', startIndex: 3, height: 64 + 92 + 12 });
        expect(flat.fileIndexToRowIndex).toEqual([0, 0, 0, 1, 1]);

        const grouped = buildVirtualGridEntries(files, true, 3, 64, 12);
        // Header(Folders), Row(dir1), Header(Media), Row(a,b,c), Row(d)
        expect(grouped.entries.map((e) => e.kind)).toEqual([
            'header',
            'grid-row',
            'header',
            'grid-row',
            'grid-row',
        ]);
        expect(grouped.entries[0].height).toBe(28 + 12);
        expect(grouped.fileIndexToRowIndex).toEqual([1, 3, 3, 3, 4]);
    });

    test('collectOutboundDragPaths preserves sortedFiles multi-selection order or falls back to clicked file', () => {
        const files = [makeFile('a.png'), makeFile('b.png'), makeFile('c.png')];
        // Dragging a selected file drags all selected files in sortedFiles order
        const selected = new Set([files[2].path, files[0].path]);
        expect(collectOutboundDragPaths(files[2], files, selected)).toEqual([
            '/tmp/a.png',
            '/tmp/c.png',
        ]);
        // Dragging an unselected file drags only that file
        expect(collectOutboundDragPaths(files[1], files, selected)).toEqual(['/tmp/b.png']);
    });

    test('resolveGridArrowTarget steps across visual rows when category grouping leaves partial rows', () => {
        const files = [
            makeFile('folderA', { isDirectory: true }), // 0: Folders row 0, col 0
            makeFile('doc1.md'), // 1: Documents row, col 0
            makeFile('doc2.md'), // 2: Documents row, col 1
            makeFile('img1.png'), // 3: Media row, col 0
            makeFile('img2.png'), // 4: Media row, col 1
            makeFile('img3.png'), // 5: Media row, col 2
            makeFile('img4.png'), // 6: Media row, col 3
        ];
        // Note: buildVirtualGridEntries preserves input order grouping contiguous semantic groups
        const { entries, fileIndexToRowIndex } = buildVirtualGridEntries(files, true, 4, 64, 12);

        // From Folders (0) pressing ArrowDown must land on Documents col 0 (1), NOT skip to 4
        expect(resolveGridArrowTarget(entries, fileIndexToRowIndex, 0, 'ArrowDown', files.length)).toBe(1);
        // From Documents col 1 (2) pressing ArrowDown must land on Media col 1 (4)
        expect(resolveGridArrowTarget(entries, fileIndexToRowIndex, 2, 'ArrowDown', files.length)).toBe(4);
        // From Media col 3 (6) pressing ArrowUp must clamp to Documents last col (2)
        expect(resolveGridArrowTarget(entries, fileIndexToRowIndex, 6, 'ArrowUp', files.length)).toBe(2);
        // ArrowLeft / ArrowRight / Home / End
        expect(resolveGridArrowTarget(entries, fileIndexToRowIndex, 1, 'ArrowLeft', files.length)).toBe(0);
        expect(resolveGridArrowTarget(entries, fileIndexToRowIndex, 1, 'ArrowRight', files.length)).toBe(2);
        expect(resolveGridArrowTarget(entries, fileIndexToRowIndex, 4, 'Home', files.length)).toBe(0);
        expect(resolveGridArrowTarget(entries, fileIndexToRowIndex, 1, 'End', files.length)).toBe(6);
    });

    test('shouldRestoreVirtualScroll waits until container width is measured before restoring non-zero scrollTop', () => {
        expect(
            shouldRestoreVirtualScroll({
                alreadyRestored: false,
                restoreReady: false,
                hasContainer: true,
                targetScrollTop: 4200,
            })
        ).toBe(false);
        expect(
            shouldRestoreVirtualScroll({
                alreadyRestored: false,
                restoreReady: true,
                hasContainer: true,
                targetScrollTop: 4200,
            })
        ).toBe(true);
        expect(
            shouldRestoreVirtualScroll({
                alreadyRestored: true,
                restoreReady: true,
                hasContainer: true,
                targetScrollTop: 4200,
            })
        ).toBe(false);
    });
});
