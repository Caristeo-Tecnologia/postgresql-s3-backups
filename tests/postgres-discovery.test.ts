import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDiscoveredConfigs, buildDiscoveryQuery } from '../src/database/postgres.discovery';
import { validateDatabaseConfig } from '../src/utils/config';
import { DatabaseConfig } from '../src/utils/types';

const baseConfig: DatabaseConfig = {
  type: 'postgresql',
  name: 'app',
  connectionString: 'postgresql://backup_readonly_user:secret@db.example.com:5432/app_prd?sslmode=require',
  includeDatabasesLike: ['app_prd_tenant_%'],
};

test('builds a query matching any of the patterns', () => {
  const query = buildDiscoveryQuery(['app_prd_tenant_%', 'app_prd_audit']);

  assert.match(query, /datname LIKE 'app_prd_tenant_%' OR datname LIKE 'app_prd_audit'/);
  assert.match(query, /NOT datistemplate/);
});

test('escapes single quotes in patterns', () => {
  assert.match(buildDiscoveryQuery(["x' OR '1'='1"]), /datname LIKE 'x'' OR ''1''=''1'/);
});

test('creates one entry per discovered database keeping server, user and query string', () => {
  const configs = buildDiscoveredConfigs(baseConfig, ['app_prd_tenant_1', 'app_prd_tenant_2']);

  assert.equal(configs.length, 3);
  assert.equal(configs[0], baseConfig);
  assert.deepEqual(configs[1], {
    type: 'postgresql',
    name: 'app_prd_tenant_1',
    connectionString: 'postgresql://backup_readonly_user:secret@db.example.com:5432/app_prd_tenant_1?sslmode=require',
    discovered: true,
  });
  assert.equal(configs[2].name, 'app_prd_tenant_2');
});

test('does not duplicate the base database or repeated names', () => {
  const configs = buildDiscoveredConfigs(baseConfig, ['app_prd', 'app_prd_tenant_1', 'app_prd_tenant_1']);

  assert.deepEqual(configs.map((config) => config.name), ['app', 'app_prd_tenant_1']);
});

test('validates includeDatabasesLike', () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;

  try {
    assert.equal(validateDatabaseConfig(baseConfig), true);
    assert.equal(validateDatabaseConfig({ ...baseConfig, includeDatabasesLike: [''] }), false);
    assert.equal(validateDatabaseConfig({ ...baseConfig, includeDatabasesLike: 'app_%' as unknown as string[] }), false);
    assert.equal(
      validateDatabaseConfig({
        type: 'mssql',
        name: 'mssql',
        host: 'localhost',
        database: 'db',
        user: 'sa',
        password: 'x',
        includeDatabasesLike: ['db_%'],
      }),
      false,
    );
  } finally {
    console.error = originalConsoleError;
  }
});
