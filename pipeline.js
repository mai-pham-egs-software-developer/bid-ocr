const { minioClient, SOURCE_BUCKET, OCR_BUCKET, streamToBuffer } = require('./minio');
const OcrRecord = require('./models/OcrRecord');
const { parseBuffer, isSupported } = require('./parser');
const path = require('path');

async function listAllObjects(bucket) {
    return new Promise((resolve, reject) => {
        const objects = [];
        const stream = minioClient.listObjects(bucket, '', true);
        stream.on('data', obj => objects.push(obj));
        stream.on('end', () => resolve(objects));
        stream.on('error', reject);
    });
}

async function scanAndConvert() {
    console.log('[ocr] Starting scan...');
    const objects = await listAllObjects(SOURCE_BUCKET);
    const supported = objects.filter(obj => isSupported(obj.name));
    console.log(`[ocr] ${objects.length} total objects, ${supported.length} supported for conversion`);

    let processed = 0, skipped = 0, errors = 0;

    for (const obj of supported) {
        const key = obj.name;

        // Skip if already successfully processed
        const done = await OcrRecord.findOne({ objectKey: key, status: 'done' });
        if (done) {
            skipped++;
            continue;
        }

        // Mark as in-progress (upsert: creates new or resets errored record)
        const record = await OcrRecord.findOneAndUpdate(
            { objectKey: key },
            { status: 'pending', sourceBucket: SOURCE_BUCKET, $unset: { error: '' } },
            { upsert: true, new: true }
        );

        try {
            const fileStream = await minioClient.getObject(SOURCE_BUCKET, key);
            const buffer = await streamToBuffer(fileStream);

            const md = await parseBuffer(buffer, path.basename(key));

            const targetKey = key.replace(/\.[^/.]+$/, '.md');
            const mdBuffer = Buffer.from(md, 'utf-8');
            await minioClient.putObject(OCR_BUCKET, targetKey, mdBuffer, mdBuffer.length, {
                'Content-Type': 'text/markdown; charset=utf-8',
            });

            record.status = 'done';
            record.targetKey = targetKey;
            record.processedAt = new Date();
            await record.save();

            console.log(`[ocr] ✓ ${key} → ${targetKey}`);
            processed++;
        } catch (e) {
            record.status = 'error';
            record.error = e.message;
            await record.save();
            console.error(`[ocr] ✗ ${key}: ${e.message}`);
            errors++;
        }
    }

    const summary = { processed, skipped, errors, total: supported.length };
    console.log(`[ocr] Done — processed: ${processed}, skipped: ${skipped}, errors: ${errors}`);
    return summary;
}

module.exports = { scanAndConvert };
