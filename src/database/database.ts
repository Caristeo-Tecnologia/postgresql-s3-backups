import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { promisify } from 'util';
import cron from 'node-cron';
import sql from 'mssql';
import { DatabaseConfig, BackupResult } from '../utils/types';
import { createPostgreSQLBackup } from './postgres.backup';
import { createMSSQLBackup } from './mysql.backup';
import { persistBackupFile } from '../destination/destination';

const execPromise = promisify(exec);

// Create backup based on database type
const createDatabaseBackup = async (config: DatabaseConfig): Promise<BackupResult> => {
  switch (config.type) {
    case 'postgresql':
      return createPostgreSQLBackup(config);
    case 'mssql':
      return createMSSQLBackup(config);
    default:
      throw new Error(`Unsupported database type: ${config.type}`);
  }
};

// Main function to execute the backup process for multiple databases
export const performDatabaseBackup = async (databases: DatabaseConfig[]) => {
  try {
    if (!databases || databases.length === 0) {
      console.log('No databases configured for backup');
      return;
    }
    
    for (const dbConfig of databases) {
      try {
        console.log(`\n--- Backing up ${dbConfig.name} (${dbConfig.type}) ---`);
        const result = await createDatabaseBackup(dbConfig);
        
        await persistBackupFile('db-backup', result.filename, result.filePath, false);

        console.log(`Backup completed for ${dbConfig.name}`);
      } catch (error) {
        console.error(`Failed to backup database ${dbConfig.name}:`, error);
        // Continue with next database instead of exiting
      }
    }
    
    console.log('\nAll database backups completed');
    
  } catch (error) {
    console.error('Backup process failed:', error);
    throw error;
  }
};

