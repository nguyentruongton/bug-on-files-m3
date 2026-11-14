export interface IFile {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    mtime: Date;
    mediaKind?: 'video';
    trashId?: string;
    originalParent?: string;
}

export interface IFileSystemAPI {
    listDir: (path: string) => Promise<IFile[]>;
}
