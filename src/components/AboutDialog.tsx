import React from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import logoSvg from '../assets/bug-on-files-m3.svg';
import { version as appVersion } from '../../package.json';

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export const AboutDialog: React.FC<AboutDialogProps> = ({ open, onClose }) => {
  return (
    <Dialog
      title="About Bug On Files M3"
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
      <div className="flex items-center gap-4 text-sm text-m3-on-surface-variant">
        <img src={logoSvg} alt="Bug On Files M3 logo" className="w-16 h-16 shrink-0" />
        <div className="flex flex-col gap-1">
          <p className="text-base font-medium text-m3-on-surface">Bug On Files M3</p>
          <p>Version {appVersion}</p>
          <p>Material 3 Expressive File Explorer</p>
        </div>
      </div>
    </Dialog>
  );
};

