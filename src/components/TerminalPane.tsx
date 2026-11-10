import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface TerminalPaneProps {
    cwd?: string;
    onClose?: () => void;
}

export const TerminalPane: React.FC<TerminalPaneProps> = ({ cwd }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const pidRef = useRef<number | null>(null);
    const latestCwdRef = useRef<string | undefined>(cwd);
    latestCwdRef.current = cwd;

    useEffect(() => {
        if (!containerRef.current) return;

        let disposed = false;
        let cleanupData: (() => void) | undefined;
        let cleanupExit: (() => void) | undefined;

        const term = new Terminal({
            cursorBlink: true,
            fontFamily: 'Consolas, monospace',
            fontSize: 14,
            theme: {
                background: '#1e1e1e',
                foreground: '#ffffff'
            }
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
                window.electron.ptyResize(pidRef.current, term.cols, term.rows);
            }
        };

        window.addEventListener('resize', handleResize);

        const dataDisposable = term.onData((data: string) => {
            if (pidRef.current) {
                window.electron.ptyWrite(pidRef.current, data);
            }
        });

        const resizeDisposable = term.onResize((size: { cols: number; rows: number }) => {
            if (pidRef.current) {
                window.electron.ptyResize(pidRef.current, size.cols, size.rows);
            }
        });

        const initialCwd = cwd && !cwd.startsWith('app://') ? cwd : '';

        window.electron.ptySpawn(initialCwd).then((pid) => {
            if (!pid) return;
            if (disposed) {
                window.electron.ptyKill(pid);
                return;
            }

            pidRef.current = pid;

            cleanupData = window.electron.ptyOnData(pid, (data: string) => {
                term.write(data);
            });

            cleanupExit = window.electron.ptyOnExit(pid, () => {
                term.write('\r\nProcess exited.\r\n');
                cleanupData?.();
                pidRef.current = null;
            });

            window.electron.ptyResize(pid, term.cols, term.rows);

            const targetCwd = latestCwdRef.current;
            if (targetCwd && !targetCwd.startsWith('app://') && targetCwd !== initialCwd) {
                const safePath = targetCwd.replace(/'/g, "'\\''");
                window.electron.ptyWrite(pid, `cd '${safePath}'\r`);
            }
        });

        return () => {
            disposed = true;
            window.removeEventListener('resize', handleResize);
            dataDisposable.dispose();
            resizeDisposable.dispose();
            cleanupData?.();
            cleanupExit?.();
            term.dispose();
            if (pidRef.current) {
                window.electron.ptyKill(pidRef.current);
                pidRef.current = null;
            }
        };
    }, []); // Only mount once

    useEffect(() => {
        if (cwd && !cwd.startsWith('app://') && pidRef.current) {
            // Escape path for shell safety - wrap in single quotes, replacing single quotes with '\''
            const safePath = cwd.replace(/'/g, "'\\''");
            const cmd = `cd '${safePath}'\r`;
            window.electron.ptyWrite(pidRef.current, cmd);
        }
    }, [cwd]);

    return (
        <div style={{ width: '100%', height: '100%', background: '#1e1e1e', overflow: 'hidden' }} ref={containerRef} />
    );
};
