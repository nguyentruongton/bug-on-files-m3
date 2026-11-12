import type { IApi } from './types';

declare global {
    interface Window {
        electron: IApi;
    }
}

export const electronAdapter: IApi = new Proxy({} as IApi, {
    get(target, prop: string | symbol) {
        if (typeof window !== 'undefined' && window.electron) {
            const val = (window.electron as any)[prop];
            if (typeof val === 'function') {
                return val.bind(window.electron);
            }
            return val;
        }
        const targetVal = (target as any)[prop];
        if (typeof targetVal === 'function') {
            return targetVal.bind(target);
        }
        return targetVal;
    },
    set(target, prop: string | symbol, value: any) {
        if (typeof window !== 'undefined' && window.electron) {
            (window.electron as any)[prop] = value;
        }
        (target as any)[prop] = value;
        return true;
    },
    has(target, prop: string | symbol) {
        if (typeof window !== 'undefined' && window.electron) {
            return prop in window.electron;
        }
        return prop in target;
    },
});
