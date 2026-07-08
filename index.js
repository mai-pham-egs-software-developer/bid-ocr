require('dotenv').config();

const path = require('path');
const express = require('express');
const { connectMongo } = require('./mongo');
const { minioClient, OCR_BUCKET, ensureBuckets, streamToBuffer } = require('./minio');
const { scanAndConvert } = require('./pipeline');
const OcrRecord = require('./models/OcrRecord');

const app = express();
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const PORT      = process.env.PORT      || 3001;
const BASE_PATH = process.env.BASE_PATH || '';

// ── Admin UI ──────────────────────────────────────────────────────
app.get('/', async (req, res) => {
    try {
        const [total, done, error, pending] = await Promise.all([
            OcrRecord.countDocuments(),
            OcrRecord.countDocuments({ status: 'done' }),
            OcrRecord.countDocuments({ status: 'error' }),
            OcrRecord.countDocuments({ status: 'pending' }),
        ]);
        res.render('index', { stats: { total, done, error, pending }, basePath: BASE_PATH });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// ── API ───────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => res.json({ status: 'ok' }));

app.get('/api/stats', async (req, res) => {
    try {
        const [total, done, error, pending] = await Promise.all([
            OcrRecord.countDocuments(),
            OcrRecord.countDocuments({ status: 'done' }),
            OcrRecord.countDocuments({ status: 'error' }),
            OcrRecord.countDocuments({ status: 'pending' }),
        ]);
        res.json({ total, done, error, pending });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Manual/orchestrated trigger — runs synchronously and returns the result summary
app.post('/api/run', async (req, res) => {
    try {
        const summary = await scanAndConvert();
        res.json(summary);
    } catch (e) {
        console.error('[ocr] Run error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// List records with optional filtering + search
app.get('/api/records', async (req, res) => {
    try {
        const { status, q, page = 1, limit = 50 } = req.query;
        const filter = {};
        if (status) filter.status = status;
        if (q) filter.objectKey = { $regex: q, $options: 'i' };
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [records, total] = await Promise.all([
            OcrRecord.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(parseInt(limit)),
            OcrRecord.countDocuments(filter),
        ]);
        res.json({ records, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Fetch the converted markdown content from MinIO
app.get('/api/records/:id/content', async (req, res) => {
    try {
        const record = await OcrRecord.findById(req.params.id);
        if (!record) return res.status(404).json({ error: 'Record not found' });
        if (!record.targetKey) return res.status(404).json({ error: 'No output file yet' });
        const stream = await minioClient.getObject(OCR_BUCKET, record.targetKey);
        const buffer = await streamToBuffer(stream);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(buffer.toString('utf-8'));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Delete a record so the file gets reprocessed on next run
app.delete('/api/records/:id', async (req, res) => {
    try {
        await OcrRecord.findByIdAndDelete(req.params.id);
        res.json({ message: 'deleted' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Reset all errored records so they retry on next run
app.post('/api/retry-errors', async (req, res) => {
    try {
        const result = await OcrRecord.deleteMany({ status: 'error' });
        res.json({ deleted: result.deletedCount });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

async function start() {
    await connectMongo();
    await ensureBuckets();

    app.listen(PORT, () => {
        console.log(`[ocr] Server running on port ${PORT}`);
    });
}

start().catch(e => {
    console.error('[ocr] Startup failed:', e.message);
    process.exit(1);
});
