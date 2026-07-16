import axios from "axios";
import fs from "fs";
import path from "path";
import { FileInfo } from "../utils/types";
import { backupAlreadyExists, persistBackupFiles } from "../destination/destination";
import { getEnvironment } from '../utils/environment';

export const backupFromListingUrl = async () => {
  const listingUrl = getEnvironment().filesBackupListingUrl;

  if (!listingUrl) {
    throw new Error('FILES_BACKUP_LISTING_URL is required when FILES_BACKUP_SOURCE=listingUrl');
  }
  const tempDir = path.join(__dirname, '../temp');

  const response = await axios.get(listingUrl, { timeout: 30000 });
  const files: FileInfo[] = response.data;

  if (!Array.isArray(files)) {
    throw new Error('Response from FILES_BACKUP_LISTING_URL must be a JSON array');
  }

  console.log(`Found ${files.length} files in listing`);

  const timestamp = Date.now();
  const extractDir = path.join(tempDir, `temp-files-listing-${timestamp}`);
  fs.mkdirSync(extractDir, { recursive: true });

  const MAX_CONCURRENT_DOWNLOADS = 10;
  let downloadedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const startDownloadTime = Date.now();

  console.log(`Downloading files (max ${MAX_CONCURRENT_DOWNLOADS} concurrent)...`);

  const allResults: { status: 'downloaded' | 'skipped' | 'failed'; fileName?: string; filePath?: string }[] = [];

  for (let i = 0; i < files.length; i += MAX_CONCURRENT_DOWNLOADS) {
    const batch = files.slice(i, i + MAX_CONCURRENT_DOWNLOADS);

    const downloadPromises = batch.map(async (file, batchIndex) => {
      const fileIndex = i + batchIndex;
      const progress = ((fileIndex + 1) / files.length * 100).toFixed(1);

      if (!file.fileName || !file.url) {
        console.warn(`  [${fileIndex + 1}/${files.length}] (${progress}%) ⚠ Skipping invalid file entry (missing fileName or url)`);
        return { status: 'failed' as const };
      }

      const normalizedFileName = file.fileName.replace(/^\/+/, '').split(/[/\\]/).join('/');
      const destinationExists = await backupAlreadyExists("files-backup", normalizedFileName);

      if (destinationExists) {
        console.log(`  [${fileIndex + 1}/${files.length}] (${progress}%) ⊘ Skipped (already exists in backup): ${normalizedFileName}`);
        return { status: 'skipped' as const };
      }

      try {
        console.log(`Starting download: ${file.fileName} (${(file.size / (1024 * 1024)).toFixed(2)} MB) [${fileIndex + 1}/${files.length}] (${progress}%)`);

        const fileResponse = await axios.get(file.url, {
          responseType: 'stream',
          timeout: 300000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        });

        const filePath = path.join(extractDir, normalizedFileName);
        const fileDir = path.dirname(filePath);

        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }

        const writer = fs.createWriteStream(filePath);

        await new Promise<void>((resolve, reject) => {
          fileResponse.data.pipe(writer);
          writer.on('finish', () => resolve());
          writer.on('error', (err) => {
            fs.unlink(filePath, () => {});
            reject(err);
          });
          fileResponse.data.on('error', (err: any) => {
            writer.close();
            fs.unlink(filePath, () => {});
            reject(err);
          });
        });

        console.log(`  [${fileIndex + 1}/${files.length}] (${progress}%) ✓ Downloaded: ${normalizedFileName} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
        return { status: 'downloaded' as const, fileName: normalizedFileName, filePath };
      } catch (error) {
        console.error(`  [${fileIndex + 1}/${files.length}] (${progress}%) ✗ Failed: ${normalizedFileName}`, error instanceof Error ? error.message : error);
        return { status: 'failed' as const };
      }
    });

    const results = await Promise.all(downloadPromises);
    downloadedCount += results.filter(r => r.status === 'downloaded').length;
    skippedCount += results.filter(r => r.status === 'skipped').length;
    failedCount += results.filter(r => r.status === 'failed').length;
    allResults.push(...results);
  }

  const totalDownloadTime = ((Date.now() - startDownloadTime) / 1000).toFixed(2);
  console.log(`\nDownload phase completed in ${totalDownloadTime}s:`);
  console.log(`  - ${downloadedCount} files downloaded successfully`);
  console.log(`  - ${skippedCount} files skipped (already in backup destination)`);
  console.log(`  - ${failedCount} files failed`);

  await persistBackupFiles(
    "files-backup",
    allResults
      .filter((r) => r.status === 'downloaded' && r.fileName && r.filePath)
      .map((r) => ({ fileName: r.fileName!, sourcePath: r.filePath! })),
    true,
  );
};