import React from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export const AboutDialog: React.FC<AboutDialogProps> = ({ open, onClose }) => {
  return (
    <Dialog
      title="About Materials"
      open={open}
      onClose={onClose}
      maxWidth="max-w-sm"
      icon={<Icon name="info" size={24} />}
      actions={
        <Button variant="tonal" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-2 text-sm text-m3-on-surface-variant">
        <p className="text-base font-medium text-m3-on-surface">Materials</p>
        <p>Version 0.1.0</p>
        <p>Material 3 Expressive File Explorer</p>
      </div>
    </Dialog>
  );
};
