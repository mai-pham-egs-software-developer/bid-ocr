const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema({
    notifyNo: String,
    isMedical: Boolean,
    ocrStatus: { type: String, enum: ['none', 'done', 'error'], default: 'none' },
    ocrAttempt: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.models.Bid || mongoose.model('Bid', bidSchema);
