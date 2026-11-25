import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { DragDropEventPayload, IApi } from './types';
import { createTauriAdapter } from './tauriAdapter';

export * from './types';
export * from './commandMap';
export * from './tauriAdapter';

function isTauriRuntime(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function guardedInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!isTauriRuntime()) {
        throw new Error(
            `Tauri IPC unavailable while invoking '${cmd}' — run inside Tauri or mock api.<method> in tests`
        );
    }
    return invoke(cmd, args);
}

async function guardedListen(
    event: string,
    cb: (payload: unknown) => void
): Promise<() => void> {
    if (!isTauriRuntime()) {
        return () => {};
    }
    const unlisten = await listen(event, (e: { payload: unknown }) => cb(e.payload));
    return unlisten;
}

async function guardedListenDragDrop(
    cb: (payload: DragDropEventPayload) => void
): Promise<() => void> {
    if (!isTauriRuntime()) {
        return () => {};
    }
    const unlisten = await getCurrentWebview().onDragDropEvent((ev) => {
        cb(ev.payload as DragDropEventPayload);
    });
    return unlisten;
}

export const api: IApi = createTauriAdapter(
    guardedInvoke,
    guardedListen,
    guardedListenDragDrop
);
