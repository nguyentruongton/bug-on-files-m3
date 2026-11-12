import type { MD3ShapeName } from '@bug-on/m3-expressive';

export const LARGE_FOLDER_MORPH_LIMIT = 300;

export interface ShapePair {
  rest: MD3ShapeName;
  morph: MD3ShapeName;
  containerClass: string;
}

const SHAPE_PAIR_MAP: Record<string, ShapePair> = {
  Folders: {
    rest: 'cookie4Sided',
    morph: 'flower',
    containerClass: 'bg-m3-primary-container text-m3-on-primary-container',
  },
  Images: {
    rest: 'clover4Leaf',
    morph: 'sunny',
    containerClass: 'bg-m3-tertiary-container text-m3-on-tertiary-container',
  },
  Videos: {
    rest: 'pill',
    morph: 'softBurst',
    containerClass: 'bg-m3-secondary-container text-m3-on-secondary-container',
  },
  Audio: {
    rest: 'cookie6Sided',
    morph: 'verySunny',
    containerClass: 'bg-m3-tertiary-container text-m3-on-tertiary-container',
  },
  Archives: {
    rest: 'pentagon',
    morph: 'cookie9Sided',
    containerClass: 'bg-m3-secondary-container text-m3-on-secondary-container',
  },
  Documents: {
    rest: 'arch',
    morph: 'clover8Leaf',
    containerClass: 'bg-m3-surface-container-highest text-m3-primary',
  },
  Code: {
    rest: 'slanted',
    morph: 'diamond',
    containerClass: 'bg-m3-secondary-container text-m3-on-secondary-container',
  },
  Files: {
    rest: 'square',
    morph: 'cookie4Sided',
    containerClass: 'bg-m3-surface-container-highest text-m3-on-surface-variant',
  },
};

const PINNED_SHAPE_PAIRS: ReadonlyArray<{ rest: MD3ShapeName; morph: MD3ShapeName }> = [
  { rest: 'cookie4Sided', morph: 'flower' },
  { rest: 'clover4Leaf', morph: 'sunny' },
  { rest: 'pill', morph: 'softBurst' },
  { rest: 'arch', morph: 'clover8Leaf' },
  { rest: 'cookie6Sided', morph: 'verySunny' },
  { rest: 'pentagon', morph: 'cookie9Sided' },
];

/** Returns the resting shape, hover/selection morph target, and container colors for a file group. */
export function getFileGroupShapePair(group: string, isDirectory: boolean): ShapePair {
  if (isDirectory) {
    return SHAPE_PAIR_MAP.Folders;
  }
  return SHAPE_PAIR_MAP[group] ?? SHAPE_PAIR_MAP.Files;
}

/** Cycles pinned-folder badges across curated expressive shape pairs. */
export function getPinnedIndexShapePair(
  index: number,
): { rest: MD3ShapeName; morph: MD3ShapeName } {
  const safeIndex = Math.abs(Math.trunc(index)) % PINNED_SHAPE_PAIRS.length;
  return PINNED_SHAPE_PAIRS[safeIndex];
}

/** Guards shape morphing so unselected items in large (>300 item) folders avoid extra hover observers. */
export function shouldEnableItemMorph(totalItems: number, isSelected: boolean): boolean {
  return isSelected || totalItems <= LARGE_FOLDER_MORPH_LIMIT;
}
