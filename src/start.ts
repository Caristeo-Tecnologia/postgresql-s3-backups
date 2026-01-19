import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { promisify } from 'util';
import cron from 'node-cron';
import { uploadToS3 } from './s3';
import { performDatabaseBackup } from './database';
import { performFilesBackup } from './files';
import { getValidatedDatabaseConfigs } from './config';

// Load environment variables
dotenv.config();

async function performBackups() {
  await performFilesBackup();
  
  // Get database configurations
  const databaseConfigs = getValidatedDatabaseConfigs();
  
  if (databaseConfigs.length > 0) {
    await performDatabaseBackup(databaseConfigs);
  } else {
    console.log('No valid database configurations found, skipping database backups');
  }
}

// Schedule backup using cron
const scheduleBackup = (cronExpression: string) => {
  console.log(`Scheduling backups with cron pattern: ${cronExpression}`);
  
  cron.schedule(cronExpression, () => {
    console.log(`Executing scheduled backup at ${new Date().toISOString()}`);
    performBackups();
  });
  
  console.log('Backup scheduler is running...');
};

const initialize = () => {
  const cronInterval = process.env.CRON_JOB_INTERVAL;

  if (cronInterval && cronInterval.trim() !== '') {
    try {
      scheduleBackup(cronInterval);
    } catch (error) {
      console.error('Invalid CRON_JOB_INTERVAL format:', error);
    }
  }

  if (process.env.RUN_ON_STARTUP === 'true') {
    performBackups();
  }
};

initialize();