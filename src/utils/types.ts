
export type FolderPrefix = 'files-backup' | 'db-backup';
export type DatabaseSourceType = 'postgresql' | 'mssql';
export type FileBackupSourceType = 'local' | 'supabase' | 'listingUrl' | 'zippedFile';
export type DestinationSourceType = 'local' | 'aws' | 'r2'

export interface DatabaseConfig {
  type: DatabaseSourceType;
  name: string; // Friendly name for the database
  connectionString?: string; // For PostgreSQL
  // For PostgreSQL: LIKE patterns of other databases on the same server to back up
  // too (e.g. one database per tenant). Resolved on every run, so new databases are
  // picked up automatically.
  includeDatabasesLike?: string[];
  // Internal: set on entries generated from includeDatabasesLike.
  discovered?: boolean;
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