import { BackupResult, DatabaseConfig } from "../utils/types";
import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import sql from 'mssql';

const execPromise = promisify(exec);

// Create a MSSQL backup
export const createMSSQLBackup = async (config: DatabaseConfig): Promise<BackupResult> => {
  if (!config.host || !config.database || !config.user || !config.password) {
    throw new Error(`MSSQL connection parameters (host, database, user, password) are required for database: ${config.name}`);
  }

  const dbName = config.name;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const localFilename = `backup-${dbName}-${timestamp}.bak`;
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
    
    return { filePath, filename: localFilename, databaseName: dbName, databaseType: 'mssql' };
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
