import React, { useState } from 'react';
import { TextField } from '@bug-on/m3-expressive';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import { validateFileName } from '../utils/fileUtils';
import { resolveCompressFilename } from '../utils/archiveUtils';

export type CompressFormat = 'zip' | 'tar.gz';

export interface CompressDialogProps {
  open: boolean;
  defaultName: string;
  onClose: () => void;
  onConfirm: (filename: string, format: CompressFormat) => void;
}

const FORMAT_OPTIONS: Array<{ value: CompressFormat; label: string; hint: string }> = [
  { value: 'zip', label: '.zip', hint: 'Universal compatibility' },
  { value: 'tar.gz', label: '.tar.gz', hint: 'Compact Linux archive' },
];

export const CompressDialog: React.FC<CompressDialogProps> = ({
  open,
  defaultName,
  onClose,
  onConfirm,
}) => {
  const [name, setName] = useState(defaultName);
  const [format, setFormat] = useState<CompressFormat>('zip');
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevDefaultName, setPrevDefaultName] = useState(defaultName);

  if (open !== prevOpen || defaultName !== prevDefaultName) {
    setPrevOpen(open);
    setPrevDefaultName(defaultName);
    if (open) {
      setName(defaultName);
      setFormat('zip');
    }
  }

  const validation = validateFileName(name);
  const resolvedFilename = validation.valid ? resolveCompressFilename(name, format) : null;

  const handleSubmit = () => {
    if (!validation.valid) return;
    onConfirm(resolveCompressFilename(name, format), format);
  };

  return (
    <Dialog
      title="Compress Items"
      icon={<Icon name="folder_zip" size={24} />}
      open={open}
      onClose={onClose}
      maxWidth="max-w-md"
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!validation.valid}>
            Compress
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          variant="outlined"
          label="Archive name"
          placeholder="archive"
          value={name}
          onChange={(val) => setName(val)}
          fullWidth
          error={Boolean(name && validation.error)}
          errorText={name ? (validation.error ?? undefined) : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && validation.valid) {
              handleSubmit();
            }
          }}
        />

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-m3-on-surface-variant">Format</span>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Archive format">
            {FORMAT_OPTIONS.map((opt) => {
              const selected = format === opt.value;
              return (
                <Button
                  key={opt.value}
                  colorStyle={selected ? 'filled' : 'outlined'}
                  size="sm"
                  icon={<Icon name={selected ? 'check' : 'folder_zip'} size={18} />}
                  onClick={() => setFormat(opt.value)}
                  className="w-full justify-center"
                  role="radio"
                  aria-checked={selected}
                >
                  {opt.label}
                </Button>
              );
            })}
          </div>
          <span className="text-xs text-m3-on-surface-variant">
            {FORMAT_OPTIONS.find((opt) => opt.value === format)?.hint}
            {resolvedFilename ? ` • Output: ${resolvedFilename}` : ''}
          </span>
        </div>
      </div>
    </Dialog>
  );
};
