export type DatabaseType = 'postgresql' | 'mssql';

export interface DatabaseConfig {
  type: DatabaseType;
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
  databaseType: DatabaseType;
}
