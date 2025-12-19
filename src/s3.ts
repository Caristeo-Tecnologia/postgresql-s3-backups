import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { promisify } from 'util';
import cron from 'node-cron';

// Create S3 client based on storage provider (AWS S3 or Cloudflare R2)
const createS3Client = () => {
  const storageProvider = process.env.STORAGE_PROVIDER || 'aws';
  
  if (storageProvider.toLowerCase() === 'r2') {
    // Cloudflare R2 configuration
    const accountId = process.env.R2_ACCOUNT_ID;
    if (!accountId) {
      throw new Error('R2_ACCOUNT_ID is required when using Cloudflare R2');
    }
    
    return new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  } else {
    // AWS S3 configuration (default)
    return new S3Client({
      region: process.env.AWS_S3_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }
};

// Upload backup to S3 or R2
export const uploadToS3 = async (filePath: string, filename: string) => {
  const s3Client = createS3Client();
  const storageProvider = process.env.STORAGE_PROVIDER || 'aws';
  const bucketName = storageProvider.toLowerCase() === 'r2' 
    ? process.env.R2_BUCKET 
    : process.env.AWS_S3_BUCKET;

  const fileContent = fs.readFileSync(filePath);
  
  console.log(`Uploading backup to ${storageProvider.toUpperCase()} bucket ${bucketName}...`);
  
  try {
    const command = new PutObjectCommand({
      Bucket: bucketName!,
      Key: filename,
      Body: fileContent,
      ContentType: 'application/octet-stream',
    });
    
    await s3Client.send(command);
    console.log(`Backup uploaded to ${storageProvider.toUpperCase()}: ${filename}`);
  } catch (error) {
    console.error(`Error uploading to ${storageProvider.toUpperCase()}:`, error);
    throw error;
  }
};
