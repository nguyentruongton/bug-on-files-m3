import { describe, expect, test } from 'bun:test';
import {
  getExtractCommand,
  getVerboseExtractCommand,
  getListEntriesCommand,
  parseExtractedEntryLine,
  isPasswordError,
  getCompressCommand,
  resolveCommonParentAndRelPaths,
  parseCompressedEntryLine,
  parseOsReleaseAndCommand,
  formatMissingToolError,
  parseDesktopEntry,
  matchesMimeType,
  resolvePlaces,
} from '../systemUtils';

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

  test('builds safe unrar args for .rar with shell metacharacters and optional destDir', () => {
    const file = '/tmp/my "archive" $(whoami).rar';
    expect(getExtractCommand(file)).toEqual({
      cmd: 'unrar',
      args: ['x', '-o+', '-p-', file, '/tmp/'],
    });
    expect(getExtractCommand('/tmp/a.rar', '/tmp/out')).toEqual({
      cmd: 'unrar',
      args: ['x', '-o+', '-p-', '/tmp/a.rar', '/tmp/out/'],
    });
    expect(getExtractCommand('/tmp/a.RAR', '/tmp/out/')).toEqual({
      cmd: 'unrar',
      args: ['x', '-o+', '-p-', '/tmp/a.RAR', '/tmp/out/'],
    });
  });

  test('supports custom destDir for zip and tar', () => {
    expect(getExtractCommand('/tmp/a.zip', '/tmp/out')).toEqual({
      cmd: 'unzip',
      args: ['-o', '/tmp/a.zip', '-d', '/tmp/out'],
    });
    expect(getVerboseExtractCommand('/tmp/a.tar', '/tmp/out')).toEqual({
      cmd: 'tar',
      args: ['-xvf', '/tmp/a.tar', '-C', '/tmp/out'],
    });
    expect(getVerboseExtractCommand('/tmp/a.rar', '/tmp/out')).toEqual({
      cmd: 'unrar',
      args: ['x', '-o+', '-p-', '/tmp/a.rar', '/tmp/out/'],
    });
  });

  test('returns null for unsupported extensions', () => {
    expect(getExtractCommand('/home/user/notes.txt')).toBeNull();
  });
});

describe('getListEntriesCommand', () => {
  test('builds list command for zip, tar, and rar', () => {
    expect(getListEntriesCommand('/tmp/a.zip')).toEqual({ cmd: 'unzip', args: ['-Z1', '/tmp/a.zip'] });
    expect(getListEntriesCommand('/tmp/a.tar.gz')).toEqual({ cmd: 'tar', args: ['-tf', '/tmp/a.tar.gz'] });
    expect(getListEntriesCommand('/tmp/a.rar')).toEqual({ cmd: 'unrar', args: ['lb', '-p-', '/tmp/a.rar'] });
    expect(getListEntriesCommand('/tmp/a.txt')).toBeNull();
  });
});

describe('parseExtractedEntryLine & isPasswordError', () => {
  test('parses unrar Extracting and Creating lines and ignores headers', () => {
    expect(parseExtractedEntryLine('unrar', 'Extracting  a/b.txt     OK')).toBe('a/b.txt');
    expect(parseExtractedEntryLine('unrar', 'Creating    folder                    OK')).toBe('folder');
    expect(parseExtractedEntryLine('unrar', 'UNRAR 7.00 freeware')).toBeNull();
    expect(parseExtractedEntryLine('unrar', 'Extracting from /tmp/a.rar')).toBeNull();
  });

  test('detects password-protected archive errors', () => {
    expect(isPasswordError('The specified password is incorrect.')).toBe(true);
    expect(isPasswordError('Enter password (will not be echoed)')).toBe(true);
    expect(isPasswordError('Incorrect password')).toBe(true);
    expect(isPasswordError('Wrong password')).toBe(true);
    expect(isPasswordError('Password is required')).toBe(true);
    expect(isPasswordError('Extracting  a/b.txt     OK')).toBe(false);
  });
});

