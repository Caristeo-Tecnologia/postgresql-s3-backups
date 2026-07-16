import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  existisBackupedLocalFile,
  persistFileToLocal,
} from '../src/destination/local.destination';
import { persistBackupFiles } from '../src/destination/destination';

const originalBackupDestination = process.env.BACKUP_DESTINATION_TYPE;
const originalLocalBackupPath = process.env.LOCAL_BACKUP_PATH;

const restoreEnvironment = () => {
  if (originalBackupDestination === undefined) {
    delete process.env.BACKUP_DESTINATION_TYPE;
  } else {
    process.env.BACKUP_DESTINATION_TYPE = originalBackupDestination;
  }

  if (originalLocalBackupPath === undefined) {
    delete process.env.LOCAL_BACKUP_PATH;
  } else {
    process.env.LOCAL_BACKUP_PATH = originalLocalBackupPath;
  }
};

test.afterEach(() => {
  restoreEnvironment();
});

test('persists a file to the local destination and retains its source when requested', async (context) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
  context.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const sourceFile = path.join(workspace, 'source', 'document.txt');
  const destinationDir = path.join(workspace, 'destination');
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.writeFileSync(sourceFile, 'backup content');
  process.env.BACKUP_DESTINATION_TYPE = 'local';
  process.env.LOCAL_BACKUP_PATH = destinationDir;

  await persistFileToLocal('files-backup', 'document.txt', sourceFile, false);

  const destinationFile = path.join(destinationDir, 'files-backup', 'document.txt');
  assert.equal(fs.readFileSync(destinationFile, 'utf8'), 'backup content');
  assert.equal(fs.existsSync(sourceFile), true);
  assert.equal(await existisBackupedLocalFile('files-backup', 'document.txt'), true);
});

test('removes the source file after a local persistence when cleanup is enabled', async (context) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
  context.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const sourceFile = path.join(workspace, 'source.txt');
  fs.writeFileSync(sourceFile, 'temporary content');
  process.env.BACKUP_DESTINATION_TYPE = 'local';
  process.env.LOCAL_BACKUP_PATH = path.join(workspace, 'destination');

  await persistFileToLocal('files-backup', 'source.txt', sourceFile, true);

  assert.equal(fs.existsSync(sourceFile), false);
});

test('uses the explicit file name provided to persistBackupFiles', async (context) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
  context.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const sourceFile = path.join(workspace, 'source', 'document.txt');
  const destinationDir = path.join(workspace, 'destination');
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.writeFileSync(sourceFile, 'backup content');
  process.env.BACKUP_DESTINATION_TYPE = 'local';
  process.env.LOCAL_BACKUP_PATH = destinationDir;

  await persistBackupFiles('files-backup', [{ fileName: 'nested/document.txt', sourcePath: sourceFile }], false);

  const destinationFile = path.join(destinationDir, 'files-backup', 'nested', 'document.txt');
  assert.equal(fs.existsSync(destinationFile), true);
  assert.equal(fs.readFileSync(destinationFile, 'utf8'), 'backup content');
});

test('requires a local path for the local destination', async () => {
  process.env.BACKUP_DESTINATION_TYPE = 'local';
  delete process.env.LOCAL_BACKUP_PATH;

  await assert.rejects(
    () => persistFileToLocal('files-backup', 'missing.txt', '/tmp/non-existent-file', false),
    /LOCAL_BACKUP_PATH is required when BACKUP_DESTINATION_TYPE=local/,
  );
});