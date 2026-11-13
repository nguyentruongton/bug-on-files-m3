import type { MD3ShapeName } from '@bug-on/m3-expressive';
import { isAudioFile, isVideoFile } from './fileUtils';

export const LARGE_FOLDER_MORPH_LIMIT = 300;

export interface ShapePair {
  rest: MD3ShapeName;
  morph: MD3ShapeName;
  containerClass: string;
}

const IMAGE_SHAPE_PAIR: ShapePair = {
  rest: 'clover4Leaf',
  morph: 'sunny',
  containerClass: 'bg-m3-tertiary-container text-m3-on-tertiary-container',
};

const VIDEO_SHAPE_PAIR: ShapePair = {
  rest: 'pill',
  morph: 'softBurst',
  containerClass: 'bg-m3-secondary-container text-m3-on-secondary-container',
};

const AUDIO_SHAPE_PAIR: ShapePair = {
  rest: 'cookie6Sided',
  morph: 'verySunny',
  containerClass: 'bg-m3-tertiary-container text-m3-on-tertiary-container',
};

const OTHERS_SHAPE_PAIR: ShapePair = {
  rest: 'square',
  morph: 'cookie4Sided',
  containerClass: 'bg-m3-surface-container-highest text-m3-on-surface-variant',
};

const SHAPE_PAIR_MAP: Record<string, ShapePair> = {
  Folders: {
    rest: 'cookie4Sided',
    morph: 'flower',
    containerClass: 'bg-m3-primary-container text-m3-on-primary-container',
  },
  Media: IMAGE_SHAPE_PAIR,
  Images: IMAGE_SHAPE_PAIR,
  Videos: VIDEO_SHAPE_PAIR,
  Audio: AUDIO_SHAPE_PAIR,
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
  Archives: {
    rest: 'pentagon',
    morph: 'cookie9Sided',
    containerClass: 'bg-m3-secondary-container text-m3-on-secondary-container',
  },
  Executables: {
    rest: 'softBurst',
    morph: 'boom',
    containerClass: 'bg-m3-tertiary-container text-m3-on-tertiary-container',
  },
  Others: OTHERS_SHAPE_PAIR,
  Files: OTHERS_SHAPE_PAIR,
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
export function getFileGroupShapePair(
  group: string,
  isDirectory: boolean,
  fileName?: string,
  mediaKind?: 'video',
): ShapePair {
  if (isDirectory) {
    return SHAPE_PAIR_MAP.Folders;
  }
  if (mediaKind === 'video') {
    return VIDEO_SHAPE_PAIR;
  }
  if (group === 'Media' && fileName) {
    if (isVideoFile(fileName)) return VIDEO_SHAPE_PAIR;
    if (isAudioFile(fileName)) return AUDIO_SHAPE_PAIR;
    return IMAGE_SHAPE_PAIR;
  }
  return SHAPE_PAIR_MAP[group] ?? OTHERS_SHAPE_PAIR;
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
