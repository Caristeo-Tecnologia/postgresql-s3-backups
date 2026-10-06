import { DatabaseConfig } from '../utils/types';
import { getEnvironment } from '../utils/environment';
import { runPsql } from './postgres.backup';

const getDatabaseNameFromConnectionString = (connectionString: string): string =>
  decodeURIComponent(new URL(connectionString).pathname.substring(1));

// Builds the query that lists the databases matching any of the LIKE patterns.
export const buildDiscoveryQuery = (patterns: string[]): string => {
  const conditions = patterns
    .map((pattern) => `datname LIKE '${pattern.replace(/'/g, "''")}'`)
    .join(' OR ');

  return `SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn AND (${conditions}) ORDER BY datname`;
};

// Returns the original entry followed by one entry per discovered database, each
// pointing at the same server/user with only the database name swapped.
export const buildDiscoveredConfigs = (config: DatabaseConfig, databaseNames: string[]): DatabaseConfig[] => {
  const baseDatabaseName = getDatabaseNameFromConnectionString(config.connectionString!);
  const seen = new Set<string>([baseDatabaseName]);
  const configs: DatabaseConfig[] = [config];

  for (const databaseName of databaseNames) {
    if (seen.has(databaseName)) {
      continue;
    }
    seen.add(databaseName);

    const url = new URL(config.connectionString!);
    url.pathname = `/${encodeURIComponent(databaseName)}`;

    configs.push({
      type: 'postgresql',
      name: databaseName,
      connectionString: url.toString(),
      discovered: true,
    });
  }

  return configs;
};

// Resolves includeDatabasesLike against the server the entry points to.
export const expandPostgreSQLConfig = async (config: DatabaseConfig): Promise<DatabaseConfig[]> => {
  const patterns = config.includeDatabasesLike ?? [];

  if (patterns.length === 0) {
    return [config];
  }

  const stdout = await runPsql(config, getEnvironment(), buildDiscoveryQuery(patterns));
  const databaseNames = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  return buildDiscoveredConfigs(config, databaseNames);
};
