import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import crypto from 'crypto'
import mime from 'mime-types'

const REGION = process.env.AWS_REGION
const BUCKET = process.env.AWS_S3_BUCKET

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


