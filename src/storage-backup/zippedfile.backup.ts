
import AdmZip from 'adm-zip';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { backupAlreadyExists, persistBackupFiles } from '../destination/destination';
import { getAllFilesFromLocalDir } from '../utils/utils';
import { getEnvironment } from '../utils/environment';
import { throttledLog, flushThrottledLogs } from '../utils/logger';

export const backupFromZipUrl = async () => {
  const fileUrl = getEnvironment().filesBackupUrl;

  if (!fileUrl) {
    throw new Error('FILES_BACKUP_URL is required when FILES_BACKUP_SOURCE=zippedFile');
  }

  const tempDir = path.join(process.cwd(), 'backups', 'files');
  fs.mkdirSync(tempDir, { recursive: true });

  const timestamp = Date.now();
  const zipFilename = `files-backup-${timestamp}.zip`;
  const zipFilePath = path.join(tempDir, zipFilename);
  const extractDir = path.join(tempDir, `zip-${timestamp}`);

  console.log('Downloading files backup ZIP...');
  const response = await axios.get(fileUrl, {
    responseType: 'stream',
    timeout: 3000000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  const writer = fs.createWriteStream(zipFilePath);

  const totalSize = parseInt(response.headers['content-length'] || '0', 10);
  let downloadedSize = 0;
  const startDownloadTime = Date.now();
  let lastLogTime = startDownloadTime;

  response.data.on('data', (chunk: Buffer) => {
    downloadedSize += chunk.length;
    const now = Date.now();

    if (now - lastLogTime >= 500 || downloadedSize === totalSize) {
      const elapsed = (now - startDownloadTime) / 1000;
      const percentage = totalSize > 0 ? ((downloadedSize / totalSize) * 100).toFixed(1) : '?';
      const downloadedMB = (downloadedSize / (1024 * 1024)).toFixed(2);
      const totalMB = totalSize > 0 ? (totalSize / (1024 * 1024)).toFixed(2) : '?';
      const speedMBps = elapsed > 0 ? (downloadedSize / (1024 * 1024) / elapsed).toFixed(2) : '0.00';

      console.log(`  Downloading: ${downloadedMB}MB / ${totalMB}MB (${percentage}%) - ${speedMBps} MB/s`);
      lastLogTime = now;
    }
  });

  await new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', (err: Error) => {
      fs.unlink(zipFilePath, () => {});
      reject(err);
    });
    response.data.on('error', (err: any) => {
      writer.close();
      fs.unlink(zipFilePath, () => {});
      reject(err);
    });
  });

  const totalDownloadTime = ((Date.now() - startDownloadTime) / 1000).toFixed(2);
  const finalSizeMB = (downloadedSize / (1024 * 1024)).toFixed(2);
  console.log(`Download completed: ${finalSizeMB}MB in ${totalDownloadTime}s`);
  console.log('ZIP downloaded. Extracting files...');

  const zip = new AdmZip(zipFilePath);
  zip.extractAllTo(extractDir, true);
  fs.unlinkSync(zipFilePath);

  const extractedFiles = getAllFilesFromLocalDir(extractDir);
  const filesToPersist: { fileName: string; sourcePath: string }[] = [];

  for (const extractedFile of extractedFiles) {
    const relativePath = path.relative(extractDir, extractedFile).split(path.sep).join('/');

    if (await backupAlreadyExists('files-backup', relativePath)) {
      throttledLog('zippedfile-skip', `Skipped (already exists in backup): ${relativePath}`);
      continue;
    }

    filesToPersist.push({ fileName: relativePath, sourcePath: extractedFile });
  }

  flushThrottledLogs();

  await persistBackupFiles('files-backup', filesToPersist, false);
  fs.rmSync(extractDir, { recursive: true, force: true });
};