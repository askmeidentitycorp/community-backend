import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import crypto from 'crypto'
import mime from 'mime-types'

const REGION = process.env.AWS_REGION
const BUCKET = process.env.AWS_S3_BUCKET
const BUCKET2 = process.env.AWS_S3_BUCKET2 || 'bucket2'

const s3 = new S3Client({
    region: REGION || '',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
  });

function generateObjectKey(prefix = 'uploads/', originalName = '') {
  const ext = originalName && mime.extension(mime.lookup(originalName) || '') ? `.${mime.extension(mime.lookup(originalName))}` : ''
  const id = crypto.randomBytes(16).toString('hex')
  const date = new Date().toISOString().slice(0, 10)
  return `${prefix}${date}/${id}${ext}`
}

export async function uploadBufferToS3(buffer, { contentType, originalName, prefix } = {}) {
  if (!BUCKET || !REGION) {
    throw new Error('S3 not configured: set AWS_REGION and AWS_S3_BUCKET')
  }
  const Key = generateObjectKey(prefix, originalName)
  const put = new PutObjectCommand({
    Bucket: BUCKET,
    Key,
    Body: buffer,
    ContentType: contentType || mime.lookup(originalName || '') || 'application/octet-stream',
  })
  await s3.send(put)
  const urlBase = process.env.AWS_S3_PUBLIC_BASE_URL || `https://${BUCKET}.s3.${REGION}.amazonaws.com`
  return `${urlBase}/${Key}`
}

export async function uploadBufferToS3Bucket2(buffer, { contentType, originalName, prefix } = {}) {
  if (!BUCKET2 || !REGION) {
    throw new Error('S3 not configured: set AWS_REGION and AWS_S3_BUCKET2')
  }
  const Key = generateObjectKey(prefix, originalName)
  const put = new PutObjectCommand({
    Bucket: BUCKET2,
    Key,
    Body: buffer,
    ContentType: contentType || mime.lookup(originalName || '') || 'application/octet-stream',
  })
  await s3.send(put)
  const urlBase = process.env.AWS_S3_BUCKET2_PUBLIC_BASE_URL || `https://${BUCKET2}.s3.${REGION}.amazonaws.com`
  return `${urlBase}/${Key}`
}

// Upload and return structured storage info for metadata needs
export async function uploadBufferToS3Bucket2WithInfo(buffer, { contentType, originalName, prefix } = {}) {
  if (!BUCKET2 || !REGION) {
    throw new Error('S3 not configured: set AWS_REGION and AWS_S3_BUCKET2')
  }
  const Key = generateObjectKey(prefix, originalName)
  const put = new PutObjectCommand({
    Bucket: BUCKET2,
    Key,
    Body: buffer,
    ContentType: contentType || mime.lookup(originalName || '') || 'application/octet-stream',
  })
  await s3.send(put)
  const urlBase = process.env.AWS_S3_BUCKET2_PUBLIC_BASE_URL || `https://${BUCKET2}.s3.${REGION}.amazonaws.com`
  const url = `${urlBase}/${Key}`
  return { url, key: Key, bucket: BUCKET2, region: REGION }
}


