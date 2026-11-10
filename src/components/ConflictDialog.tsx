import React, { useState } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import type { ConflictAction } from '../utils/pasteRunner';

export interface ConflictDialogProps {
  open: boolean;
  fileName: string;
  isDirectory: boolean;
  showApplyAll: boolean;
  onChoose: (action: Exclude<ConflictAction, 'cancel'>, applyToAll: boolean) => void;
  onCancel: () => void;
}

export const ConflictDialog: React.FC<ConflictDialogProps> = ({
  open,
  fileName,
  showApplyAll,
  onChoose,
  onCancel,
}) => {
  const [applyToAll, setApplyToAll] = useState(false);
  const [prevPrompt, setPrevPrompt] = useState({ open, fileName });

  if (open !== prevPrompt.open || fileName !== prevPrompt.fileName) {
    setPrevPrompt({ open, fileName });
    if (open) {
      setApplyToAll(false);
    }
  }

  const handleChoose = (action: Exclude<ConflictAction, 'cancel'>) => {
    onChoose(action, applyToAll);
  };

  return (
    <Dialog
      title={`"${fileName}" already exists`}
      open={open}
      onClose={onCancel}
      actions={
        <>
          <Button variant="text" onClick={() => handleChoose('skip')}>
            Skip
          </Button>
          <Button variant="tonal" onClick={() => handleChoose('keep-both')}>
            Keep both
          </Button>
          <Button variant="filled" onClick={() => handleChoose('replace')}>
            Replace
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p style={{ margin: 0, color: 'var(--md-sys-color-on-surface-variant)' }}>
          Choose what to do with this item.
        </p>
        {showApplyAll && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              userSelect: 'none',
              fontSize: '14px',
              color: 'var(--md-sys-color-on-surface)',
            }}
          >
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
              style={{
                accentColor: 'var(--md-sys-color-primary)',
                width: '18px',
                height: '18px',
                cursor: 'pointer',
              }}
            />
            <span>Apply to all remaining items</span>
          </label>
        )}
      </div>
    </Dialog>
  );
};
