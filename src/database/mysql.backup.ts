import { BackupResult, DatabaseConfig } from "../utils/types";
import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import { getEnvironment } from '../utils/environment';
import { generateRandomPassword, READONLY_BACKUP_USERNAME } from '../utils/readonly-user';

const execPromise = promisify(exec);

// Creates (or, if it already exists, resets the password of) a read-only database
// user, grants it db_datareader access, prints the credentials to switch to, and
// terminates the process. Called when the configured user turns out to be writable.
const provisionReadOnlyUserAndExit = async (pool: sql.ConnectionPool, config: DatabaseConfig): Promise<never> => {
  const username = READONLY_BACKUP_USERNAME;
  const password = generateRandomPassword();

  try {
    const loginExistsResult = await pool.request().query(`SELECT 1 AS found FROM sys.sql_logins WHERE name = '${username}'`);
    const loginExists = loginExistsResult.recordset.length > 0;

    await pool.request().query(
      loginExists
        ? `ALTER LOGIN [${username}] WITH PASSWORD = '${password}'`
        : `CREATE LOGIN [${username}] WITH PASSWORD = '${password}'`
    );

    const userExistsResult = await pool.request().query(`SELECT 1 AS found FROM sys.database_principals WHERE name = '${username}'`);
    if (userExistsResult.recordset.length === 0) {
      await pool.request().query(`CREATE USER [${username}] FOR LOGIN [${username}]`);
    }

    const roleMemberResult = await pool.request().query(`SELECT IS_ROLEMEMBER('db_datareader', '${username}') AS isMember`);
    if (roleMemberResult.recordset[0]?.isMember !== 1) {
      await pool.request().query(`ALTER ROLE db_datareader ADD MEMBER [${username}]`);
    }

    console.error(`\n[${config.name}] The configured database user has write permissions. ${loginExists ? 'Reset the password for' : 'Created'} the read-only user "${username}".`);
    console.error(`Update this database's config to:\n  "user": "${username}",\n  "password": "${password}"\n`);
  } catch (error) {
    console.error(`\n[${config.name}] The configured database user has write permissions, and the read-only user "${username}" could not be created automatically: ${error}`);
    console.error(`Create one manually, for example:\n  CREATE LOGIN [${username}] WITH PASSWORD = '<password>';\n  CREATE USER [${username}] FOR LOGIN [${username}];\n  ALTER ROLE db_datareader ADD MEMBER [${username}];\n`);
  }

  console.error(`Refusing to back up "${config.name}" with a writable user. Set ALLOW_WRITABLE_DATABASE_USER=true to bypass this check.`);

  try {
    await pool.close();
  } catch (closeError) {
    console.error('Failed to close MSSQL connection pool:', closeError);
  }

  process.exit(1);
};

// Refuses to back up with a database user that can modify data (INSERT/UPDATE/DELETE),
// since backups should run with a read-only user. Set ALLOW_WRITABLE_DATABASE_USER=true
// to disable this check for setups where a read-only user isn't available.
const assertReadOnlyDatabaseUser = async (pool: sql.ConnectionPool, config: DatabaseConfig): Promise<void> => {
  if (getEnvironment().allowWritableDatabaseUser) {
    return;
  }

  // fn_my_permissions resolves effective permissions (role membership, ownership,
  // and direct grants) on the default schema, rather than just direct grants.
  const result = await pool.request().query(`
    SELECT permission_name
    FROM fn_my_permissions('dbo', 'SCHEMA')
    WHERE permission_name IN ('INSERT', 'UPDATE', 'DELETE')
  `);

  if (result.recordset.length > 0) {
    await provisionReadOnlyUserAndExit(pool, config);
  }
};

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

    await assertReadOnlyDatabaseUser(pool, config);

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
