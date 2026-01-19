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

export const performFilesBackup = async () => {
  try {
    const fileUrl = process.env.FILES_BACKUP_URL;
    const filePath = process.env.FILES_BACKUP_PATH;

    if (!fileUrl && !filePath) {
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
    } else {
      // Download and extract from URL
      const zipFilename = `files-backup-${timestamp}.zip`;
      const zipFilePath = path.join(backupDir, zipFilename);
      extractDir = path.join(backupDir, `extracted-${timestamp}`);
      shouldCleanup = true;

      console.log('Downloading files backup ZIP...');
      // Download the ZIP file
      const response = await axios.get(fileUrl!, { responseType: 'stream' });
      const writer = fs.createWriteStream(zipFilePath);

      await new Promise((resolve, reject) => {
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

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