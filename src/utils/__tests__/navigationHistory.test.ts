import { describe, expect, test } from 'bun:test';
import {
  createHistory,
  pushHistory,
  stepBack,
  stepForward,
  resolveTerminalTargetDir,
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
