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
        return api.listTrash();
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
        return api.listDir(path);
    }
};
