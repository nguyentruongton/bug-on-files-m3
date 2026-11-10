export interface PinnedItem {
  name: string;
  path: string;
  icon?: string;
}

const DEFAULT_PIN_ORDER = ['Home', 'Downloads', 'Documents'];

function isLegacyBhimioPath(targetPath: string): boolean {
  return targetPath === '/home/bhimio' || targetPath.startsWith('/home/bhimio/');
}

export function resolveInitialPins(
  savedPins: PinnedItem[],
  places: Array<{ name: string; path: string }>
): PinnedItem[] {
  const validSaved = savedPins.filter((pin) => !isLegacyBhimioPath(pin.path));
  const hadLegacy = validSaved.length !== savedPins.length;

  if (savedPins.length > 0 && !hadLegacy) {
    return savedPins;
  }

  const placeByName = new Map(places.map((p) => [p.name, p]));
  const defaults: PinnedItem[] = [];
  for (const name of DEFAULT_PIN_ORDER) {
    const place = placeByName.get(name);
    if (place) {
      defaults.push({ name: place.name, path: place.path });
    }
  }

  const seenPaths = new Set(defaults.map((d) => d.path));
  const merged = [...defaults];
  for (const pin of validSaved) {
    if (!seenPaths.has(pin.path)) {
      seenPaths.add(pin.path);
      merged.push(pin);
    }
  }

  return merged;
}
