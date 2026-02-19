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
    let extractDir: string;
    let shouldCleanup = false;

    // Determine source directory
    if (filePath) {
      // Use local path directly
      console.log(`Using local files from: ${filePath}`);
      if (!fs.existsSync(filePath)) {
        throw new Error(`FILES_BACKUP_PATH does not exist: ${filePath}`);
      }
      extractDir = filePath;
    } else if (listingUrl) {
      console.log('Fetching file listing...');
      const response = await axios.get(listingUrl, { timeout: 30000 });
      const files: FileInfo[] = response.data;

      if (!Array.isArray(files)) {
        throw new Error('Response from FILES_BACKUP_LISTING_URL must be a JSON array');
      }

      console.log(`Found ${files.length} files in listing`);

      extractDir = path.join(backupDir, `temp-files-listing-${timestamp}`);
      fs.mkdirSync(extractDir, { recursive: true });
      shouldCleanup = true;

      // Download files in parallel batches of 10
      const MAX_CONCURRENT_DOWNLOADS = 10;
      let downloadedCount = 0;
      let failedCount = 0;
      const startDownloadTime = Date.now();

      console.log(`Downloading files (max ${MAX_CONCURRENT_DOWNLOADS} concurrent)...`);

      for (let i = 0; i < files.length; i += MAX_CONCURRENT_DOWNLOADS) {
        const batch = files.slice(i, i + MAX_CONCURRENT_DOWNLOADS);
        
        const downloadPromises = batch.map(async (file, batchIndex) => {
          const fileIndex = i + batchIndex;
          const progress = ((fileIndex + 1) / files.length * 100).toFixed(1);

          if (!file.fileName || !file.url) {
            console.warn(`  [${fileIndex + 1}/${files.length}] (${progress}%) ⚠ Skipping invalid file entry (missing fileName or url)`);
            return { success: false };
          }

          try {
            console.log(`Starting download: ${file.fileName} (${(file.size / (1024 * 1024)).toFixed(2)} MB) [${fileIndex + 1}/${files.length}] (${progress}%)`);
            
            const fileResponse = await axios.get(file.url, { 
              responseType: 'stream',
              timeout: 300000, // 5 minutes per file
              maxContentLength: Infinity,
              maxBodyLength: Infinity
            });

            const filePath = path.join(extractDir, file.fileName);
            const fileDir = path.dirname(filePath);
            
            // Create directory if it doesn't exist (for nested paths)
            if (!fs.existsSync(fileDir)) {
              fs.mkdirSync(fileDir, { recursive: true });
            }

            const writer = fs.createWriteStream(filePath);

            await new Promise<void>((resolve, reject) => {
              fileResponse.data.pipe(writer);
              writer.on('finish', () => resolve());
              writer.on('error', (err) => {
                fs.unlink(filePath, () => {}); // Cleanup partial file
                reject(err);
              });
              fileResponse.data.on('error', (err: any) => {
                writer.close();
                fs.unlink(filePath, () => {}); // Cleanup partial file
                reject(err);
              });
            });

            console.log(`  [${fileIndex + 1}/${files.length}] (${progress}%) ✓ Downloaded: ${file.fileName} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
            return { success: true };
          } catch (error) {
            console.error(`  [${fileIndex + 1}/${files.length}] (${progress}%) ✗ Failed: ${file.fileName}`, error instanceof Error ? error.message : error);
            return { success: false };
          }
        });

        const results = await Promise.all(downloadPromises);
        downloadedCount += results.filter(r => r.success).length;
        failedCount += results.filter(r => !r.success).length;
      }

      const totalDownloadTime = ((Date.now() - startDownloadTime) / 1000).toFixed(2);
      console.log(`\nDownload phase completed in ${totalDownloadTime}s:`);
      console.log(`  - ${downloadedCount} files downloaded successfully`);
      console.log(`  - ${failedCount} files failed or skipped`);
    } else {
      // Download and extract from URL
      const zipFilename = `files-backup-${timestamp}.zip`;
      const zipFilePath = path.join(backupDir, zipFilename);
      extractDir = path.join(backupDir, `extracted-${timestamp}`);
      shouldCleanup = true;

      console.log('Downloading files backup ZIP...');
      // Download the ZIP file
      const response = await axios.get(fileUrl!, { 
        responseType: 'stream',
        timeout: 3000000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      const writer = fs.createWriteStream(zipFilePath);

      // Track download progress
      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedSize = 0;
      const startDownloadTime = Date.now();
      let lastLogTime = startDownloadTime;

      response.data.on('data', (chunk: Buffer) => {
        downloadedSize += chunk.length;
        const now = Date.now();
        
        // Log progress every 500ms to avoid flooding console
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
          fs.unlink(zipFilePath, () => {}); // Cleanup partial file
          reject(err);
        });
        response.data.on('error', (err: any) => {
          writer.close();
          fs.unlink(zipFilePath, () => {}); // Cleanup partial file
          reject(err);
        });
      });

      const totalDownloadTime = ((Date.now() - startDownloadTime) / 1000).toFixed(2);
      const finalSizeMB = (downloadedSize / (1024 * 1024)).toFixed(2);
      console.log(`Download completed: ${finalSizeMB}MB in ${totalDownloadTime}s`);

      console.log('ZIP downloaded. Extracting files...');

      // Extract the ZIP file
      const zip = new AdmZip(zipFilePath);
      zip.extractAllTo(extractDir, true);

      // Cleanup ZIP file immediately after extraction
      fs.unlinkSync(zipFilePath);
    }

    const backupStorage = process.env.BACKUP_STORAGE || 'cloud';
    const localBackupPath = process.env.LOCAL_BACKUP_PATH;

    if (backupStorage === 'local') {
      // Local backup mode - copy files to local directory
      if (!localBackupPath) {
        console.error('LOCAL_BACKUP_PATH is required when BACKUP_STORAGE=local');
        return;
      }

      const resolvedLocalPath = path.resolve(localBackupPath, 'files-backup');
      if (!fs.existsSync(resolvedLocalPath)) {
        fs.mkdirSync(resolvedLocalPath, { recursive: true });
        console.log(`Created local files backup directory: ${resolvedLocalPath}`);
      }

      // Get all files from source directory recursively
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

      const allFiles = getAllFiles(extractDir);
      console.log(`Found ${allFiles.length} files in source directory.`);
      console.log('Copying files to local backup directory...');

      let copiedCount = 0;
      const totalFiles = allFiles.length;

      for (let i = 0; i < allFiles.length; i++) {
        const sourceFile = allFiles[i];
        const relativePath = path.relative(extractDir, sourceFile);
        const destFile = path.join(resolvedLocalPath, relativePath);
        const destDir = path.dirname(destFile);

        // Create destination directory if it doesn't exist
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }

        // Copy file
        fs.copyFileSync(sourceFile, destFile);
        copiedCount++;

        const progress = ((i + 1) / totalFiles * 100).toFixed(1);
        console.log(`  [${i + 1}/${totalFiles}] (${progress}%) Copied: ${relativePath}`);
      }

      // Cleanup: remove temporary files if they were downloaded
      if (shouldCleanup) {
        fs.rmSync(extractDir, { recursive: true, force: true });
      }

      console.log(`\nFiles backup completed:`);
      console.log(`  - ${copiedCount} files copied to local backup`);
      console.log(`  - Backup location: ${resolvedLocalPath}`);
      return;
    }

    // Cloud backup mode (S3/R2)
    // Get list of existing files in S3/R2
    const folderPrefix = 'files-backup/';
    console.log('Checking existing files in bucket...');
    const existingFiles = await listFilesInFolder(folderPrefix);

    // Get all files from extracted directory recursively
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

    const allFiles = getAllFiles(extractDir);
    console.log(`Found ${allFiles.length} files in source directory.`);

    // Upload only new files
    let uploadedCount = 0;
    let skippedCount = 0;
    const totalFiles = allFiles.length;
    const startTime = Date.now();

    console.log('Uploading new files to bucket...');
    for (let i = 0; i < allFiles.length; i++) {
      const filePath = allFiles[i];
      const progress = ((i + 1) / totalFiles * 100).toFixed(1);
      
      // Get relative path from extract directory
      const relativePath = path.relative(extractDir, filePath);

      // Normalize path separators to forward slashes for S3
      const s3Filename = relativePath.split(path.sep).join('/');

      if (existingFiles.has(s3Filename)) {
        skippedCount++;
        console.log(`  [${i + 1}/${totalFiles}] (${progress}%) ⊘ Skipped (already exists): ${s3Filename}`);
      } else {
        console.log(`  [${i + 1}/${totalFiles}] (${progress}%) Uploading: ${s3Filename}`);
        await uploadFileToFolder(filePath, folderPrefix, s3Filename);
        uploadedCount++;
      }
    }

    // Cleanup: remove local files
    if (shouldCleanup) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`\nFiles backup completed in ${duration}s:`);
    console.log(`  - ${uploadedCount} new files uploaded`);
    console.log(`  - ${skippedCount} files skipped (already backed up)`);
    console.log(`  - Total files in backup: ${existingFiles.size + uploadedCount}`);
  } catch (error) {
    console.error('Error performing files backup:', error);
    process.exit(1);
  }
}