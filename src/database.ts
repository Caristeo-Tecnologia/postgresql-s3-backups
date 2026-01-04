import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { promisify } from 'util';
import cron from 'node-cron';
import { uploadToS3 } from './s3';

const execPromise = promisify(exec);

// Run pg_dump to create a backup
 const createDatabaseBackup = async (databaseUrl: string) => {
  // Extract database name from URL for naming the file
  const dbName = databaseUrl.split('/').pop() || 'database';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const localFilename = `backup-${dbName}-${timestamp}.sql.gz`;
  const s3Filename = `db-backup/${localFilename}`; // S3 key with folder structure
  const filePath = path.join(process.cwd(), 'backups', localFilename);
  
  // Create backups directory if it doesn't exist
  const backupsDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  console.log(`Creating backup for database ${dbName}...`);
  
  try {
    // Run pg_dump with gzip compression using the full database URL
    const { stdout, stderr } = await execPromise(`${process.env.PG_DUMP_PATH}pg_dump --dbname="${databaseUrl}" -F p | gzip > "${filePath}"`);
    
    // Check if there was any stderr output (which might indicate an error)
    if (stderr && stderr.trim() !== '') {
      console.error('pg_dump stderr:', stderr);
      throw new Error(`pg_dump error: ${stderr}`);
    }
    
    // Check if the file exists and is not empty (min size for a valid gzip file)
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size < 20) {
      throw new Error('Backup file is empty or too small, likely failed');
    }
    
    console.log(`Backup created at ${filePath} (${stats.size} bytes)`);
    return { filePath, filename: s3Filename };
  } catch (error) {
    console.error('Error creating backup:', error);
    
    // Check if the file was created but is invalid/empty
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`Removed invalid backup file: ${filePath}`);
      } catch (unlinkError) {
        console.error('Failed to remove invalid backup file:', unlinkError);
      }
    }
    
    throw error;
  }
};


// Main function to execute the backup process
export const performDatabaseBackup = async () => {
  try {
    if (!process.env.BACKUP_DATABASE_URL) {
      throw new Error('BACKUP_DATABASE_URL environment variable is not set');
    }
    
    console.log('Starting database backup process');
    
    const { filePath, filename } = await createDatabaseBackup(process.env.BACKUP_DATABASE_URL);
    await uploadToS3(filePath, filename);
    
    console.log('Backup process completed successfully');
    
    // Clean up the local file
    fs.unlinkSync(filePath);
    console.log(`Removed local backup file: ${filePath}`);
    
  } catch (error) {
    console.error('Backup process failed:', error);
    process.exit(1);
  }
};
