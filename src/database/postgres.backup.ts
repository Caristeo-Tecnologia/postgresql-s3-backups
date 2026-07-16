import { BackupResult, DatabaseConfig } from "../utils/types";
import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getEnvironment } from '../utils/environment';

const execPromise = promisify(exec);

// Run pg_dump to create a PostgreSQL backup
export const createPostgreSQLBackup = async (config: DatabaseConfig): Promise<BackupResult> => {
  if (!config.connectionString) {
    throw new Error(`PostgreSQL connection string is required for database: ${config.name}`);
  }

  const dbName = config.name;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const localFilename = `backup-${dbName}-${timestamp}.sql.gz`;
  const filePath = path.join(process.cwd(), 'backups', localFilename);
  
  // Create backups directory if it doesn't exist
  const backupsDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  console.log(`Creating PostgreSQL backup for database ${dbName}...`);
  
  try {
    // Run pg_dump with compression
    const environment = getEnvironment();
    const pgDumpPath = environment.pgDumpPath || '';
    const isWindows = process.platform === 'win32';
    const pgDumpExecutable = isWindows ? 'pg_dump.exe' : 'pg_dump';
    const gzipExecutable = isWindows ? 'gzip.exe' : 'gzip';
    
    // Build the full path to executables with proper quoting
    const pgDumpFullPath = pgDumpPath ? path.join(pgDumpPath, pgDumpExecutable) : pgDumpExecutable;
    
    // Build the pg_dump command with individual parameters instead of connection string
    let command: string;
    let env = environment.processEnvironment;
    
    if (isWindows) {
      // Windows: Extract connection parameters for better compatibility
      let pgPassword = '';
      let pgHost = 'localhost';
      let pgPort = '5432';
      let pgUser = '';
      let pgDatabase = '';
      
      try {
        const url = new URL(config.connectionString);
        pgPassword = url.password || '';
        pgHost = url.hostname || 'localhost';
        pgPort = url.port || '5432';
        pgUser = url.username || '';
        pgDatabase = url.pathname.substring(1); // Remove leading slash
      } catch (error) {
        console.error('Could not parse connection string:', error);
        throw new Error('Invalid PostgreSQL connection string format');
      }
      
      // Set PGPASSWORD environment variable for Windows
      env = {
        ...environment.processEnvironment,
        PGPASSWORD: pgPassword,
      };
      
      // Use separate parameters for better compatibility
      const quotedPgDump = `"${pgDumpFullPath}"`;
      const quotedFilePath = `"${filePath}"`;
      
      // Use individual connection parameters
      command = `cmd /c "${quotedPgDump} -h ${pgHost} -p ${pgPort} -U ${pgUser} -d ${pgDatabase} -F p | ${gzipExecutable} > ${quotedFilePath}"`;
    } else {
      // Unix/Linux/macOS - can use connection string directly (password included in string)
      const quotedPgDump = pgDumpPath ? `"${pgDumpFullPath}"` : pgDumpExecutable;
      const quotedFilePath = `"${filePath}"`;
      command = `${quotedPgDump} --dbname="${config.connectionString}" -F p | ${gzipExecutable} > ${quotedFilePath}`;
    }
    
    const { stdout, stderr } = await execPromise(command, { env });
    
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
    return { filePath, filename: localFilename, databaseName: dbName, databaseType: 'postgresql' };
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
