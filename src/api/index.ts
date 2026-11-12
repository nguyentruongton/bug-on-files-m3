import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { IApi } from './types';
import { electronAdapter } from './electronAdapter';
import { createTauriAdapter } from './tauriAdapter';

export * from './types';
export * from './commandMap';
export * from './electronAdapter';
export * from './tauriAdapter';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const api: IApi = isTauri
    ? createTauriAdapter(
          (cmd, args) => invoke(cmd, args),
          async (event, cb) => {
              const unlisten = await listen(event, (e: { payload: unknown }) => cb(e.payload));
              return unlisten;
          }
      )
    : electronAdapter;
