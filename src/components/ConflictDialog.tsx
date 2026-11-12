import React, { useState } from 'react';
import { Checkbox } from '@bug-on/m3-expressive';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
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
            icon={<Icon name="warning" size={24} />}
            open={open}
            onClose={onCancel}
            maxWidth="max-w-md"
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
            <div className="flex flex-col gap-4">
                <p className="text-sm text-m3-on-surface-variant m-0">
                    Choose what to do with this item.
                </p>
                {showApplyAll && (
                    <Checkbox
                        checked={applyToAll}
                        onCheckedChange={setApplyToAll}
                        label="Apply to all remaining items"
                    />
                )}
            </div>
        </Dialog>
    );
};
