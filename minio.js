const Minio = require('minio');

const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000'),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'admin',
    secretKey: process.env.MINIO_SECRET_KEY || 'admin123',
});

const SOURCE_BUCKET = process.env.SOURCE_BUCKET || 'bid-files';
const OCR_BUCKET = process.env.OCR_BUCKET || 'bid-ocr';

async function ensureBuckets() {
    for (const bucket of [SOURCE_BUCKET, OCR_BUCKET]) {
        const exists = await minioClient.bucketExists(bucket);
        if (!exists) {
            await minioClient.makeBucket(bucket);
            console.log(`[minio] Created bucket '${bucket}'`);
        } else {
            console.log(`[minio] Bucket '${bucket}' ready`);
        }
    }
}

function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

module.exports = { minioClient, SOURCE_BUCKET, OCR_BUCKET, ensureBuckets, streamToBuffer };
