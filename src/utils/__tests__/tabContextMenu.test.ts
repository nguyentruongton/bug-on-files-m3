import { describe, expect, test } from 'bun:test';
import {
  buildTabContextMenuItems,
  buildTabBarContextMenuItems,
} from '../tabContextMenu';

describe('buildTabContextMenuItems', () => {
  test('returns Pin tab, Close tab, and Close Others for unpinned tab when other unpinned tabs exist', () => {
    const calls: string[] = [];
    const items = buildTabContextMenuItems({
      tab: { id: '2', pinned: false },
      canClose: true,
      hasClosableOthers: true,
      onTogglePin: () => calls.push('pin'),
      onCloseTab: () => calls.push('close'),
      onCloseOthers: () => calls.push('closeOthers'),
    });

    expect(items.map((i) => i.label)).toEqual(['Pin tab', 'Close tab', 'Close Others']);
    items.forEach((i) => i.action());
    expect(calls).toEqual(['pin', 'close', 'closeOthers']);
  });

  test('returns Unpin tab and Close tab (omits Close Others) when all other tabs are pinned', () => {
    const items = buildTabContextMenuItems({
      tab: { id: '1', pinned: true },
      canClose: true,
      hasClosableOthers: false,
      onTogglePin: () => {},
      onCloseTab: () => {},
      onCloseOthers: () => {},
    });

    expect(items.map((i) => i.label)).toEqual(['Unpin tab', 'Close tab']);
  });

  test('omits Close tab and Close Others when only one tab is open', () => {
    const items = buildTabContextMenuItems({
      tab: { id: '1', pinned: false },
      canClose: false,
      hasClosableOthers: false,
      onTogglePin: () => {},
      onCloseTab: () => {},
      onCloseOthers: () => {},
    });

    expect(items.map((i) => i.label)).toEqual(['Pin tab']);
  });
});

describe('buildTabBarContextMenuItems', () => {
  test('returns About and Quit items invoking their callbacks', () => {
    const calls: string[] = [];
    const items = buildTabBarContextMenuItems({
      onAbout: () => calls.push('about'),
      onQuit: () => calls.push('quit'),
    });

    expect(items.map((i) => i.label)).toEqual(['About', 'Quit']);
    items.forEach((i) => i.action());
    expect(calls).toEqual(['about', 'quit']);
  });
});
