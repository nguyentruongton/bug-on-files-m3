import React, { useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import type { MissingToolInfo } from '../utils/archiveUtils';

export interface MissingToolDialogProps {
  info: MissingToolInfo | null;
  onClose: () => void;
}

export const MissingToolDialog: React.FC<MissingToolDialogProps> = ({ info, onClose }) => {
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, [info]);

  const copied = Boolean(info && copiedCommand === info.installCommand);

  const handleCopyCommand = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.installCommand);
      setCopiedCommand(info.installCommand);
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => {
        setCopiedCommand(null);
        resetTimerRef.current = null;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy install command', err);
    }
  };

  return (
    <Dialog
      title={info ? `Install "${info.tool}" to continue` : 'Missing Required Tool'}
      icon={<Icon name="terminal" size={24} />}
      open={Boolean(info)}
      onClose={onClose}
      maxWidth="max-w-lg"
      actions={
        <Button variant="tonal" onClick={onClose}>
          Close
        </Button>
      }
    >
      {info && (
        <div className="flex flex-col gap-4 text-sm text-m3-on-surface-variant">
          <p className="leading-relaxed">
            This archive action needs a small free helper program called{' '}
            <strong className="font-semibold text-m3-on-surface">{info.tool}</strong>{' '}
            (package{' '}
            <code className="px-1.5 py-0.5 rounded bg-m3-surface-container-highest text-m3-on-surface font-mono text-xs">
              {info.package}
            </code>
            ), which isn&apos;t installed yet on{' '}
            <strong className="font-semibold text-m3-on-surface">{info.distroName}</strong>.
          </p>

          <div className="flex flex-col gap-2 rounded-m3-md bg-m3-surface-container-highest border border-m3-outline-variant p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-m3-on-surface-variant">
                Install command for {info.distroName}
              </span>
              <Button
                variant={copied ? 'filled' : 'tonal'}
                size="sm"
                icon={<Icon name={copied ? 'check' : 'content_copy'} size={16} />}
                onClick={() => void handleCopyCommand()}
              >
                {copied ? 'Copied!' : 'Copy Command'}
              </Button>
            </div>
            <pre className="m-0 overflow-x-auto rounded-m3-sm bg-m3-surface-container-lowest px-3 py-2 font-mono text-xs text-m3-on-surface select-all">
              <code>{info.installCommand}</code>
            </pre>
          </div>

          <div className="flex flex-col gap-2 rounded-m3-md bg-m3-surface-container-low p-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-m3-primary">
              How to install (3 quick steps)
            </span>
            <ol className="list-decimal list-inside flex flex-col gap-1.5 text-sm text-m3-on-surface-variant">
              <li>
                <strong className="font-medium text-m3-on-surface">Open Terminal</strong> — click
                the Terminal button in the sidebar or open your system Terminal app.
              </li>
              <li>
                <strong className="font-medium text-m3-on-surface">Paste &amp; press Enter</strong>{' '}
                — press <kbd className="px-1 py-0.5 rounded bg-m3-surface-container-highest text-m3-on-surface font-mono text-xs">Ctrl+Shift+V</kbd> (or right-click &rarr; Paste), press Enter, and enter your password if asked.
              </li>
              <li>
                <strong className="font-medium text-m3-on-surface">Come back and try again</strong>{' '}
                once installation completes.
              </li>
            </ol>
          </div>
        </div>
      )}
    </Dialog>
  );
};
