import { describe, expect, test } from 'bun:test';
import { MD3Shapes } from '@bug-on/m3-expressive';
import { GROUP_ORDER } from '../fileUtils';
import {
  LARGE_FOLDER_MORPH_LIMIT,
  getFileGroupShapePair,
  getPinnedIndexShapePair,
  shouldEnableItemMorph,
} from '../shapeUtils';

describe('shapeUtils', () => {
  test('every semantic group in GROUP_ORDER maps to valid MD3Shapes keys', () => {
    const validKeys = new Set(Object.keys(MD3Shapes));
    for (const group of GROUP_ORDER) {
      const pair = getFileGroupShapePair(group, group === 'Folders');
      expect(validKeys.has(pair.rest)).toBe(true);
      expect(validKeys.has(pair.morph)).toBe(true);
      expect(pair.containerClass.length).toBeGreaterThan(0);
    }
  });

  test('getPinnedIndexShapePair cycles through valid MD3Shapes keys', () => {
    const validKeys = new Set(Object.keys(MD3Shapes));
    for (let i = 0; i < 10; i++) {
      const pair = getPinnedIndexShapePair(i);
      expect(validKeys.has(pair.rest)).toBe(true);
      expect(validKeys.has(pair.morph)).toBe(true);
    }
  });

  test('shouldEnableItemMorph disables morph on unselected items when folder exceeds 300 items', () => {
    expect(shouldEnableItemMorph(150, false)).toBe(true);
    expect(shouldEnableItemMorph(LARGE_FOLDER_MORPH_LIMIT, false)).toBe(true);
    expect(shouldEnableItemMorph(LARGE_FOLDER_MORPH_LIMIT + 1, false)).toBe(false);
    expect(shouldEnableItemMorph(5000, true)).toBe(true);
  });
});
