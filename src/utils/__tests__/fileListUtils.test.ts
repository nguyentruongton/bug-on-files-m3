import { describe, expect, test } from 'bun:test';
import type { IFile } from '../../types/files';
import {
    buildDisplayEntries,
    compareFiles,
    normalizeSortField,
} from '../fileListUtils';
import { calculateVirtualRange } from '../../hooks/useVirtualWindow';

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
});
