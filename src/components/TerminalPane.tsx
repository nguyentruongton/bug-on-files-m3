import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { api } from '../api';

interface TerminalPaneProps {
    cwd?: string;
    onClose?: () => void;
}

function readTerminalTheme() {
    const styles = getComputedStyle(document.documentElement);
    const background =
        styles.getPropertyValue('--md-sys-color-surface-container-lowest').trim() || '#141218';
    const foreground =
        styles.getPropertyValue('--md-sys-color-on-surface').trim() || '#E6E0E9';
    const cursor =
        styles.getPropertyValue('--md-sys-color-primary').trim() || '#D0BCFF';
    return { background, foreground, cursor };
}

export const TerminalPane: React.FC<TerminalPaneProps> = ({ cwd }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const pidRef = useRef<number | null>(null);
    const latestCwdRef = useRef<string | undefined>(cwd);

    useEffect(() => {
        if (!containerRef.current) return;

        let disposed = false;
        let cleanupData: (() => void) | undefined;
        let cleanupExit: (() => void) | undefined;

        const theme = readTerminalTheme();
        const term = new Terminal({
            cursorBlink: true,
            fontFamily: 'Consolas, monospace',
            fontSize: 14,
            theme,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(containerRef.current);
        fitAddon.fit();

        terminalRef.current = term;
        fitAddonRef.current = fitAddon;

        const handleResize = () => {
            fitAddon.fit();
            if (pidRef.current) {
                api.ptyResize(pidRef.current, term.cols, term.rows);
            }
        };

        window.addEventListener('resize', handleResize);
        const resizeObserver =
            typeof ResizeObserver !== 'undefined'
                ? new ResizeObserver(() => handleResize())
                : null;
        resizeObserver?.observe(containerRef.current);

        const dataDisposable = term.onData((data: string) => {
            if (pidRef.current) {
                api.ptyWrite(pidRef.current, data);
            }
        });

        const resizeDisposable = term.onResize((size: { cols: number; rows: number }) => {
            if (pidRef.current) {
                api.ptyResize(pidRef.current, size.cols, size.rows);
            }
        });

        const spawnTarget = latestCwdRef.current;
        const initialCwd = spawnTarget && !spawnTarget.startsWith('app://') ? spawnTarget : '';

        api.ptySpawn(initialCwd).then((pid) => {
            if (!pid) return;
            if (disposed) {
                api.ptyKill(pid);
                return;
            }

            pidRef.current = pid;

            cleanupData = api.ptyOnData(pid, (data: string) => {
                term.write(data);
            });

            cleanupExit = api.ptyOnExit(pid, () => {
                term.write('\r\nProcess exited.\r\n');
                cleanupData?.();
                pidRef.current = null;
            });

            api.ptyResize(pid, term.cols, term.rows);

            const targetCwd = latestCwdRef.current;
            if (targetCwd && !targetCwd.startsWith('app://') && targetCwd !== initialCwd) {
                const safePath = targetCwd.replace(/'/g, "'\\''");
                api.ptyWrite(pid, `cd '${safePath}'\r`);
            }
        });

        return () => {
            disposed = true;
            window.removeEventListener('resize', handleResize);
            resizeObserver?.disconnect();
            dataDisposable.dispose();
            resizeDisposable.dispose();
            cleanupData?.();
            cleanupExit?.();
            term.dispose();
            if (pidRef.current) {
                api.ptyKill(pidRef.current);
                pidRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        latestCwdRef.current = cwd;
        if (cwd && !cwd.startsWith('app://') && pidRef.current) {
            const safePath = cwd.replace(/'/g, "'\\''");
            const cmd = `cd '${safePath}'\r`;
            api.ptyWrite(pidRef.current, cmd);
        }
    }, [cwd]);

    return (
        <div
            ref={containerRef}
            className="w-full h-full bg-m3-surface-container-lowest overflow-hidden px-2 py-1"
        />
    );
};
