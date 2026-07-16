import assert from 'node:assert/strict';
import test from 'node:test';
import { getEnvironment } from '../src/utils/environment';

const environmentKeys = [
  'BACKUP_DESTINATION_TYPE',
  'FILES_BACKUP_SOURCE',
  'RUN_ON_STARTUP',
] as const;

const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]]),
);

test.afterEach(() => {
  for (const key of environmentKeys) {
    const value = originalEnvironment[key];

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test('uses AWS as the default backup destination', () => {
  delete process.env.BACKUP_DESTINATION_TYPE;

  assert.equal(getEnvironment().destinationType, 'aws');
});

test('accepts local and R2 backup destinations', () => {
  process.env.BACKUP_DESTINATION_TYPE = 'local';
  assert.equal(getEnvironment().destinationType, 'local');

  process.env.BACKUP_DESTINATION_TYPE = 'r2';
  assert.equal(getEnvironment().destinationType, 'r2');
});

test('rejects unsupported backup destinations', () => {
  process.env.BACKUP_DESTINATION_TYPE = 'cloud';

  assert.throws(
    () => getEnvironment(),
    /BACKUP_DESTINATION_TYPE must be local, aws, or r2/,
  );
});

test('normalizes configured source and startup values', () => {
  process.env.FILES_BACKUP_SOURCE = 'listingUrl';
  process.env.RUN_ON_STARTUP = 'true';

  const environment = getEnvironment();

  assert.equal(environment.filesBackupSource, 'listingUrl');
  assert.equal(environment.runOnStartup, true);
});