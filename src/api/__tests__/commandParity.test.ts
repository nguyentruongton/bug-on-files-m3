import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMMAND_MAP } from '../commandMap';

function parseGenerateHandlerCommands(libRsContent: string): string[] {
    const match = libRsContent.match(/tauri::generate_handler!\s*\[([\s\S]*?)\]/);
    if (!match) {
        throw new Error('Could not find tauri::generate_handler![ ... ] in src-tauri/src/lib.rs');
    }

    const handlerBlock = match[1];
    const lines = handlerBlock.split('\n');
    const rawTokens: string[] = [];

    for (const rawLine of lines) {
        // Strip line comments
        const lineWithoutComment = rawLine.replace(/\/\/.*$/, '').trim();
        if (!lineWithoutComment) continue;

        // Split by comma
        const tokens = lineWithoutComment.split(',');
        for (const token of tokens) {
            const trimmed = token.trim();
            if (trimmed) {
                // Strip module paths (e.g., commands::fs::list_dir -> list_dir)
                const parts = trimmed.split('::');
                const commandName = parts[parts.length - 1].trim();
                rawTokens.push(commandName);
            }
        }
    }

    return rawTokens;
}

describe('Tauri Command Parity', () => {
    const libRsPath = resolve(import.meta.dir, '../../../src-tauri/src/lib.rs');
    const libRsContent = readFileSync(libRsPath, 'utf-8');
    const registeredCommands = parseGenerateHandlerCommands(libRsContent);
    const registeredSet = new Set(registeredCommands);
    const commandMapValues = Object.values(COMMAND_MAP);
    const commandMapSet = new Set(commandMapValues);

    test('generate_handler contains no duplicate commands', () => {
        expect(registeredCommands.length).toBe(registeredSet.size);
    });

    test('generate_handler registers exactly 33 commands matching COMMAND_MAP', () => {
        expect(registeredCommands.length).toBe(33);
        expect(registeredSet.size).toBe(commandMapSet.size);
    });

    test('every COMMAND_MAP command is registered in generate_handler', () => {
        const missingInRust = commandMapValues.filter((cmd) => !registeredSet.has(cmd));
        expect(missingInRust).toEqual([]);
    });

    test('every generate_handler command is defined in COMMAND_MAP', () => {
        const missingInMap = registeredCommands.filter((cmd) => !commandMapSet.has(cmd));
        expect(missingInMap).toEqual([]);
    });

    test('exact set equality between generate_handler and COMMAND_MAP', () => {
        expect(registeredSet).toEqual(commandMapSet);
    });
});
