import { promises as fs } from 'fs';

export const TEXT_PREVIEW_MAX_BYTES = 1048576;
const BINARY_CHECK_BYTES = 8192;

export type TextPreview =
  | { kind: 'text'; content: string }
  | { kind: 'too-large'; size: number }
  | { kind: 'binary' }
  | { kind: 'error' };

/**
 * Reads a size-capped text preview of the given file path.
 * Returns `{ kind: 'too-large' }` if the file exceeds `maxBytes`,
 * `{ kind: 'binary' }` if any null byte is present in the first 8192 bytes,
 * `{ kind: 'error' }` if the path is missing, unreadable, or not a regular file,
 * and `{ kind: 'text', content }` otherwise.
 */
export async function readTextPreview(
  filePath: string,
  maxBytes: number = TEXT_PREVIEW_MAX_BYTES
): Promise<TextPreview> {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return { kind: 'error' };
    }

    if (stats.size > maxBytes) {
      return { kind: 'too-large', size: stats.size };
    }

    if (stats.size === 0) {
      return { kind: 'text', content: '' };
    }

    const buffer = await fs.readFile(filePath);
    if (buffer.length > maxBytes) {
      return { kind: 'too-large', size: buffer.length };
    }

    const checkLength = Math.min(buffer.length, BINARY_CHECK_BYTES);
    if (buffer.subarray(0, checkLength).includes(0)) {
      return { kind: 'binary' };
    }

    return { kind: 'text', content: buffer.toString('utf-8') };
  } catch {
    return { kind: 'error' };
  }
}
