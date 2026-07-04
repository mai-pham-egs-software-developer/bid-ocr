const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    objectKey: { type: String, required: true, unique: true },
    sourceBucket: String,
    targetKey: String,
    status: { type: String, enum: ['pending', 'done', 'error'], default: 'pending' },
    error: String,
    processedAt: Date,
}, { timestamps: true });

module.exports = mongoose.model('OcrRecord', schema);
