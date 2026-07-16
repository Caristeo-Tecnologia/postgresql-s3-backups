
export type FolderPrefix = 'files-backup' | 'db-backup';
export type DatabaseSourceType = 'postgresql' | 'mssql';
export type FileBackupSourceType = 'local' | 'supabase' | 'listingUrl' | 'zippedFile';
export type DestinationSourceType = 'local' | 'aws' | 'r2'

export interface DatabaseConfig {
  type: DatabaseSourceType;
  name: string; // Friendly name for the database
  connectionString?: string; // For PostgreSQL
  host?: string; // For MSSQL
  port?: number; // For MSSQL
  database?: string; // For MSSQL
  user?: string; // For MSSQL
  password?: string; // For MSSQL
  options?: {
    encrypt?: boolean; // For MSSQL
    trustServerCertificate?: boolean; // For MSSQL
  };
}

export interface BackupResult {
  filePath: string;
  filename: string;
  databaseName: string;
  databaseType: DatabaseSourceType;
}


export interface FileInfo {
    fileName: string
    size: number
    url: string
}