import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DirWatchers, type WatchEvent } from '../dirWatcher';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('DirWatchers', () => {
  const tempDirs: string[] = [];
  let activeWatchers: DirWatchers[] = [];

  const createTempDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dirwatcher-test-'));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const watcher of activeWatchers) {
      try {
        watcher.stopAll();
      } catch {
        // ignore
      }
    }
    activeWatchers = [];

    for (const dir of tempDirs) {
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch {
        // ignore
      }
    }
    tempDirs.length = 0;
  });

  test('creating a file emits exactly one change for that id within 500ms', async () => {
    const dir = createTempDir();
    const events: WatchEvent[] = [];
    const watchers = new DirWatchers((e) => events.push(e), 30);
    activeWatchers.push(watchers);

    const id = watchers.start(dir);
    fs.writeFileSync(path.join(dir, 'test.txt'), 'content');

    await sleep(200);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ id, type: 'change' });
  });

  test('creating 50 files in a tight loop emits <= 3 change events', async () => {
    const dir = createTempDir();
    const events: WatchEvent[] = [];
    const watchers = new DirWatchers((e) => events.push(e), 30);
    activeWatchers.push(watchers);

    const id = watchers.start(dir);
    for (let i = 0; i < 50; i++) {
      fs.writeFileSync(path.join(dir, `file-${i}.txt`), `data-${i}`);
    }

    await sleep(200);

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.length).toBeLessThanOrEqual(3);
    for (const e of events) {
      expect(e).toEqual({ id, type: 'change' });
    }
  });

  test('after stop(id), creating a file emits nothing (wait 200ms); calling stop twice does not throw', async () => {
    const dir = createTempDir();
    const events: WatchEvent[] = [];
    const watchers = new DirWatchers((e) => events.push(e), 30);
    activeWatchers.push(watchers);

    const id = watchers.start(dir);
    watchers.stop(id);
    expect(() => watchers.stop(id)).not.toThrow();

    fs.writeFileSync(path.join(dir, 'after-stop.txt'), 'hello');
    await sleep(200);

    expect(events).toEqual([]);
  });

  test("start('/nonexistent/xyz') emits one error event and returns an id; stop(id) is safe", async () => {
    const events: WatchEvent[] = [];
    const watchers = new DirWatchers((e) => events.push(e), 30);
    activeWatchers.push(watchers);

    const id = watchers.start(path.join(os.tmpdir(), 'nonexistent-xyz-' + Date.now()));
    expect(typeof id).toBe('number');

    await sleep(50);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ id, type: 'error', message: expect.any(String) });
    expect(() => watchers.stop(id)).not.toThrow();
  });

  test('deleting the watched directory emits an error or change event and does not throw', async () => {
    const dir = createTempDir();
    const events: WatchEvent[] = [];
    const watchers = new DirWatchers((e) => events.push(e), 30);
    activeWatchers.push(watchers);

    const id = watchers.start(dir);
    expect(() => {
      fs.rmdirSync(dir);
    }).not.toThrow();

    await sleep(200);

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(['change', 'error']).toContain(events[0].type);
    expect(events[0].id).toBe(id);
    expect(() => watchers.stop(id)).not.toThrow();
  });

  test('stopAll() stops every watcher', async () => {
    const dir1 = createTempDir();
    const dir2 = createTempDir();
    const events: WatchEvent[] = [];
    const watchers = new DirWatchers((e) => events.push(e), 30);
    activeWatchers.push(watchers);

    const id1 = watchers.start(dir1);
    const id2 = watchers.start(dir2);
    watchers.stopAll();

    fs.writeFileSync(path.join(dir1, 'file1.txt'), 'a');
    fs.writeFileSync(path.join(dir2, 'file2.txt'), 'b');

    await sleep(200);

    expect(events).toEqual([]);
  });

  test('uses default debounceMs of 150ms when unspecified', async () => {
    const dir = createTempDir();
    const events: WatchEvent[] = [];
    const watchers = new DirWatchers((e) => events.push(e));
    activeWatchers.push(watchers);

    const id = watchers.start(dir);
    fs.writeFileSync(path.join(dir, 'default-debounce.txt'), 'data');

    await sleep(50);
    expect(events).toHaveLength(0);

    await sleep(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ id, type: 'change' });
  });
});
