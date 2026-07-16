import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { backupAlreadyExists, persistBackupFiles } from '../destination/destination';
import { getEnvironment } from '../utils/environment';

interface SupabaseStorageItem {
  name: string;
  id?: string | null;
}

interface SupabaseBucketItem {
  name: string;
}

const getSupabaseConfig = () => {
  const environment = getEnvironment();
  const url = environment.supabaseUrl?.replace(/\/$/, '');
  const serviceRoleKey = environment.supabaseServiceRoleKey;

  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when FILES_BACKUP_SOURCE=supabase');
  }

  return { url, serviceRoleKey };
};

export const getSupabaseBucketsToBackup = async (): Promise<string[]> => {
  const environment = getEnvironment();
  const configuredBucket = environment.supabaseBucket?.trim();

  if (configuredBucket) {
    return [configuredBucket];
  }

  const { url, serviceRoleKey } = getSupabaseConfig();
  const response = await axios.get<SupabaseBucketItem[] | string[]>(`${url}/storage/v1/bucket`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    timeout: 30000,
  });

  return response.data.map((bucket) => typeof bucket === 'string' ? bucket : bucket.name);
};

const listSupabaseFiles = async (bucket: string, prefix: string): Promise<string[]> => {
  const { url, serviceRoleKey } = getSupabaseConfig();
  const response = await axios.post<SupabaseStorageItem[]>(`${url}/storage/v1/object/list/${bucket}`, {
    prefix,
    limit: 1000,
    offset: 0,
  }, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    timeout: 30000,
  });

  const files: string[] = [];
  for (const item of response.data) {
    const itemPath = prefix ? `${prefix}/${item.name}` : item.name;

    if (item.id === null) {
      files.push(...await listSupabaseFiles(bucket, itemPath));
    } else {
      files.push(itemPath);
    }
  }

  return files;
};

export const backupFromSupabaseBucket = async () => {
  const { url, serviceRoleKey } = getSupabaseConfig();
  const buckets = await getSupabaseBucketsToBackup();
  const sourcePrefix = getEnvironment().filesBackupSupabasePrefix?.replace(/^\/+|\/+$/g, '') || '';

  console.log(`Starting Supabase files backup for prefix: ${sourcePrefix || '(root)'}`);
  console.log(`Found ${buckets.length} Supabase bucket(s) to backup`);
  const tempDir = path.join(process.cwd(), 'backups', 'files', `supabase-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const downloadedFiles: { fileName: string; sourcePath: string }[] = [];

  for (const bucket of buckets) {
    console.log(`Backing up bucket: ${bucket}`);
    const remoteFiles = await listSupabaseFiles(bucket, sourcePrefix);

    for (const remoteFile of remoteFiles) {
      const relativePath = sourcePrefix ? remoteFile.slice(sourcePrefix.length).replace(/^\//, '') : remoteFile;
      const backupRelativePath = path.posix.join(bucket, relativePath);

      if (!backupRelativePath || await backupAlreadyExists('files-backup', backupRelativePath)) {
        console.log(`Skipped (already exists in backup): ${backupRelativePath}`);
        continue;
      }

      const localFilePath = path.join(tempDir, backupRelativePath);
      fs.mkdirSync(path.dirname(localFilePath), { recursive: true });

      const response = await axios.get(`${url}/storage/v1/object/${bucket}/${encodeURIComponent(remoteFile)}`, {
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
        responseType: 'arraybuffer',
        timeout: 300000,
      });

      fs.writeFileSync(localFilePath, response.data);
      downloadedFiles.push({ fileName: backupRelativePath, sourcePath: localFilePath });
    }
  }

  await persistBackupFiles('files-backup', downloadedFiles, false);
  fs.rmSync(tempDir, { recursive: true, force: true });
};