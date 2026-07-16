import { fileExistsInS3, uploadFileToS3 } from "../utils/s3";
import path from "path";
import fs from "fs";
import { FolderPrefix } from "../utils/types";

export const existisBackupedCloudFile = async (folderPrefix: FolderPrefix, fileName: string): Promise<boolean> => {
    return await fileExistsInS3(folderPrefix, fileName);
}

export const persistFileToCloud = async (
  folderPrefix: FolderPrefix,
  fileName: string,
  sourceFilePath: string,
  shouldCleanup: boolean,
) => {
  const normalizedFileName = fileName.replace(/^\/+/, '').split(/[\\/]/).join('/');

  if (shouldCleanup) {
    fs.rmSync(sourceFilePath, { recursive: true, force: true });
  }

  await uploadFileToS3(sourceFilePath, folderPrefix, normalizedFileName);
};


