
import fs from 'fs';
import path from 'path';
import { getAllFilesFromLocalDir } from '../utils/utils';
import { FolderPrefix } from '../utils/types';
import { getEnvironment } from '../utils/environment';

export const existisBackupedLocalFile = async (folderPrefix: FolderPrefix, file: string): Promise<boolean> => {
    const backupDestinationDir = getEnvironment().localBackupPath;

    if (!backupDestinationDir) {
        throw new Error('LOCAL_BACKUP_PATH is required when BACKUP_DESTINATION_TYPE=local');
    }

    return fs.existsSync(path.resolve(backupDestinationDir, folderPrefix, file));
}

 export const persistFileToLocal = async (
    folderPrefix: FolderPrefix,
    fileName: string,
    sourceFilePath: string,
    shouldCleanup: boolean,
) => {
    const backupDestinationDir = getEnvironment().localBackupPath;

    if (!backupDestinationDir) {
        throw new Error('LOCAL_BACKUP_PATH is required when BACKUP_DESTINATION_TYPE=local');
    }

    const folderPath = path.join(backupDestinationDir, folderPrefix);

    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }

    const normalizedFileName = fileName.replace(/^\/+/, '').split(/[\\/]/).join('/');
    const destFile = path.join(backupDestinationDir, folderPrefix, normalizedFileName);
    const destDir = path.dirname(destFile);

    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    fs.copyFileSync(sourceFilePath, destFile);

    if (shouldCleanup) {
        fs.rmSync(sourceFilePath, { recursive: true, force: true });
    }

    console.log(`\nFiles backup completed:`);
    console.log(`  - 1 file copied to local backup`);
    console.log(`  - Backup location: ${destFile}`);
    return;
};


