import React from 'react';
import {
  Dialog as M3Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogIcon,
  DialogOverlay,
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
      <DialogOverlay className="bg-black/40 backdrop-blur-sm" />
      <DialogContent
        className={maxWidth ? `w-full ${maxWidth}` : undefined}
        aria-describedby={undefined}
      >
        <DialogHeader className="flex flex-row items-center gap-3 pr-10">
          {icon && (
            <DialogIcon className="!mb-0 shrink-0 justify-start text-m3-primary">
              {icon}
            </DialogIcon>
          )}
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody contentClassName="pt-2">{children}</DialogBody>
        {actions && <DialogFooter>{actions}</DialogFooter>}
      </DialogContent>
    </M3Dialog>
  );
};
