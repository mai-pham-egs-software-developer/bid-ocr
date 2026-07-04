const path = require('path');

const SUPPORTED_EXTS = new Set(['.pdf', '.doc', '.docx', '.xlsx', '.xls', '.zip', '.rar']);

function isSupported(filename) {
    return SUPPORTED_EXTS.has(path.extname(filename).toLowerCase());
}

async function parseBuffer(buffer, filename) {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
        case '.pdf':  return parsePdf(buffer, filename);
        case '.docx': return parseDocx(buffer, filename);
        case '.doc':  return parseDoc(buffer, filename);
        case '.xlsx':
        case '.xls':  return parseXlsx(buffer, filename);
        case '.zip':  return parseZip(buffer, filename);
        case '.rar':  return parseRar(buffer, filename);
        default:      return formatMd(filename, `[Unsupported file type: ${ext}]`);
    }
}

async function parsePdf(buffer, filename) {
    try {
        // Use lib path to avoid pdf-parse's startup test-file read
        const pdfParse = require('pdf-parse/lib/pdf-parse.js');
        const data = await pdfParse(buffer);
        return formatMd(filename, data.text);
    } catch (e) {
        return formatMd(filename, `[PDF parse error: ${e.message}]`);
    }
}

async function parseDocx(buffer, filename) {
    try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        return formatMd(filename, result.value);
    } catch (e) {
        return formatMd(filename, `[DOCX parse error: ${e.message}]`);
    }
}

async function parseDoc(buffer, filename) {
    try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        return formatMd(filename, result.value);
    } catch (e) {
        return formatMd(filename, `[DOC parse error: ${e.message}]`);
    }
}

async function parseXlsx(buffer, filename) {
    try {
        const XLSX = require('xlsx');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        let md = `# ${filename}\n\n`;
        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
            md += `## ${sheetName}\n\n`;
            if (rows.length === 0) continue;
            const headers = rows[0].map(String);
            md += '| ' + headers.join(' | ') + ' |\n';
            md += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
            for (let i = 1; i < rows.length; i++) {
                md += '| ' + rows[i].map(v => String(v).replace(/\|/g, '\\|')).join(' | ') + ' |\n';
            }
            md += '\n';
        }
        return md;
    } catch (e) {
        return formatMd(filename, `[XLSX parse error: ${e.message}]`);
    }
}

async function parseZip(buffer, filename) {
    try {
        const unzipper = require('unzipper');
        const directory = await unzipper.Open.buffer(buffer);
        let md = `# ${filename} (ZIP archive)\n\n`;
        for (const entry of directory.files) {
            if (entry.type !== 'File') continue;
            if (!isSupported(entry.path)) continue;
            try {
                const content = await entry.buffer();
                const innerMd = await parseBuffer(content, path.basename(entry.path));
                md += `---\n\n## ${entry.path}\n\n` + stripH1(innerMd) + '\n';
            } catch (e) {
                md += `---\n\n## ${entry.path}\n\n[Error reading entry: ${e.message}]\n\n`;
            }
        }
        return md;
    } catch (e) {
        return formatMd(filename, `[ZIP parse error: ${e.message}]`);
    }
}

async function parseRar(buffer, filename) {
    try {
        const { createExtractorFromData } = require('node-unrar-js');
        const extractor = await createExtractorFromData({ data: new Uint8Array(buffer) });
        const list = extractor.getFileList();
        const fileHeaders = [...list.fileHeaders];
        const extracted = extractor.extract({ files: fileHeaders.map(h => h.name) });
        const files = [...extracted.files];
        let md = `# ${filename} (RAR archive)\n\n`;
        for (const file of files) {
            if (file.fileHeader.flags.directory) continue;
            if (!isSupported(file.fileHeader.name)) continue;
            try {
                const content = Buffer.from(file.extraction);
                const innerMd = await parseBuffer(content, path.basename(file.fileHeader.name));
                md += `---\n\n## ${file.fileHeader.name}\n\n` + stripH1(innerMd) + '\n';
            } catch (e) {
                md += `---\n\n## ${file.fileHeader.name}\n\n[Error reading entry: ${e.message}]\n\n`;
            }
        }
        return md;
    } catch (e) {
        return formatMd(filename, `[RAR parse error: ${e.message}]`);
    }
}

function formatMd(filename, text) {
    return `# ${filename}\n\n${text.trim()}\n`;
}

// Remove the leading "# filename\n\n" when embedding inside a parent archive block
function stripH1(md) {
    return md.replace(/^# [^\n]+\n\n/, '');
}

module.exports = { parseBuffer, isSupported };
