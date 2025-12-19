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

    if (!fileUrl) {
      console.log('FILES_BACKUP_URL is not set in environment variables, files backup skipped.');
      return;
    }

    const backupDir = path.resolve(__dirname, '../backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFilename = `files-backup-${timestamp}.zip`;
    const zipFilePath = path.join(backupDir, zipFilename);
    const extractDir = path.join(backupDir, `extracted-${timestamp}`);

    console.log('Downloading files backup ZIP...');
    // Download the ZIP file
    const response = await axios.get(fileUrl, { responseType: 'stream' });
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
    console.log(`Found ${allFiles.length} files in ZIP archive.`);

    // Upload only new files
    let uploadedCount = 0;
    let skippedCount = 0;

    console.log('Uploading new files to bucket...');
    for (const filePath of allFiles) {
      // Get relative path from extract directory
      const relativePath = path.relative(extractDir, filePath);
      
      // Normalize path separators to forward slashes for S3
      const s3Filename = relativePath.split(path.sep).join('/');

      if (existingFiles.has(s3Filename)) {
        skippedCount++;
        console.log(`  ⊘ Skipped (already exists): ${s3Filename}`);
      } else {
        await uploadFileToFolder(filePath, folderPrefix, s3Filename);
        uploadedCount++;
      }
    }

    // Cleanup: remove local files
    fs.unlinkSync(zipFilePath);
    fs.rmSync(extractDir, { recursive: true, force: true });

    console.log(`\nFiles backup completed:`);
    console.log(`  - ${uploadedCount} new files uploaded`);
    console.log(`  - ${skippedCount} files skipped (already backed up)`);
    console.log(`  - Total files in backup: ${existingFiles.size + uploadedCount}`);
  } catch (error) {
    console.error('Error performing files backup:', error);
    process.exit(1);
  }
}