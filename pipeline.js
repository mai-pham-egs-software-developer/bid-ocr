const { minioClient, SOURCE_BUCKET, OCR_BUCKET, streamToBuffer } = require('./minio');
const OcrRecord = require('./models/OcrRecord');
const Bid = require('./models/Bid');
const { parseBuffer, isSupported } = require('./parser');
const { pickC5File } = require('./c5finder');
const path = require('path');

async function listAllObjects(bucket, prefix = '') {
    return new Promise((resolve, reject) => {
        const objects = [];
        const stream = minioClient.listObjects(bucket, prefix, true);
        stream.on('data', obj => objects.push(obj));
        stream.on('end', () => resolve(objects));
        stream.on('error', reject);
    });
}

async function convertOne(key) {
    // Skip if already successfully processed
    const done = await OcrRecord.findOne({ objectKey: key, status: 'done' });
    if (done) return 'skipped';

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
        return 'processed';
    } catch (e) {
        record.status = 'error';
        record.error = e.message;
        await record.save();
        console.error(`[ocr] ✗ ${key}: ${e.message}`);
        return 'error';
    }
}

// Only OCRs the Chapter V (C5 — technical requirements) attachment of medical
// bids, instead of every attachment of every bid, since C5 is the only document
// the downstream AI stage actually reads.
async function scanAndConvert() {
    console.log('[ocr] Starting scan...');
    const medicalBids = await Bid.find({ isMedical: true, ocrStatus: { $ne: 'done' } }).select('notifyNo').lean();
    console.log(`[ocr] ${medicalBids.length} medical bids to check for Chapter V docs`);

    let processed = 0, skipped = 0, errors = 0, noC5 = 0;

    for (const bid of medicalBids) {
        if (!bid.notifyNo) continue;

        const objects = await listAllObjects(SOURCE_BUCKET, `${bid.notifyNo}/`);
        const supported = objects.filter(obj => isSupported(obj.name));
        if (!supported.length) continue;

        const c5Key = pickC5File(supported.map(o => o.name));
        if (!c5Key) {
            noC5++;
            continue;
        }

        const result = await convertOne(c5Key);
        if (result === 'processed') {
            processed++;
            await Bid.updateOne({ _id: bid._id }, { ocrStatus: 'done', $inc: { ocrAttempt: 1 } });
        } else if (result === 'skipped') {
            skipped++;
            await Bid.updateOne({ _id: bid._id }, { ocrStatus: 'done' });
        } else {
            errors++;
            await Bid.updateOne({ _id: bid._id }, { ocrStatus: 'error', $inc: { ocrAttempt: 1 } });
        }
    }

    const summary = { processed, skipped, errors, noC5, total: medicalBids.length };
    console.log(`[ocr] Done — processed: ${processed}, skipped: ${skipped}, errors: ${errors}, no_c5: ${noC5}`);
    return summary;
}

module.exports = { scanAndConvert };
