
import fs from 'fs';
import path from 'path';
import { backupAlreadyExists, persistBackupFiles } from '../destination/destination';
import { getAllFilesFromLocalDir } from '../utils/utils';
import { getEnvironment } from '../utils/environment';

export const backupFromLocalDirectory = async () => {
  const sourceDir = getEnvironment().filesBackupPath;

  if (!sourceDir) {
    throw new Error('FILES_BACKUP_PATH is required when FILES_BACKUP_SOURCE=local');
  }

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`FILES_BACKUP_PATH does not exist: ${sourceDir}`);
  }

  console.log(`Starting local files backup from: ${sourceDir}`);

  const sourceFiles = getAllFilesFromLocalDir(sourceDir);
  const filesToPersist: string[] = [];

  console.log(`Found ${sourceFiles.length} files to evaluate`);

  for (const sourceFile of sourceFiles) {
    const relativePath = path.relative(sourceDir, sourceFile).split(path.sep).join('/');

    if (await backupAlreadyExists('files-backup', relativePath)) {
      console.log(`Skipped (already exists in backup): ${relativePath}`);
      continue;
    }

    filesToPersist.push(sourceFile);
  }

  await persistBackupFiles(
    'files-backup',
    filesToPersist.map((sourcePath) => ({ fileName: path.basename(sourcePath), sourcePath })),
    false,
  );
};