describe('getCompressCommand & parseCompressedEntryLine', () => {
  test('builds zip and tar.gz compression commands with -- option terminator', () => {
    expect(getCompressCommand('/tmp/out.zip', ['a.txt', 'b'], 'zip')).toEqual({
      cmd: 'zip',
      args: ['-r', '/tmp/out.zip', '--', 'a.txt', 'b'],
    });
    expect(getCompressCommand('/tmp/out.tar.gz', ['a.txt', 'b'], 'tar.gz')).toEqual({
      cmd: 'tar',
      args: ['-czvf', '/tmp/out.tar.gz', '--', 'a.txt', 'b'],
    });
    expect(getCompressCommand('/tmp/out.zip', ['--checkpoint-action=exec=id', '-weird.txt'], 'zip')).toEqual({
      cmd: 'zip',
      args: ['-r', '/tmp/out.zip', '--', '--checkpoint-action=exec=id', '-weird.txt'],
    });
    expect(getCompressCommand('/tmp/out.tar.gz', ['--checkpoint-action=exec=id', '-weird.txt'], 'tar.gz')).toEqual({
      cmd: 'tar',
      args: ['-czvf', '/tmp/out.tar.gz', '--', '--checkpoint-action=exec=id', '-weird.txt'],
    });
    expect(getCompressCommand('/tmp/out.zip', [], 'zip')).toBeNull();
    expect(getCompressCommand('/tmp/out.rar', ['a.txt'], 'rar' as 'zip')).toBeNull();
  });

  test('resolves common ancestor directory and relative paths for same-dir and cross-dir selections', () => {
    expect(resolveCommonParentAndRelPaths(['/a/b/x.txt', '/a/b/y.txt'])).toEqual({
      cwd: '/a/b',
      relItems: ['x.txt', 'y.txt'],
    });
    expect(resolveCommonParentAndRelPaths(['/a/b/x.txt', '/a/c/y.txt'])).toEqual({
      cwd: '/a',
      relItems: ['b/x.txt', 'c/y.txt'],
    });
    expect(resolveCommonParentAndRelPaths(['/a/b/x.txt', '/a/b/sub/y.txt'])).toEqual({
      cwd: '/a/b',
      relItems: ['x.txt', 'sub/y.txt'],
    });
    expect(resolveCommonParentAndRelPaths(['/a/x.txt', '/b/y.txt'])).toEqual({
      cwd: '/',
      relItems: ['a/x.txt', 'b/y.txt'],
    });
    expect(resolveCommonParentAndRelPaths([])).toBeNull();
  });

  test('parses compressed entry lines for zip and tar', () => {
    expect(parseCompressedEntryLine('zip', '  adding: alpha.txt (stored 0%)')).toBe('alpha.txt');
    expect(parseCompressedEntryLine('zip', '  adding: dir/notes (v1).txt (deflated 42%)')).toBe('dir/notes (v1).txt');
    expect(parseCompressedEntryLine('zip', '  updating: beta.txt (stored 0%)')).toBe('beta.txt');
    expect(parseCompressedEntryLine('zip', 'zip warning: something')).toBeNull();
    expect(parseCompressedEntryLine('tar', 'alpha.txt\n')).toBe('alpha.txt');
    expect(parseCompressedEntryLine('tar', '   ')).toBeNull();
  });
});

describe('parseOsReleaseAndCommand', () => {
  test('detects Arch, Ubuntu/Debian, Fedora, openSUSE, and unknown distros', () => {
    expect(parseOsReleaseAndCommand('ID=arch\nPRETTY_NAME="Arch Linux"', 'unrar')).toEqual({
      tool: 'unrar',
      package: 'unrar',
      distroName: 'Arch Linux',
      installCommand: 'sudo pacman -S unrar',
    });

    expect(
      parseOsReleaseAndCommand('PRETTY_NAME="Ubuntu 24.04 LTS"\nID=ubuntu\nID_LIKE=debian', 'unrar')
    ).toEqual({
      tool: 'unrar',
      package: 'unrar',
      distroName: 'Ubuntu 24.04 LTS',
      installCommand: 'sudo apt update && sudo apt install unrar',
    });

    expect(
      parseOsReleaseAndCommand('PRETTY_NAME="Fedora Linux 41 (Workstation Edition)"\nID=fedora', 'zip')
    ).toEqual({
      tool: 'zip',
      package: 'zip',
      distroName: 'Fedora Linux 41 (Workstation Edition)',
      installCommand: 'sudo dnf install zip',
    });

    expect(
      parseOsReleaseAndCommand('PRETTY_NAME="openSUSE Tumbleweed"\nID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"', 'unrar')
    ).toEqual({
      tool: 'unrar',
      package: 'unrar',
      distroName: 'openSUSE Tumbleweed',
      installCommand: 'sudo zypper install unrar',
    });

    const fallback = parseOsReleaseAndCommand('', 'unrar');
    expect(fallback.tool).toBe('unrar');
    expect(fallback.package).toBe('unrar');
    expect(fallback.distroName).toBe('Linux');
    expect(fallback.installCommand.length).toBeGreaterThan(0);

    const formatted = formatMissingToolError('ID=arch\nPRETTY_NAME="Arch Linux"', 'unrar');
    expect(formatted.startsWith('MISSING_TOOL:')).toBe(true);
    const parsed = JSON.parse(formatted.slice('MISSING_TOOL:'.length));
    expect(parsed).toEqual({
      tool: 'unrar',
      package: 'unrar',
      distroName: 'Arch Linux',
      installCommand: 'sudo pacman -S unrar',
    });
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
