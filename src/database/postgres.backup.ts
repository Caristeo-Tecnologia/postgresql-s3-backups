import { BackupResult, DatabaseConfig } from "../utils/types";
import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { EnvironmentConfig, getEnvironment } from '../utils/environment';
import { generateRandomPassword, READONLY_BACKUP_USERNAME } from '../utils/readonly-user';

const execPromise = promisify(exec);

// Runs a SQL script against the configured database via `psql`, mirroring the
// pg_dump connection handling below (same binary folder, same Windows quirks).
// The SQL is written to a temp file and run with `-f` so it never has to be
// shell-escaped, however many statements or quotes it contains.
export const runPsql = async (config: DatabaseConfig, environment: EnvironmentConfig, sql: string): Promise<string> => {
  const pgDumpPath = environment.pgDumpPath || '';
  const isWindows = process.platform === 'win32';
  const psqlExecutable = isWindows ? 'psql.exe' : 'psql';
  const psqlFullPath = pgDumpPath ? path.join(pgDumpPath, psqlExecutable) : psqlExecutable;
  const quotedPsql = pgDumpPath ? `"${psqlFullPath}"` : psqlExecutable;

  const tempFile = path.join(os.tmpdir(), `pg-backup-check-${crypto.randomUUID()}.sql`);
  fs.writeFileSync(tempFile, sql);

  try {
    let command: string;
    let env = environment.processEnvironment;

    if (isWindows) {
      let pgPassword = '';
      let pgHost = 'localhost';
      let pgPort = '5432';
      let pgUser = '';
      let pgDatabase = '';

      try {
        const url = new URL(config.connectionString!);
        pgPassword = url.password || '';
        pgHost = url.hostname || 'localhost';
        pgPort = url.port || '5432';
        pgUser = url.username || '';
        pgDatabase = url.pathname.substring(1);
      } catch (error) {
        throw new Error('Invalid PostgreSQL connection string format');
      }

      env = {
        ...environment.processEnvironment,
        PGPASSWORD: pgPassword,
      };

      const quotedTempFile = `"${tempFile}"`;
      command = `cmd /c "${quotedPsql} -h ${pgHost} -p ${pgPort} -U ${pgUser} -d ${pgDatabase} -tA -f ${quotedTempFile}"`;
    } else {
      command = `${quotedPsql} --dbname="${config.connectionString}" -tA -f "${tempFile}"`;
    }

    const { stdout } = await execPromise(command, { env });
    return stdout;
  } finally {
    fs.unlinkSync(tempFile);
  }
};

// Creates (or, if it already exists, resets the password of) a read-only database
// user, grants it SELECT access, prints the connection string to switch to, and
// terminates the process. Called when the configured user turns out to be writable.
const provisionReadOnlyUserAndExit = async (config: DatabaseConfig, environment: EnvironmentConfig): Promise<never> => {
  const username = READONLY_BACKUP_USERNAME;
  const password = generateRandomPassword();

  try {
    const url = new URL(config.connectionString!);
    const dbName = url.pathname.substring(1);

    const existsResult = await runPsql(config, environment, `SELECT 1 FROM pg_roles WHERE rolname = '${username}'`);
    const userExists = existsResult.trim() !== '';

    const upsertUserSql = userExists
      ? `ALTER ROLE ${username} WITH PASSWORD '${password}';`
      : `CREATE ROLE ${username} LOGIN PASSWORD '${password}';`;

    await runPsql(config, environment, `
      ${upsertUserSql}
      GRANT CONNECT ON DATABASE ${dbName} TO ${username};
      GRANT USAGE ON SCHEMA public TO ${username};
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${username};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${username};
    `);

    url.username = username;
    url.password = password;

    console.error(`\n[${config.name}] The configured database user has write permissions. ${userExists ? 'Reset the password for' : 'Created'} the read-only user "${username}".`);
    console.error(`Update this database's connectionString to:\n  ${url.toString()}\n`);
  } catch (error) {
    console.error(`\n[${config.name}] The configured database user has write permissions, and the read-only user "${username}" could not be created automatically: ${error}`);
    console.error(`Create one manually, for example:\n  CREATE ROLE ${username} LOGIN PASSWORD '<password>';\n  GRANT CONNECT ON DATABASE <dbname> TO ${username};\n  GRANT USAGE ON SCHEMA public TO ${username};\n  GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${username};\n  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${username};\n`);
  }

  console.error(`Refusing to back up "${config.name}" with a writable user. Set ALLOW_WRITABLE_DATABASE_USER=true to bypass this check.`);
  process.exit(1);
};

// Refuses to back up with a database user that can modify data (INSERT/UPDATE/DELETE),
// since backups should run with a read-only user. Set ALLOW_WRITABLE_DATABASE_USER=true
// to disable this check for setups where a read-only user isn't available.
const assertReadOnlyDatabaseUser = async (config: DatabaseConfig, environment: EnvironmentConfig): Promise<void> => {
  if (environment.allowWritableDatabaseUser) {
    return;
  }

  // has_table_privilege() reflects effective privileges (ownership, role membership,
  // and direct grants), unlike information_schema.role_table_grants which misses ownership.
  const query = "SELECT bool_or(has_table_privilege(schemaname || '.' || tablename, 'INSERT') OR has_table_privilege(schemaname || '.' || tablename, 'UPDATE') OR has_table_privilege(schemaname || '.' || tablename, 'DELETE')) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')";

  let stdout: string;
  try {
    stdout = await runPsql(config, environment, query);
  } catch (error) {
    throw new Error(`Could not verify database user permissions for "${config.name}": ${error}. Set ALLOW_WRITABLE_DATABASE_USER=true to skip this check.`);
  }

  if (stdout.trim() === 't') {
    // Databases found through includeDatabasesLike share the base entry's user, whose
    // access is expected to be granted where the databases are created. Provisioning a
    // user here would reset its password and stop the run halfway through the list.
    if (config.discovered) {
      throw new Error(`The configured database user has write permissions on "${config.name}". Grant it read-only access to this database or set ALLOW_WRITABLE_DATABASE_USER=true to bypass this check.`);
    }

    await provisionReadOnlyUserAndExit(config, environment);
  }
};

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
    const environment = getEnvironment();
    await assertReadOnlyDatabaseUser(config, environment);

    // Run pg_dump with compression
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
