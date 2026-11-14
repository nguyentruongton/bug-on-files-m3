import { describe, expect, test } from 'bun:test';
import {
  createHistory,
  pushHistory,
  stepBack,
  stepForward,
  resolveTerminalTargetDir,
  resolveAfterTabClose,
  normalizePath,
  getActiveDriveMountpoint,
  togglePinTab,
  closeOtherTabs,
  hasClosableOtherTabs,
} from '../navigationHistory';

describe('navigationHistory', () => {
  test('pushes new paths and ignores consecutive duplicate paths', () => {
    let h = createHistory('/home/stark');
    h = pushHistory(h, '/home/stark');
    expect(h).toEqual({ entries: ['/home/stark'], index: 0 });

    h = pushHistory(h, '/home/stark/Documents');
    expect(h).toEqual({ entries: ['/home/stark', '/home/stark/Documents'], index: 1 });
  });

  test('steps back and forward within bounds and truncates forward branch on new push', () => {
    let h = createHistory('/a');
    h = pushHistory(h, '/b');
    h = pushHistory(h, '/c');

    const back1 = stepBack(h);
    expect(back1.path).toBe('/b');
    h = back1.state;

    const back2 = stepBack(h);
    expect(back2.path).toBe('/a');
    h = back2.state;

    expect(stepBack(h).path).toBeNull();

    const fwd1 = stepForward(h);
    expect(fwd1.path).toBe('/b');
    h = fwd1.state;

    h = pushHistory(h, '/d');
    expect(h).toEqual({ entries: ['/a', '/b', '/d'], index: 2 });
    expect(stepForward(h).path).toBeNull();
  });
});

describe('resolveTerminalTargetDir', () => {
  test('returns null for app:// pseudo-paths', () => {
    expect(resolveTerminalTargetDir('app://dashboard', true)).toBeNull();
  });

  test('returns directory path directly when target is a directory', () => {
    expect(resolveTerminalTargetDir('/home/stark/Downloads', true)).toBe('/home/stark/Downloads');
  });

  test('returns parent directory when target is a file', () => {
    expect(resolveTerminalTargetDir('/home/stark/Downloads/report.pdf', false)).toBe('/home/stark/Downloads');
    expect(resolveTerminalTargetDir('/file-at-root.txt', false)).toBe('/');
  });
});

describe('resolveAfterTabClose', () => {
  test('syncs terminalCwd to newly active tab when closing active tab', () => {
    const tabs = [
      { id: '1', title: 'tmp', path: '/tmp' },
      { id: '2', title: 'stark', path: '/home/stark' },
    ];
    expect(resolveAfterTabClose(tabs, '2', '2', '/home/stark')).toEqual({
      tabs: [{ id: '1', title: 'tmp', path: '/tmp' }],
      activeTabId: '1',
      terminalCwd: '/tmp',
    });
  });

  test('clears terminalCwd when newly active tab is app://dashboard or no tabs remain', () => {
    const tabs = [
      { id: '1', title: 'Dashboard', path: 'app://dashboard' },
      { id: '2', title: 'tmp', path: '/tmp' },
    ];
    expect(resolveAfterTabClose(tabs, '2', '2', '/tmp')).toEqual({
      tabs: [{ id: '1', title: 'Dashboard', path: 'app://dashboard' }],
      activeTabId: '1',
      terminalCwd: undefined,
    });
    expect(resolveAfterTabClose([{ id: '2', title: 'tmp', path: '/tmp' }], '2', '2', '/tmp')).toEqual({
      tabs: [],
      activeTabId: '',
      terminalCwd: undefined,
    });
  });

  test('preserves activeTabId and terminalCwd when closing an inactive tab', () => {
    const tabs = [
      { id: '1', title: 'tmp', path: '/tmp' },
      { id: '2', title: 'stark', path: '/home/stark' },
    ];
    expect(resolveAfterTabClose(tabs, '2', '1', '/home/stark/Downloads')).toEqual({
      tabs: [{ id: '2', title: 'stark', path: '/home/stark' }],
      activeTabId: '2',
      terminalCwd: '/home/stark/Downloads',
    });
  });
});

