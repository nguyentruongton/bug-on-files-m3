import React from 'react';
import {
  Dialog as M3Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogIcon,
  DialogTitle,
} from '@bug-on/m3-expressive';

export interface DialogProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  maxWidth?: string;
}

export const Dialog: React.FC<DialogProps> = ({
  title,
  open,
  onClose,
  children,
  actions,
  icon,
  maxWidth,
}) => {
  return (
    <M3Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
    >
      <DialogContent
        className={maxWidth ? `w-full ${maxWidth}` : undefined}
        aria-describedby={undefined}
      >
        <DialogHeader>
          {icon && <DialogIcon>{icon}</DialogIcon>}
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
        {actions && <DialogFooter>{actions}</DialogFooter>}
      </DialogContent>
    </M3Dialog>
  );
};
