import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import fs from 'fs';
import { getEnvironment } from './environment';

// Reused across calls so uploads share one HTTP connection pool instead of
// each opening/leaking its own sockets (was tripping Railway's ephemeral
// port warning when backing up many files in a loop).
let s3ClientInstance: S3Client | undefined;

// Create S3 client based on storage provider (AWS S3 or Cloudflare R2)
const createS3Client = () => {
  if (s3ClientInstance) {
    return s3ClientInstance;
  }

  const environment = getEnvironment();
  const storageProvider = environment.destinationType;

  if (storageProvider === 'local') {
    throw new Error('BACKUP_DESTINATION_TYPE must be aws or r2 when using object storage');
  }

  if (storageProvider === 'r2') {
    // Cloudflare R2 configuration
    const accountId = environment.r2AccountId;
    if (!accountId) {
      throw new Error('R2_ACCOUNT_ID is required when using Cloudflare R2');
    }

    s3ClientInstance = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: environment.r2AccessKeyId!,
        secretAccessKey: environment.r2SecretAccessKey!,
      },
    });
  } else {
    // AWS S3 configuration (default)
    s3ClientInstance = new S3Client({
      region: environment.awsS3Region,
      credentials: {
        accessKeyId: environment.awsAccessKeyId!,
        secretAccessKey: environment.awsSecretAccessKey!,
      },
    });
  }

  return s3ClientInstance;
};

export const fileExistsInS3 = async (folderPrefix: string, filename: string): Promise<boolean> => {
  const s3Client = createS3Client();
  const environment = getEnvironment();
  const storageProvider = environment.destinationType;
  if (storageProvider === 'local') {
    throw new Error('BACKUP_DESTINATION_TYPE must be aws or r2 when using object storage');
  }
  const bucketName = storageProvider === 'r2' ? environment.r2Bucket : environment.awsS3Bucket;

  try {
    const command = new ListObjectsV2Command({
      Bucket: bucketName!,
      Prefix: `${folderPrefix}/${filename}`,
    });
    
    const response = await s3Client.send(command);
    
    return (response.Contents && response.Contents.length > 0) || false;
  } catch (error) {
    console.error(`Error checking file existence in ${storageProvider.toUpperCase()}:`, error);
    return false; // Assume file does not exist on error
  }
}

// Upload a file to a specific folder in the bucket
export const uploadFileToS3 = async (filePath: string, folderPrefix: string, filename: string) => {
  const s3Client = createS3Client();
  const environment = getEnvironment();
  const storageProvider = environment.destinationType;
  if (storageProvider === 'local') {
    throw new Error('BACKUP_DESTINATION_TYPE must be aws or r2 when using object storage');
  }
  const bucketName = storageProvider === 'r2' ? environment.r2Bucket : environment.awsS3Bucket;

  const fileContent = fs.readFileSync(filePath);
  const s3Key = `${folderPrefix}/${filename}`;
  
  try {
    const command = new PutObjectCommand({
      Bucket: bucketName!,
      Key: s3Key,
      Body: fileContent,
      ContentType: 'application/octet-stream',
    });
    
    await s3Client.send(command);
  } catch (error) {
    console.error(`  ✗ Error uploading ${filename}:`, error);
    throw error;
  }
};