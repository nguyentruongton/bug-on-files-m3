import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useClipboard } from '../contexts/ClipboardContext';
import { useToast } from '../contexts/ToastContext';
import { FileSystemService } from '../services/FileSystemService';
import { runPaste, type ConflictAction, type PasteDeps } from '../utils/pasteRunner';
import { ConflictDialog } from '../components/ConflictDialog';
import { api } from '../api';

interface ConflictPromptState {
  fileName: string;
  isDirectory: boolean;
  showApplyAll: boolean;
}

export function usePaste(onFinished: () => void): {
  paste: (destDir: string) => Promise<void>;
  conflictDialog: React.ReactNode;
} {
  const { clipboard, clear: clearClipboard } = useClipboard();
  const { showToast } = useToast();
  const isPastingRef = useRef(false);
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

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

  const paste = useCallback(
    async (destDir: string) => {
      if (isPastingRef.current) return;
      if (!clipboard || clipboard.files.length === 0 || !destDir || destDir.startsWith('app://')) {
        return;
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

        const result = await runPaste(
          clipboard.files,
          clipboard.operation,
          destDir,
          deps
        );

        if (clipboard.operation === 'cut' && !result.cancelled && result.failed.length === 0) {
          clearClipboard();
        }

        if (result.done > 0) {
          showToast(`Pasted ${result.done} item(s)`, 'success');
        }
        if (result.skipped > 0) {
          showToast(`Skipped ${result.skipped}`, 'info');
        }
        if (result.failed.length > 0) {
          showToast(`Failed to paste: ${result.failed.join(', ')}`, 'error');
        }
        if (result.done > 0) {
          onFinishedRef.current();
        }
      } catch (err) {
        console.error('Paste error', err);
        showToast('Failed to paste items', 'error');
      } finally {
        isPastingRef.current = false;
        resolverRef.current = null;
        setConflictPrompt(null);
      }
    },
    [clipboard, clearClipboard, showToast]
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

  return { paste, conflictDialog };
}
