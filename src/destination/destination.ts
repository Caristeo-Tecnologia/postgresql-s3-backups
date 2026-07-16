import { DestinationSourceType, FolderPrefix } from "../utils/types";
import { existisBackupedLocalFile, persistFileToLocal } from "./local.destination";
import { existisBackupedCloudFile, persistFileToCloud } from "./cloud.destination";
import { getEnvironment } from '../utils/environment';

export const backupAlreadyExists = async (folderPrefix: FolderPrefix, fileName: string): Promise<boolean> => {
    const destinationType: DestinationSourceType = getEnvironment().destinationType

    if (destinationType === 'aws') {
        return await existisBackupedCloudFile(folderPrefix, fileName);
    }

    if (destinationType === 'r2') {
        return await existisBackupedCloudFile(folderPrefix, fileName);
    }

    if (destinationType === 'local') {
        return await existisBackupedLocalFile(folderPrefix, fileName);
    }

    return true;
}

export const persistBackupFile = async (
  folderPrefix: FolderPrefix,
  fileName: string,
  sourceFilePath: string,
  shouldCleanup: boolean,
) => {
    const destinationType: DestinationSourceType = getEnvironment().destinationType

    if (destinationType === 'local') {
        await persistFileToLocal(folderPrefix, fileName, sourceFilePath, shouldCleanup);
    }

    if (destinationType === 'aws') {
        await persistFileToCloud(folderPrefix, fileName, sourceFilePath, shouldCleanup);
    }

    if (destinationType === 'r2') {
        await persistFileToCloud(folderPrefix, fileName, sourceFilePath, shouldCleanup);
    }
};

export const persistBackupFiles = async (
  folderPrefix: FolderPrefix,
  sourceFiles: {
    fileName: string;
    sourcePath: string;
  }[],
  shouldCleanup: boolean,
) => {
    const destinationType: DestinationSourceType = getEnvironment().destinationType

    for (const sourceFile of sourceFiles) {
        if (destinationType === 'local') {
            await persistFileToLocal(folderPrefix, sourceFile.fileName, sourceFile.sourcePath, shouldCleanup);
        }

        if (destinationType === 'aws') {
            await persistFileToCloud(folderPrefix, sourceFile.fileName, sourceFile.sourcePath, shouldCleanup);
        }

        if (destinationType === 'r2') {
            await persistFileToCloud(folderPrefix, sourceFile.fileName, sourceFile.sourcePath, shouldCleanup);
        }
    }
};


