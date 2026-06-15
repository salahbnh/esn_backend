import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config/env.js';

/**
 * S3 client configured for MinIO. forcePathStyle is required for MinIO.
 */
export const s3 = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
  },
});

const BUCKET = config.S3_BUCKET;

export interface PutObjectInput {
  key: string;
  body: Uint8Array | Buffer | string;
  contentType: string;
}

export async function putObject({ key, body, contentType }: PutObjectInput): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * Presigned GET URL scoped to a single object with a short expiry.
 * Authorization (role + ownership) MUST be checked before issuing one.
 */
export async function getPresignedGetUrl(key: string, expiresSec = 300): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: expiresSec,
  });
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/**
 * Build a server-controlled storage key. Sanitizes the client filename
 * (strips path separators / traversal) and prefixes a cuid so keys are
 * unique and never trust client-supplied paths.
 */
export function buildStorageKey(entityType: string, entityId: string, filename: string): string {
  const safeName = sanitizeFilename(filename);
  const prefix = randomUUID();
  return `${entityType.toLowerCase()}/${entityId}/${prefix}-${safeName}`;
}

function sanitizeFilename(filename: string): string {
  // Strip any directory components and disallowed characters.
  const base = filename.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned.slice(0, 200) : `file-${randomUUID()}`;
}
