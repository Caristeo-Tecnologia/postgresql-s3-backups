import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { getSupabaseBucketsToBackup } from '../src/storage-backup/supabase.backup';

const originalEnvironment = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_BUCKET: process.env.SUPABASE_BUCKET,
};

test.afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test('lists all Supabase buckets when no specific bucket is configured', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  delete process.env.SUPABASE_BUCKET;

  const originalGet = axios.get;
  let requestedUrl: string | undefined;

  axios.get = (async (url: string) => {
    requestedUrl = url;

    return {
      data: [{ name: 'bucket-a' }, { name: 'bucket-b' }],
    };
  }) as typeof axios.get;

  try {
    const buckets = await getSupabaseBucketsToBackup();

    assert.deepEqual(buckets, ['bucket-a', 'bucket-b']);
    assert.equal(requestedUrl, 'https://example.supabase.co/storage/v1/bucket');
  } finally {
    axios.get = originalGet;
  }
});
