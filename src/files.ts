import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { promisify } from 'util';
import cron from 'node-cron';
import { uploadToS3 } from './s3';
import axios from 'axios';

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
    const filename = `files-backup-${timestamp}.zip`;
    const filePath = path.join(backupDir, filename);

    // Download the ZIP file
    const response = await axios.get(fileUrl, { responseType: 'stream' });
    const writer = fs.createWriteStream(filePath);

    await new Promise((resolve, reject) => {
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // Upload to S3
    await uploadToS3(filePath, filename);

    // Optionally, remove the local file after upload
    fs.unlinkSync(filePath);

    console.log('Files backup completed successfully.');
  } catch (error) {
    console.error('Error performing files backup:', error);
    process.exit(1);
  }
}