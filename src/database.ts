import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { promisify } from 'util';
import cron from 'node-cron';
import sql from 'mssql';
import { uploadToS3 } from './s3';
import { DatabaseConfig, BackupResult } from './types';

const execPromise = promisify(exec);

// Run pg_dump to create a PostgreSQL backup
const createPostgreSQLBackup = async (config: DatabaseConfig): Promise<BackupResult> => {
  if (!config.connectionString) {
    throw new Error(`PostgreSQL connection string is required for database: ${config.name}`);
  }

  const dbName = config.name;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const localFilename = `backup-${dbName}-${timestamp}.sql.gz`;
  const s3Filename = `db-backup/${localFilename}`;
  const filePath = path.join(process.cwd(), 'backups', localFilename);
  
  // Create backups directory if it doesn't exist
  const backupsDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  console.log(`Creating PostgreSQL backup for database ${dbName}...`);
  
  try {
    // Run pg_dump with gzip compression using the full database URL
    const pgDumpPath = process.env.PG_DUMP_PATH || '';
    const { stdout, stderr } = await execPromise(`${pgDumpPath}pg_dump --dbname="${config.connectionString}" -F p | gzip > "${filePath}"`);
    
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
    
    console.log(`PostgreSQL backup created at ${filePath} (${stats.size} bytes)`);
    return { filePath, filename: s3Filename, databaseName: dbName, databaseType: 'postgresql' };
  } catch (error) {
    console.error('Error creating PostgreSQL backup:', error);
    
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

// Create a MSSQL backup
const createMSSQLBackup = async (config: DatabaseConfig): Promise<BackupResult> => {
  if (!config.host || !config.database || !config.user || !config.password) {
    throw new Error(`MSSQL connection parameters (host, database, user, password) are required for database: ${config.name}`);
  }

  const dbName = config.name;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const localFilename = `backup-${dbName}-${timestamp}.bak`;
  const s3Filename = `db-backup/${localFilename}`;
  const filePath = path.join(process.cwd(), 'backups', localFilename);
  
  // Create backups directory if it doesn't exist
  const backupsDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  console.log(`Creating MSSQL backup for database ${dbName}...`);
  
  try {
    // Connect to MSSQL
    const sqlConfig: sql.config = {
      server: config.host,
      port: config.port || 1433,
      database: config.database,
      user: config.user,
      password: config.password,
      options: {
        encrypt: config.options?.encrypt ?? true,
        trustServerCertificate: config.options?.trustServerCertificate ?? false,
      },
    };

    const pool = await sql.connect(sqlConfig);
    
    // Get all tables data and create a SQL dump
    const tables = await pool.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE'
    `);
    
    let sqlDump = `-- MSSQL Database Backup\n`;
    sqlDump += `-- Database: ${config.database}\n`;
    sqlDump += `-- Date: ${new Date().toISOString()}\n\n`;
    
    for (const table of tables.recordset) {
      const tableName = table.TABLE_NAME;
      
      // Get table schema
      const columns = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = '${tableName}'
        ORDER BY ORDINAL_POSITION
      `);
      
      sqlDump += `-- Table: ${tableName}\n`;
      
      // Get table data
      const data = await pool.request().query(`SELECT * FROM [${tableName}]`);
      
      if (data.recordset.length > 0) {
        sqlDump += `-- Data for table ${tableName}\n`;
        for (const row of data.recordset) {
          const values = columns.recordset.map((col: any) => {
            const value = row[col.COLUMN_NAME];
            if (value === null || value === undefined) {
              return 'NULL';
            }
            if (typeof value === 'string') {
              return `'${value.replace(/'/g, "''")}'`;
            }
            if (value instanceof Date) {
              return `'${value.toISOString()}'`;
            }
            return value;
          }).join(', ');
          
          sqlDump += `INSERT INTO [${tableName}] VALUES (${values});\n`;
        }
        sqlDump += '\n';
      }
    }
    
    await pool.close();
    
    // Write to file
    fs.writeFileSync(filePath, sqlDump);
    
    const stats = fs.statSync(filePath);
    console.log(`MSSQL backup created at ${filePath} (${stats.size} bytes)`);
    
    return { filePath, filename: s3Filename, databaseName: dbName, databaseType: 'mssql' };
  } catch (error) {
    console.error('Error creating MSSQL backup:', error);
    
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
    
    const backupStorage = process.env.BACKUP_STORAGE || 'cloud';
    const localBackupPath = process.env.LOCAL_BACKUP_PATH;
    
    console.log(`Starting database backup process for ${databases.length} database(s)`);
    console.log(`Backup storage mode: ${backupStorage}`);
    
    if (backupStorage === 'local' && localBackupPath) {
      // Ensure local backup directory exists
      const resolvedPath = path.resolve(localBackupPath);
      if (!fs.existsSync(resolvedPath)) {
        fs.mkdirSync(resolvedPath, { recursive: true });
        console.log(`Created local backup directory: ${resolvedPath}`);
      }
    }
    
    for (const dbConfig of databases) {
      try {
        console.log(`\n--- Backing up ${dbConfig.name} (${dbConfig.type}) ---`);
        const result = await createDatabaseBackup(dbConfig);
        
        if (backupStorage === 'local' && localBackupPath) {
          // Move backup to local directory
          const resolvedPath = path.resolve(localBackupPath);
          const finalPath = path.join(resolvedPath, path.basename(result.filePath));
          
          if (result.filePath !== finalPath) {
            fs.renameSync(result.filePath, finalPath);
            console.log(`Backup saved locally: ${finalPath}`);
          } else {
            console.log(`Backup already in target location: ${finalPath}`);
          }
        } else {
          // Upload to cloud (S3/R2)
          await uploadToS3(result.filePath, result.filename);
          
          // Clean up the local file after upload
          fs.unlinkSync(result.filePath);
          console.log(`Removed local backup file: ${result.filePath}`);
        }
        
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

// Legacy function for backward compatibility (using BACKUP_DATABASE_URL env var)
export const performLegacyDatabaseBackup = async () => {
  try {
    if (!process.env.BACKUP_DATABASE_URL) {
      console.log('BACKUP_DATABASE_URL not set, skipping legacy backup');
      return;
    }
    
    console.log('Using legacy backup configuration (BACKUP_DATABASE_URL)');
    
    const legacyConfig: DatabaseConfig = {
      type: 'postgresql',
      name: 'legacy-db',
      connectionString: process.env.BACKUP_DATABASE_URL,
    };
    
    await performDatabaseBackup([legacyConfig]);
  } catch (error) {
    console.error('Legacy backup process failed:', error);
    throw error;
  }
};
