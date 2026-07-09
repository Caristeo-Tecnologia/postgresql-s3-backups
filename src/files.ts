import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { promisify } from 'util';
import cron from 'node-cron';
import { listFilesInFolder, uploadFileToFolder } from './s3';
import axios from 'axios';
import AdmZip from 'adm-zip';

dotenv.config();

export interface FileInfo {
    fileName: string
    size: number
    url: string
}

const getAllFiles = (dirPath: string, arrayOfFiles: string[] = []) => {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const filePath = path.join(dirPath, file);
    if (fs.statSync(filePath).isDirectory()) {
      arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
    } else {
      arrayOfFiles.push(filePath);
    }
  });

  return arrayOfFiles;
};

const persistFilesToDestination = async (
  sourceDir: string,
  backupStorage: string,
  resolvedLocalPath: string | undefined,
  existingFiles: Set<string> | undefined,
  shouldCleanup: boolean,
) => {
  const allFiles = getAllFiles(sourceDir);
  console.log(`Found ${allFiles.length} files in source directory.`);

  if (backupStorage === 'local') {
    if (!resolvedLocalPath) {
      throw new Error('LOCAL_BACKUP_PATH is required when BACKUP_STORAGE=local');
    }

    console.log('Copying files to local backup directory...');

    let copiedCount = 0;
    const totalFiles = allFiles.length;

    for (let i = 0; i < allFiles.length; i++) {
      const sourceFile = allFiles[i];
      const relativePath = path.relative(sourceDir, sourceFile);
      const destFile = path.join(resolvedLocalPath, relativePath);
      const destDir = path.dirname(destFile);
      const progress = ((i + 1) / totalFiles * 100).toFixed(1);

      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      if (fs.existsSync(destFile)) {
        console.log(`  [${i + 1}/${totalFiles}] (${progress}%) ⊘ Skipped (already exists in backup): ${relativePath}`);
        continue;
      }

      fs.copyFileSync(sourceFile, destFile);
      copiedCount++;
      console.log(`  [${i + 1}/${totalFiles}] (${progress}%) Copied: ${relativePath}`);
    }

    if (shouldCleanup) {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }

    console.log(`\nFiles backup completed:`);
    console.log(`  - ${copiedCount} files copied to local backup`);
    console.log(`  - Backup location: ${resolvedLocalPath}`);
    return;
  }

  const folderPrefix = 'files-backup/';
  const existingFilesSet = existingFiles ?? new Set<string>();

  console.log('Uploading new files to bucket...');

  let uploadedCount = 0;
  let skippedCount = 0;
  const totalFiles = allFiles.length;
  const startTime = Date.now();

  for (let i = 0; i < allFiles.length; i++) {
    const filePath = allFiles[i];
    const progress = ((i + 1) / totalFiles * 100).toFixed(1);
    const relativePath = path.relative(sourceDir, filePath);
    const s3Filename = relativePath.split(path.sep).join('/');

    if (existingFilesSet.has(s3Filename)) {
      skippedCount++;
      console.log(`  [${i + 1}/${totalFiles}] (${progress}%) ⊘ Skipped (already exists): ${s3Filename}`);
    } else {
      console.log(`  [${i + 1}/${totalFiles}] (${progress}%) Uploading: ${s3Filename}`);
      await uploadFileToFolder(filePath, folderPrefix, s3Filename);
      uploadedCount++;
    }
  }

  if (shouldCleanup) {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  console.log(`\nFiles backup completed in ${duration}s:`);
  console.log(`  - ${uploadedCount} new files uploaded`);
  console.log(`  - ${skippedCount} files skipped (already backed up)`);
  console.log(`  - Total files in backup: ${existingFilesSet.size + uploadedCount}`);
};

const backupFromLocalDirectory = async (
  sourceDir: string,
  backupStorage: string,
  resolvedLocalPath: string | undefined,
  existingFiles: Set<string> | undefined,
) => {
  await persistFilesToDestination(sourceDir, backupStorage, resolvedLocalPath, existingFiles, false);
};

const backupFromListingUrl = async (
  listingUrl: string,
  backupDir: string,
  timestamp: string,
  backupStorage: string,
  resolvedLocalPath: string | undefined,
  existingFiles: Set<string> | undefined,
) => {
  console.log('Fetching file listing...');
  const response = await axios.get(listingUrl, { timeout: 30000 });
  const files: FileInfo[] = response.data;

  if (!Array.isArray(files)) {
    throw new Error('Response from FILES_BACKUP_LISTING_URL must be a JSON array');
  }

  console.log(`Found ${files.length} files in listing`);

  const extractDir = path.join(backupDir, `temp-files-listing-${timestamp}`);
  fs.mkdirSync(extractDir, { recursive: true });

  const MAX_CONCURRENT_DOWNLOADS = 10;
  let downloadedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const startDownloadTime = Date.now();

  console.log(`Downloading files (max ${MAX_CONCURRENT_DOWNLOADS} concurrent)...`);

  for (let i = 0; i < files.length; i += MAX_CONCURRENT_DOWNLOADS) {
    const batch = files.slice(i, i + MAX_CONCURRENT_DOWNLOADS);

    const downloadPromises = batch.map(async (file, batchIndex) => {
      const fileIndex = i + batchIndex;
      const progress = ((fileIndex + 1) / files.length * 100).toFixed(1);

      if (!file.fileName || !file.url) {
        console.warn(`  [${fileIndex + 1}/${files.length}] (${progress}%) ⚠ Skipping invalid file entry (missing fileName or url)`);
        return { status: 'failed' as const };
      }

      const normalizedRelativePath = file.fileName.replace(/^\/+/, '').split(/[/\\]/).join('/');
      const destinationExists = backupStorage === 'local'
        ? resolvedLocalPath && fs.existsSync(path.join(resolvedLocalPath, normalizedRelativePath))
        : existingFiles?.has(normalizedRelativePath) || false;

      if (destinationExists) {
        console.log(`  [${fileIndex + 1}/${files.length}] (${progress}%) ⊘ Skipped (already exists in backup): ${normalizedRelativePath}`);
        return { status: 'skipped' as const };
      }

      try {
        console.log(`Starting download: ${file.fileName} (${(file.size / (1024 * 1024)).toFixed(2)} MB) [${fileIndex + 1}/${files.length}] (${progress}%)`);

        const fileResponse = await axios.get(file.url, {
          responseType: 'stream',
          timeout: 300000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        });

        const filePath = path.join(extractDir, normalizedRelativePath);
        const fileDir = path.dirname(filePath);

        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }

        const writer = fs.createWriteStream(filePath);

        await new Promise<void>((resolve, reject) => {
          fileResponse.data.pipe(writer);
          writer.on('finish', () => resolve());
          writer.on('error', (err) => {
            fs.unlink(filePath, () => {});
            reject(err);
          });
          fileResponse.data.on('error', (err: any) => {
            writer.close();
            fs.unlink(filePath, () => {});
            reject(err);
          });
        });

        console.log(`  [${fileIndex + 1}/${files.length}] (${progress}%) ✓ Downloaded: ${normalizedRelativePath} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
        return { status: 'downloaded' as const };
      } catch (error) {
        console.error(`  [${fileIndex + 1}/${files.length}] (${progress}%) ✗ Failed: ${normalizedRelativePath}`, error instanceof Error ? error.message : error);
        return { status: 'failed' as const };
      }
    });

    const results = await Promise.all(downloadPromises);
    downloadedCount += results.filter(r => r.status === 'downloaded').length;
    skippedCount += results.filter(r => r.status === 'skipped').length;
    failedCount += results.filter(r => r.status === 'failed').length;
  }

  const totalDownloadTime = ((Date.now() - startDownloadTime) / 1000).toFixed(2);
  console.log(`\nDownload phase completed in ${totalDownloadTime}s:`);
  console.log(`  - ${downloadedCount} files downloaded successfully`);
  console.log(`  - ${skippedCount} files skipped (already in backup destination)`);
  console.log(`  - ${failedCount} files failed`);

  await persistFilesToDestination(extractDir, backupStorage, resolvedLocalPath, existingFiles, true);
};

const backupFromZipUrl = async (
  fileUrl: string,
  backupDir: string,
  timestamp: string,
  backupStorage: string,
  resolvedLocalPath: string | undefined,
  existingFiles: Set<string> | undefined,
) => {
  const zipFilename = `files-backup-${timestamp}.zip`;
  const zipFilePath = path.join(backupDir, zipFilename);
  const extractDir = path.join(backupDir, `extracted-${timestamp}`);

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
    writer.on('error', (err) => {
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

  await persistFilesToDestination(extractDir, backupStorage, resolvedLocalPath, existingFiles, true);
};

export const performFilesBackup = async () => {
  try {
    const fileUrl = process.env.FILES_BACKUP_URL;
    const filePath = process.env.FILES_BACKUP_PATH;
    const listingUrl = process.env.FILES_BACKUP_LISTING_URL;

    if (!fileUrl && !filePath && !listingUrl) {
      console.log('Neither FILES_BACKUP_URL nor FILES_BACKUP_PATH is set in environment variables, files backup skipped.');
      return;
    }

    const backupDir = path.resolve(__dirname, '../backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupStorage = process.env.BACKUP_STORAGE || 'cloud';
    const localBackupPath = process.env.LOCAL_BACKUP_PATH;
    let resolvedLocalPath: string | undefined;
    let existingFiles: Set<string> | undefined;

    if (backupStorage === 'local') {
      if (!localBackupPath) {
        console.error('LOCAL_BACKUP_PATH is required when BACKUP_STORAGE=local');
        return;
      }

      resolvedLocalPath = path.resolve(localBackupPath, 'files-backup');
      if (!fs.existsSync(resolvedLocalPath)) {
        fs.mkdirSync(resolvedLocalPath, { recursive: true });
        console.log(`Created local files backup directory: ${resolvedLocalPath}`);
      }
    } else {
      console.log('Checking existing files in bucket...');
      existingFiles = await listFilesInFolder('files-backup/');
    }

    if (filePath) {
      console.log(`Using local files from: ${filePath}`);
      if (!fs.existsSync(filePath)) {
        throw new Error(`FILES_BACKUP_PATH does not exist: ${filePath}`);
      }

      await backupFromLocalDirectory(filePath, backupStorage, resolvedLocalPath, existingFiles);
      return;
    }

    if (listingUrl) {
      await backupFromListingUrl(listingUrl, backupDir, timestamp, backupStorage, resolvedLocalPath, existingFiles);
      return;
    }

    if (fileUrl) {
      await backupFromZipUrl(fileUrl, backupDir, timestamp, backupStorage, resolvedLocalPath, existingFiles);
      return;
    }
  } catch (error) {
    console.error('Error performing files backup:', error);
    process.exit(1);
  }
}