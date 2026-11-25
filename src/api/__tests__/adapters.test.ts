import { describe, expect, test } from 'bun:test';
import { api } from '../index';

describe('api (Tauri-only client)', () => {
    test('api is defined at module evaluation time without throwing in node/bun', () => {
        expect(api).toBeDefined();
        expect(typeof api.listDir).toBe('function');
        expect(typeof api.onDragDrop).toBe('function');
    });

    test('calling an unmocked IPC method outside Tauri rejects with diagnostic error', async () => {
        await expect(api.getHomePath()).rejects.toThrow(/Tauri IPC unavailable.*get_home/);
    });

    test('api supports mutable mock assignment via Object.assign and clean restoration', async () => {
        const originalGetHomePath = api.getHomePath;
        try {
            Object.assign(api, {
                getHomePath: async () => '/mock/home',
            });
            expect(await api.getHomePath()).toBe('/mock/home');
        } finally {
            Object.assign(api, { getHomePath: originalGetHomePath });
        }

        await expect(api.getHomePath()).rejects.toThrow(/Tauri IPC unavailable/);
    });
});
