import { describe, expect, test } from 'bun:test';
import { getExtractCommand, parseDesktopEntry, matchesMimeType, resolvePlaces } from '../systemUtils';

describe('getExtractCommand', () => {
  test('builds safe unzip args for .zip with shell metacharacters in path', () => {
    const file = '/tmp/my "archive" $(whoami).zip';
    expect(getExtractCommand(file)).toEqual({
      cmd: 'unzip',
      args: ['-o', file, '-d', '/tmp'],
    });
  });

  test('builds safe tar args for .tar, .gz, .xz, .tgz', () => {
    for (const ext of ['.tar', '.tar.gz', '.gz', '.tar.xz', '.xz', '.tgz']) {
      const file = `/home/user/archive${ext}`;
      expect(getExtractCommand(file)).toEqual({
        cmd: 'tar',
        args: ['-xf', file, '-C', '/home/user'],
      });
    }
  });

  test('returns null for unsupported extensions', () => {
    expect(getExtractCommand('/home/user/notes.txt')).toBeNull();
  });
});

describe('parseDesktopEntry & matchesMimeType', () => {
  const sampleDesktop = `
[Desktop Entry]
Name=Visual Studio Code
Exec=/usr/share/code/code --unity-launch %F
Icon=vscode
Type=Application
NoDisplay=false
MimeType=text/plain;inode/directory;application/x-code-workspace;
`;

  test('parses Name, Icon, cleaned Exec, NoDisplay, and MimeType list', () => {
    const parsed = parseDesktopEntry(sampleDesktop, '/usr/share/applications/code.desktop');
    expect(parsed).toEqual({
      name: 'Visual Studio Code',
      icon: 'vscode',
      exec: '/usr/share/code/code --unity-launch',
      noDisplay: false,
      mimeTypes: ['text/plain', 'inode/directory', 'application/x-code-workspace'],
      path: '/usr/share/applications/code.desktop',
    });
  });

  test('marks NoDisplay=true entries accurately', () => {
    const hidden = `[Desktop Entry]\nName=HiddenHelper\nExec=helper %u\nNoDisplay=true\n`;
    expect(parseDesktopEntry(hidden)?.noDisplay).toBe(true);
  });

  test('matches exact MIME type from parsed list', () => {
    expect(matchesMimeType(['text/plain', 'image/png'], 'image/png')).toBe(true);
    expect(matchesMimeType(['text/plain', 'image/png'], 'image/jpeg')).toBe(false);
  });
});

describe('resolvePlaces', () => {
  test('falls back to ~/FolderName when getSystemPath returns homeDir or throws', () => {
    const places = resolvePlaces('/home/stark', (key) => {
      if (key === 'home') return '/home/stark';
      if (key === 'documents') return '/home/stark';
      if (key === 'downloads') return '/home/stark/';
      if (key === 'music') throw new Error('not configured');
      return `/home/stark/${key[0].toUpperCase()}${key.slice(1)}`;
    });

    expect(places).toEqual([
      { name: 'Home', path: '/home/stark', icon: '🏠' },
      { name: 'Desktop', path: '/home/stark/Desktop', icon: '🖥️' },
      { name: 'Documents', path: '/home/stark/Documents', icon: '📄' },
      { name: 'Downloads', path: '/home/stark/Downloads', icon: '⬇️' },
      { name: 'Music', path: '/home/stark/Music', icon: '🎵' },
      { name: 'Pictures', path: '/home/stark/Pictures', icon: '🖼️' },
      { name: 'Videos', path: '/home/stark/Videos', icon: '🎥' },
    ]);
  });
});
