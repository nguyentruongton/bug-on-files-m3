import type { IFile } from '../types/files';
import { api } from '../api';

export const FileSystemService = {
    async getPlaces(): Promise<Array<{ name: string; path: string; icon: string }>> {
        return api.getPlaces();
    },

    async copy(source: string, dest: string): Promise<boolean> {
        return api.copyFile(source, dest);
    },

    async move(source: string, dest: string): Promise<boolean> {
        return api.moveFile(source, dest);
    },

    async trash(path: string): Promise<boolean> {
        return api.trashFile(path);
    },

    async rename(oldPath: string, newPath: string): Promise<boolean> {
        return api.renameFile(oldPath, newPath);
    },

    async mkdir(path: string): Promise<boolean> {
        return api.createDirectory(path);
    },

    async open(path: string): Promise<string> {
        return api.openPath(path);
    },

    async listDir(path: string): Promise<IFile[]> {
        if (api && api.listDir) {
            try {
                return await api.listDir(path);
            } catch (error) {
                console.error('FS Error:', error);
                return [];
            }
        }
        return [];
    }
};
