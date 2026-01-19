import dotenv from 'dotenv';
import { DatabaseConfig } from './types';

dotenv.config();

/**
 * Parse database configurations from environment variables
 * Supports both new format (DATABASE_CONFIGS JSON) and legacy format (BACKUP_DATABASE_URL)
 */
export const getDatabaseConfigs = (): DatabaseConfig[] => {
  const configs: DatabaseConfig[] = [];
  
  // Try to parse new format: DATABASE_CONFIGS
  const databaseConfigsEnv = process.env.DATABASE_CONFIGS;
  if (databaseConfigsEnv) {
    try {
      const parsedConfigs = JSON.parse(databaseConfigsEnv);
      if (Array.isArray(parsedConfigs)) {
        configs.push(...parsedConfigs);
        console.log(`Loaded ${configs.length} database configuration(s) from DATABASE_CONFIGS`);
      } else {
        console.error('DATABASE_CONFIGS must be a JSON array');
      }
    } catch (error) {
      console.error('Failed to parse DATABASE_CONFIGS:', error);
    }
  }
  
  // Fallback to legacy format if no configs found
  if (configs.length === 0 && process.env.BACKUP_DATABASE_URL) {
    console.log('Using legacy BACKUP_DATABASE_URL configuration');
    configs.push({
      type: 'postgresql',
      name: 'legacy-db',
      connectionString: process.env.BACKUP_DATABASE_URL,
    });
  }
  
  return configs;
};

/**
 * Validate database configuration
 */
export const validateDatabaseConfig = (config: DatabaseConfig): boolean => {
  if (!config.type || !config.name) {
    console.error(`Invalid config: type and name are required`, config);
    return false;
  }
  
  if (config.type === 'postgresql') {
    if (!config.connectionString) {
      console.error(`PostgreSQL config requires connectionString`, config);
      return false;
    }
  }
  
  if (config.type === 'mssql') {
    if (!config.host || !config.database || !config.user || !config.password) {
      console.error(`MSSQL config requires host, database, user, and password`, config);
      return false;
    }
  }
  
  return true;
};

/**
 * Get validated database configurations
 */
export const getValidatedDatabaseConfigs = (): DatabaseConfig[] => {
  const configs = getDatabaseConfigs();
  return configs.filter(validateDatabaseConfig);
};
