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

    async listTrash(): Promise<IFile[]> {
        if (api && api.listTrash) {
            try {
                return await api.listTrash();
            } catch (error) {
                console.error('Trash list error:', error);
                return [];
            }
        }
        return [];
    },

    async restoreTrash(ids: string[]): Promise<boolean> {
        return api.restoreTrashItems(ids);
    },

    async purgeTrash(ids: string[]): Promise<boolean> {
        return api.purgeTrashItems(ids);
    },

    async emptyTrash(): Promise<boolean> {
        return api.emptyTrash();
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
