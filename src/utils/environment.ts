import dotenv from 'dotenv';
import { DestinationSourceType, FileBackupSourceType } from './types';

dotenv.config();

export interface EnvironmentConfig {
  awsAccessKeyId?: string;
  awsS3Bucket?: string;
  awsS3Region?: string;
  awsSecretAccessKey?: string;
  backupDatabaseUrl?: string;
  destinationType: DestinationSourceType
  cronJobInterval?: string;
  databaseConfigs?: string;
  filesBackupListingUrl?: string;
  filesBackupPath?: string;
  filesBackupSource?: FileBackupSourceType;
  filesBackupSupabasePrefix?: string;
  filesBackupUrl?: string;
  localBackupPath?: string;
  pgDumpPath?: string;
  r2AccessKeyId?: string;
  r2AccountId?: string;
  r2Bucket?: string;
  r2SecretAccessKey?: string;
  runOnStartup: boolean;
  supabaseBucket?: string;
  supabaseServiceRoleKey?: string;
  supabaseUrl?: string;
  processEnvironment: NodeJS.ProcessEnv;
}

const readOptional = (name: string) => process.env[name]?.trim() || undefined;

export const getEnvironment = (): EnvironmentConfig => {
  const configuredBackupDestinationType = readOptional('BACKUP_DESTINATION_TYPE');

  if (configuredBackupDestinationType && configuredBackupDestinationType !== 'local' && configuredBackupDestinationType !== 'aws' && configuredBackupDestinationType !== 'r2') {
    throw new Error('BACKUP_DESTINATION_TYPE must be local, aws, or r2');
  }

  const destinationType = (configuredBackupDestinationType || 'aws') as DestinationSourceType;

  return {
    awsAccessKeyId: readOptional('AWS_ACCESS_KEY_ID'),
    awsS3Bucket: readOptional('AWS_S3_BUCKET'),
    awsS3Region: readOptional('AWS_S3_REGION'),
    awsSecretAccessKey: readOptional('AWS_SECRET_ACCESS_KEY'),
    backupDatabaseUrl: readOptional('BACKUP_DATABASE_URL'),
    destinationType,
    cronJobInterval: readOptional('CRON_JOB_INTERVAL'),
    databaseConfigs: readOptional('DATABASE_CONFIGS'),
    filesBackupListingUrl: readOptional('FILES_BACKUP_LISTING_URL'),
    filesBackupPath: readOptional('FILES_BACKUP_PATH'),
    filesBackupSource: readOptional('FILES_BACKUP_SOURCE') as FileBackupSourceType | undefined,
    filesBackupSupabasePrefix: readOptional('FILES_BACKUP_SUPABASE_PREFIX'),
    filesBackupUrl: readOptional('FILES_BACKUP_URL'),
    localBackupPath: readOptional('LOCAL_BACKUP_PATH'),
    pgDumpPath: readOptional('PG_DUMP_PATH'),
    r2AccessKeyId: readOptional('R2_ACCESS_KEY_ID'),
    r2AccountId: readOptional('R2_ACCOUNT_ID'),
    r2Bucket: readOptional('R2_BUCKET'),
    r2SecretAccessKey: readOptional('R2_SECRET_ACCESS_KEY'),
    runOnStartup: readOptional('RUN_ON_STARTUP') === 'true',
    supabaseBucket: readOptional('SUPABASE_BUCKET'),
    supabaseServiceRoleKey: readOptional('SUPABASE_SERVICE_ROLE_KEY'),
    supabaseUrl: readOptional('SUPABASE_URL'),
    processEnvironment: process.env,
  };
};