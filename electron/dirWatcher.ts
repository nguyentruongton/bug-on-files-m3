import fs, { type FSWatcher } from 'fs';

export type WatchEvent =
  | { id: number; type: 'change' }
  | { id: number; type: 'error'; message: string };

interface WatcherEntry {
  watcher: FSWatcher;
  timer: ReturnType<typeof setTimeout> | null;
}

export class DirWatchers {
  private nextId = 1;
  private readonly watchers = new Map<number, WatcherEntry>();
  private readonly emit: (e: WatchEvent) => void;
  private readonly debounceMs: number;

  constructor(emit: (e: WatchEvent) => void, debounceMs: number = 150) {
    this.emit = emit;
    this.debounceMs = debounceMs;
  }

  start(dir: string): number {
    const id = this.nextId++;
    try {
      const watcher = fs.watch(dir, { persistent: false }, () => {
        this.scheduleDebounce(id);
      });

      watcher.on('error', (err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.emit({ id, type: 'error', message });
        this.stop(id);
      });

      this.watchers.set(id, { watcher, timer: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ id, type: 'error', message });
    }
    return id;
  }

  stop(id: number): void {
    const entry = this.watchers.get(id);
    if (!entry) return;

    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }

    try {
      entry.watcher.close();
    } catch {
      // Ignore close errors
    }

    this.watchers.delete(id);
  }

  stopAll(): void {
    const ids = Array.from(this.watchers.keys());
    for (const id of ids) {
      this.stop(id);
    }
  }

  private scheduleDebounce(id: number): void {
    const entry = this.watchers.get(id);
    if (!entry) return;

    if (entry.timer !== null) {
      clearTimeout(entry.timer);
    }

    entry.timer = setTimeout(() => {
      const current = this.watchers.get(id);
      if (!current) return;
      current.timer = null;
      this.emit({ id, type: 'change' });
    }, this.debounceMs);
  }
}
