export interface HistoryState {
  entries: string[];
  index: number;
}

export function createHistory(initialPath: string): HistoryState {
  if (!initialPath) {
    return { entries: [], index: -1 };
  }
  return { entries: [initialPath], index: 0 };
}

export function pushHistory(state: HistoryState, nextPath: string): HistoryState {
  if (!nextPath) return state;
  if (state.index >= 0 && state.entries[state.index] === nextPath) {
    return state;
  }
  const entries = [...state.entries.slice(0, state.index + 1), nextPath];
  return {
    entries,
    index: entries.length - 1,
  };
}

export function stepBack(state: HistoryState): { state: HistoryState; path: string | null } {
  if (state.index <= 0) {
    return { state, path: null };
  }
  const index = state.index - 1;
  return {
    state: { entries: state.entries, index },
    path: state.entries[index],
  };
}

export function stepForward(state: HistoryState): { state: HistoryState; path: string | null } {
  if (state.index < 0 || state.index >= state.entries.length - 1) {
    return { state, path: null };
  }
  const index = state.index + 1;
  return {
    state: { entries: state.entries, index },
    path: state.entries[index],
  };
}

export function resolveTerminalTargetDir(targetPath: string, isDirectory: boolean): string | null {
  if (!targetPath || targetPath.startsWith('app://')) {
    return null;
  }
  if (isDirectory) {
    return targetPath;
  }
  const trimmed = targetPath.length > 1 ? targetPath.replace(/\/+$/, '') : targetPath;
  const lastSlash = trimmed.lastIndexOf('/');
  if (lastSlash < 0) return null;
  if (lastSlash === 0) return '/';
  return trimmed.slice(0, lastSlash);
}
