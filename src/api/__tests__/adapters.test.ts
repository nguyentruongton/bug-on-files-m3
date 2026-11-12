import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { api, electronAdapter, createTauriAdapter, COMMAND_MAP } from '../index';

describe('api and electronAdapter', () => {
    test('api is defined at module evaluation time without throwing in node/bun', () => {
        expect(api).toBeDefined();
    });

    test('electronAdapter falls back cleanly when window is undefined', () => {
        expect(electronAdapter.getPlaces).toBeUndefined();
    });

    test('electronAdapter delegates dynamically when window has electron property', async () => {
        const originalWindow = (globalThis as any).window;
        try {
            (globalThis as any).window = {
                electron: {
                    getHomePath: async () => '/mock/home',
                },
            };

            expect(typeof electronAdapter.getHomePath).toBe('function');
            const home = await electronAdapter.getHomePath();
            expect(home).toBe('/mock/home');
        } finally {
            (globalThis as any).window = originalWindow;
        }
    });

    test('electronAdapter supports mock property assignment when electron property is absent', async () => {
        (electronAdapter as any).customMock = () => 42;
        expect((electronAdapter as any).customMock()).toBe(42);
        delete (electronAdapter as any).customMock;
    });
});