describe('normalizePath and getActiveDriveMountpoint', () => {
  test('normalizes trailing slashes while preserving root /', () => {
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('/home/stark/')).toBe('/home/stark');
    expect(normalizePath('/home/stark')).toBe('/home/stark');
  });

  test('selects the longest matching mountpoint for a path', () => {
    const mounts = ['/', '/home', '/run/media/stark/USB'];
    expect(getActiveDriveMountpoint('/home/stark/Documents', mounts)).toBe('/home');
    expect(getActiveDriveMountpoint('/run/media/stark/USB/photos', mounts)).toBe('/run/media/stark/USB');
    expect(getActiveDriveMountpoint('/etc/nginx', mounts)).toBe('/');
    expect(getActiveDriveMountpoint('app://dashboard', mounts)).toBeNull();
  });
});

describe('togglePinTab, closeOtherTabs, and hasClosableOtherTabs', () => {
  test('togglePinTab pins an unpinned tab and moves it to the end of the pinned group', () => {
    const tabs = [
      { id: '1', title: 'A', path: '/a', pinned: true },
      { id: '2', title: 'B', path: '/b' },
      { id: '3', title: 'C', path: '/c' },
    ];
    expect(togglePinTab(tabs, '3')).toEqual([
      { id: '1', title: 'A', path: '/a', pinned: true },
      { id: '3', title: 'C', path: '/c', pinned: true },
      { id: '2', title: 'B', path: '/b' },
    ]);
  });

  test('togglePinTab unpins a pinned tab and moves it to the start of the unpinned group', () => {
    const tabs = [
      { id: '1', title: 'A', path: '/a', pinned: true },
      { id: '2', title: 'B', path: '/b', pinned: true },
      { id: '3', title: 'C', path: '/c' },
    ];
    expect(togglePinTab(tabs, '1')).toEqual([
      { id: '2', title: 'B', path: '/b', pinned: true },
      { id: '1', title: 'A', path: '/a', pinned: false },
      { id: '3', title: 'C', path: '/c' },
    ]);
  });

  test('closeOtherTabs keeps target tab and all pinned tabs, removing other unpinned tabs', () => {
    const tabs = [
      { id: '1', title: 'Pinned', path: '/pinned', pinned: true },
      { id: '2', title: 'Keep', path: '/keep' },
      { id: '3', title: 'Drop', path: '/drop' },
    ];
    expect(closeOtherTabs(tabs, '2', '2', '/keep')).toEqual({
      tabs: [
        { id: '1', title: 'Pinned', path: '/pinned', pinned: true },
        { id: '2', title: 'Keep', path: '/keep' },
      ],
      activeTabId: '2',
      terminalCwd: '/keep',
    });
  });

  test('closeOtherTabs switches activeTabId to keepId and updates terminalCwd when active tab is closed', () => {
    const tabs = [
      { id: '1', title: 'Dashboard', path: 'app://dashboard' },
      { id: '2', title: 'Active', path: '/active' },
    ];
    expect(closeOtherTabs(tabs, '2', '1', '/active')).toEqual({
      tabs: [{ id: '1', title: 'Dashboard', path: 'app://dashboard' }],
      activeTabId: '1',
      terminalCwd: undefined,
    });
  });

  test('hasClosableOtherTabs returns true only when at least one other unpinned tab exists', () => {
    expect(
      hasClosableOtherTabs(
        [
          { id: '1', title: 'A', path: '/a', pinned: true },
          { id: '2', title: 'B', path: '/b' },
        ],
        '2'
      )
    ).toBe(false);

    expect(
      hasClosableOtherTabs(
        [
          { id: '1', title: 'A', path: '/a', pinned: true },
          { id: '2', title: 'B', path: '/b' },
          { id: '3', title: 'C', path: '/c' },
        ],
        '2'
      )
    ).toBe(true);
  });
});
