import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { promisify } from 'util';
import cron from 'node-cron';



// Upload backup to S3
export const uploadToS3 = async (filePath: string, filename: string) => {
  const s3Client = new S3Client({
    region: process.env.AWS_S3_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  const fileContent = fs.readFileSync(filePath);
  
  console.log(`Uploading backup to S3 bucket ${process.env.AWS_S3_BUCKET}...`);
  
  try {
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: filename,
      Body: fileContent,
      ContentType: 'application/octet-stream',
    });
    
    await s3Client.send(command);
    console.log(`Backup uploaded to S3: ${filename}`);
  } catch (error) {
    console.error('Error uploading to S3:', error);
    throw error;
  }
};
