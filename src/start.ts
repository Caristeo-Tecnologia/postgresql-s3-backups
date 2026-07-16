import cron from 'node-cron';
import { performDatabaseBackup } from './database/database';
import { getValidatedDatabaseConfigs } from './utils/config';
import { performFilesBackup } from './storage-backup/storage';
import { getEnvironment } from './utils/environment';

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
  const environment = getEnvironment();
  const cronInterval = environment.cronJobInterval;

  if (cronInterval && cronInterval.trim() !== '') {
    try {
      scheduleBackup(cronInterval);
    } catch (error) {
      console.error('Invalid CRON_JOB_INTERVAL format:', error);
    }
  }

  if (environment.runOnStartup) {
    performBackups();
  }
};

initialize();