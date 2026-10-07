
import { FileBackupSourceType } from '../utils/types';
import { backupFromListingUrl } from './listingurl.backup';
import { backupFromLocalDirectory } from './local.backup';
import { backupFromSupabaseBucket } from './supabase.backup';
import { backupFromZipUrl } from './zippedfile.backup';
import { getEnvironment } from '../utils/environment';


export const performFilesBackup = async () => {
  const source = getEnvironment().filesBackupSource;

  if (!source) {
    console.log('FILES_BACKUP_SOURCE is not set, files backup skipped.');
    return;
  }

  console.log(`Starting files backup with source: ${source}`);

  switch (source) {
    case 'local':
      return backupFromLocalDirectory();
    case 'listingUrl':
      return backupFromListingUrl();
    case 'zippedFile':
      return backupFromZipUrl();
    case 'supabase':
      return backupFromSupabaseBucket();
    case 'none':
      console.log('FILES_BACKUP_SOURCE is set to "none", files backup skipped.');
      return;
    default:
      throw new Error(`Unsupported FILES_BACKUP_SOURCE: ${source}`);
  }
}