import { describe, expect, test } from 'bun:test';
import { resolveInitialPins, type PinnedItem } from '../dashboardUtils';

const mockPlaces = [
  { name: 'Home', path: '/home/stark' },
  { name: 'Desktop', path: '/home/stark/Desktop' },
  { name: 'Documents', path: '/home/stark/Documents' },
  { name: 'Downloads', path: '/home/stark/Downloads' },
];

describe('resolveInitialPins', () => {
  test('builds default Home, Downloads, Documents pins when savedPins is empty', () => {
    expect(resolveInitialPins([], mockPlaces)).toEqual([
      { name: 'Home', path: '/home/stark' },
      { name: 'Downloads', path: '/home/stark/Downloads' },
      { name: 'Documents', path: '/home/stark/Documents' },
    ]);
  });

  test('migrates legacy /home/bhimio pins while preserving custom user pins', () => {
    const legacyPins: PinnedItem[] = [
      { name: 'Home', path: '/home/bhimio' },
      { name: 'Downloads', path: '/home/bhimio/Downloads' },
      { name: 'Documents', path: '/home/bhimio/Documents' },
      { name: 'Projects', path: '/home/stark/Projects' },
    ];
    expect(resolveInitialPins(legacyPins, mockPlaces)).toEqual([
      { name: 'Home', path: '/home/stark' },
      { name: 'Downloads', path: '/home/stark/Downloads' },
      { name: 'Documents', path: '/home/stark/Documents' },
      { name: 'Projects', path: '/home/stark/Projects' },
    ]);
  });

  test('preserves valid non-legacy user pins without re-adding unpinned defaults', () => {
    const userPins: PinnedItem[] = [{ name: 'Projects', path: '/home/stark/Projects' }];
    expect(resolveInitialPins(userPins, mockPlaces)).toEqual(userPins);
  });
});
