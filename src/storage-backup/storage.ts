
import { FileBackupSourceType } from '../utils/types';
import { backupFromListingUrl } from './listingurl.backup';
import { backupFromLocalDirectory } from './local.backup';
import { backupFromSupabaseBucket } from './supabase.backup';
import { backupFromZipUrl } from './zippedfile.backup';
import { getEnvironment } from '../utils/environment';


export const performFilesBackup = async () => {
  try {
    const source = getEnvironment().filesBackupSource;

    if (!source) {
      console.log('FILES_BACKUP_SOURCE is not set, files backup skipped.');
      return;
    }

    console.log(`Starting files backup with source: ${source}`);

    switch (source) {
      case 'local':
        await backupFromLocalDirectory();
        return;
      case 'listingUrl':
        await backupFromListingUrl();
        return;
      case 'zippedFile':
        await backupFromZipUrl();
        return;
      case 'supabase':
        await backupFromSupabaseBucket();
        return;
      default:
        throw new Error(`Unsupported FILES_BACKUP_SOURCE: ${source}`);
    }
  } catch (error) {
    console.error('Error performing files backup:', error);
    process.exit(1);
  }
}