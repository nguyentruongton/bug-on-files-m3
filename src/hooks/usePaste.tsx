import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useClipboard } from '../contexts/ClipboardContext';
import { useToast } from '../contexts/ToastContext';
import { FileSystemService } from '../services/FileSystemService';
import {
  normalizePath,
  runPaste,
  type ConflictAction,
  type PasteDeps,
  type PasteResult,
} from '../utils/pasteRunner';
import { ConflictDialog } from '../components/ConflictDialog';
import { api } from '../api';
import type { IFile } from '../types/files';

interface ConflictPromptState {
  fileName: string;
  isDirectory: boolean;
  showApplyAll: boolean;
}

export interface TransferCompletionInfo {
  operation: 'copy' | 'cut';
  destDir: string;
  completedSourcePaths: string[];
  affectedDirs: string[];
}

function emptyPasteResult(): PasteResult {
  return {
    done: 0,
    skipped: 0,
    failed: [],
    cancelled: false,
    completedSourcePaths: [],
  };
}

function getParentDirPath(filePath: string): string {
  const norm = normalizePath(filePath);
  const lastSlash = norm.lastIndexOf('/');
  return lastSlash > 0 ? norm.slice(0, lastSlash) : '/';
}

function computeAffectedDirs(completedSourcePaths: string[], destDir: string): string[] {
  const dirs = new Set<string>();
  for (const srcPath of completedSourcePaths) {
    dirs.add(getParentDirPath(srcPath));
  }
  dirs.add(normalizePath(destDir));
  return Array.from(dirs);
}

export function usePaste(
  onFinished: () => void,
  onTransferComplete?: (info: TransferCompletionInfo) => void
): {
  paste: (destDir: string) => Promise<void>;
  transferFiles: (
    files: IFile[],
    operation: 'copy' | 'cut',
    destDir: string
  ) => Promise<PasteResult>;
  conflictDialog: React.ReactNode;
} {
  const { clipboard, clear: clearClipboard } = useClipboard();
  const { showToast } = useToast();
  const isPastingRef = useRef(false);
  const onFinishedRef = useRef(onFinished);
  const onTransferCompleteRef = useRef(onTransferComplete);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    onTransferCompleteRef.current = onTransferComplete;
  }, [onTransferComplete]);

  const resolverRef = useRef<((value: { action: ConflictAction; applyToAll: boolean }) => void) | null>(null);
  const [conflictPrompt, setConflictPrompt] = useState<ConflictPromptState | null>(null);

  useEffect(() => {
    return () => {
      if (resolverRef.current) {
        resolverRef.current({ action: 'cancel', applyToAll: false });
        resolverRef.current = null;
      }
    };
  }, []);

  const handleChoose = useCallback((action: Exclude<ConflictAction, 'cancel'>, applyToAll: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setConflictPrompt(null);
    if (resolve) {
      resolve({ action, applyToAll });
    }
  }, []);

  const handleCancel = useCallback(() => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setConflictPrompt(null);
    if (resolve) {
      resolve({ action: 'cancel', applyToAll: false });
    }
  }, []);

  const executeTransfer = useCallback(
    async (
      files: IFile[],
      operation: 'copy' | 'cut',
      destDir: string,
      source: 'clipboard' | 'direct'
    ): Promise<PasteResult> => {
      if (isPastingRef.current) return emptyPasteResult();
      if (
        files.length === 0 ||
        !destDir ||
        destDir.startsWith('app://') ||
        destDir.startsWith('search://')
      ) {
        return emptyPasteResult();
      }

      isPastingRef.current = true;
      try {
        const deps: PasteDeps = {
          exists: (path: string) => api.exists(path),
          copy: (src: string, dest: string) => FileSystemService.copy(src, dest),
          move: (src: string, dest: string) => FileSystemService.move(src, dest),
          trash: (path: string) => FileSystemService.trash(path),
          resolveConflict: (file, _destPath, remaining) => {
            return new Promise<{ action: ConflictAction; applyToAll: boolean }>((resolve) => {
              resolverRef.current = resolve;
              setConflictPrompt({
                fileName: file.name,
                isDirectory: file.isDirectory,
                showApplyAll: remaining > 1,
              });
            });
          },
        };

        const result = await runPaste(files, operation, destDir, deps);

        if (source === 'clipboard') {
          if (operation === 'cut' && !result.cancelled && result.failed.length === 0) {
            clearClipboard();
          }
          if (result.done > 0) {
            showToast(`Pasted ${result.done} item(s)`, 'success');
          }
          if (result.failed.length > 0) {
            showToast(`Failed to paste: ${result.failed.join(', ')}`, 'error');
          }
        } else {
          if (result.done > 0) {
            showToast(
              `${operation === 'cut' ? 'Moved' : 'Copied'} ${result.done} item(s)`,
              'success'
            );
          }
          if (result.failed.length > 0) {
            showToast(
              `Failed to ${operation === 'cut' ? 'move' : 'copy'}: ${result.failed.join(', ')}`,
              'error'
            );
          }
        }

        if (result.skipped > 0) {
          showToast(`Skipped ${result.skipped}`, 'info');
        }

        if (result.done > 0) {
          const affectedDirs = computeAffectedDirs(result.completedSourcePaths, destDir);
          onTransferCompleteRef.current?.({
            operation,
            destDir,
            completedSourcePaths: result.completedSourcePaths,
            affectedDirs,
          });
          onFinishedRef.current();
        }

        return result;
      } catch (err) {
        console.error(source === 'clipboard' ? 'Paste error' : 'Transfer error', err);
        showToast(
          source === 'clipboard'
            ? 'Failed to paste items'
            : `Failed to ${operation === 'cut' ? 'move' : 'copy'} items`,
          'error'
        );
        return emptyPasteResult();
      } finally {
        isPastingRef.current = false;
        resolverRef.current = null;
        setConflictPrompt(null);
      }
    },
    [clearClipboard, showToast]
  );

  const paste = useCallback(
    async (destDir: string) => {
      if (!clipboard || clipboard.files.length === 0) {
        return;
      }
      await executeTransfer(clipboard.files, clipboard.operation, destDir, 'clipboard');
    },
    [clipboard, executeTransfer]
  );

  const transferFiles = useCallback(
    (files: IFile[], operation: 'copy' | 'cut', destDir: string) =>
      executeTransfer(files, operation, destDir, 'direct'),
    [executeTransfer]
  );

  const conflictDialog = (
    <ConflictDialog
      open={conflictPrompt !== null}
      fileName={conflictPrompt?.fileName ?? ''}
      isDirectory={conflictPrompt?.isDirectory ?? false}
      showApplyAll={conflictPrompt?.showApplyAll ?? false}
      onChoose={handleChoose}
      onCancel={handleCancel}
    />
  );

  return { paste, transferFiles, conflictDialog };
}
