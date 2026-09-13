/**
 * AIOStreams Addon Ingestion & Stream Normalizer
 * Ingests streams from Torrentio, Comet, MediaFusion, DMM, Jackett, and direct debrid/P2P sources.
 * Extracts raw filename, size, seeders, and debrid flags without mangling or destroying source data.
 */

const { parseTorrentTitle } = require('./torrentParser');

/**
 * Normalizes an infoHash string (40 hex chars or 32 base32 chars)
 */
function normalizeInfoHash(str) {
    if (!str || typeof str !== 'string') return null;
    const magnetMatch = str.match(/xt=urn:btih:([a-zA-Z0-9]{32,40})/i);
    if (magnetMatch) {
        return magnetMatch[1].toLowerCase();
    }
    if (/^[a-fA-F0-9]{40}$/.test(str) || /^[a-zA-Z2-7]{32}$/.test(str)) {
        return str.toLowerCase();
    }
    return null;
}

/**
 * Parses human-readable size string (e.g., "4.5 GB", "850 MB", "1.2 TB") to bytes
 */
function parseSizeToBytes(sizeStr) {
    if (!sizeStr || typeof sizeStr !== 'string') return null;
    const match = sizeStr.match(/(\d+(?:[.,]\d+)?)\s*(GB|MB|GiB|MiB|TB|TiB|KB|KiB)\b/i);
    if (!match) return null;
    const num = parseFloat(match[1].replace(',', '.'));
    if (isNaN(num) || num <= 0) return null;
    const unit = match[2].toUpperCase();
    if (unit.startsWith('T')) return Math.round(num * 1024 * 1024 * 1024 * 1024);
    if (unit.startsWith('G')) return Math.round(num * 1024 * 1024 * 1024);
    if (unit.startsWith('M')) return Math.round(num * 1024 * 1024);
    if (unit.startsWith('K')) return Math.round(num * 1024);
    return null;
}

/**
 * Formats bytes to standard human-readable size string (e.g., "4.50 GB" or "850 MB")
 */
function formatBytesToSize(bytes) {
    if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) return null;
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 0.9) {
        return `${gb.toFixed(2)} GB`;
    }
    const mb = bytes / (1024 * 1024);
    return `${Math.round(mb)} MB`;
}

/**
 * Cleans provider name from Stremio name line
 */
function extractCleanProvider(rawName) {
    if (!rawName) return 'Stream';
    let clean = String(rawName).split('\n')[0].replace(/[🟢🟡🔴🧲⚡]/g, '').trim();
    // Strip debrid prefixes like "[RD+]" or "[TB+]"
    clean = clean.replace(/\[\s*(?:rd|ad|tb|pm|p2p)\+?\s*\]/gi, '').trim();
    if (clean.includes('•')) {
        const parts = clean.split('•');
        clean = parts[0].trim();
    }
    if (clean.includes('|')) {
        clean = clean.split('|')[0].trim();
    }
    return clean || 'Stream';
}

/**
 * Ingests and normalizes any stream into a standard AIOStreams Normalized Stream representation.
 * @param {object} stream - Original Stremio stream
 * @param {object} config - User / Addon configuration
 * @returns {object} Normalized stream object
 */
function ingestStream(stream, config = {}) {
    if (!stream || typeof stream !== 'object') return null;

    const rawName = String(stream.name || '');
    const rawTitle = String(stream.title || stream.description || stream.quality || '');
    const behaviorFilename = stream.behaviorHints && typeof stream.behaviorHints.filename === 'string'
        ? stream.behaviorHints.filename.trim()
        : null;

    // 1. Separate filename lines from stats/indexer lines (Torrentio & Comet multi-line format)
    const titleLines = rawTitle.split('\n').map(l => l.trim()).filter(Boolean);
    let candidateFilename = behaviorFilename;
    let statsLine = '';

    for (const line of titleLines) {
        // Line containing size or seeders emoji or indexer
        if (/(?:💾|👤|👥|🌱|⚙️|🌐|\[\s*\d+\s*(?:GB|MB|GiB|MiB)\s*\])/i.test(line)) {
            statsLine += ` ${line}`;
        } else if (!candidateFilename && line.length > 5) {
            candidateFilename = line;
        }
    }

    if (!candidateFilename) {
        candidateFilename = titleLines[0] || rawName.split('\n')[0] || 'Stream';
    }

    // 2. Extract real file size (Bytes & Formatted)
    let sizeBytes = null;
    if (stream.behaviorHints && typeof stream.behaviorHints.videoSize === 'number' && stream.behaviorHints.videoSize > 0) {
        sizeBytes = stream.behaviorHints.videoSize;
    } else if (typeof stream.fileSize === 'number' && stream.fileSize > 0) {
        sizeBytes = stream.fileSize;
    } else if (typeof stream.size === 'number' && stream.size > 0) {
        sizeBytes = stream.size;
    } else {
        const sizeStrCandidate = `${statsLine} ${rawTitle} ${rawName}`;
        sizeBytes = parseSizeToBytes(sizeStrCandidate);
    }
    const sizeFormatted = sizeBytes ? formatBytesToSize(sizeBytes) : null;

    // 3. Extract seeders & peers
    let seeders = null;
    if (typeof stream.seeders === 'number' && stream.seeders >= 0) {
        seeders = stream.seeders;
    } else if (typeof stream.seeds === 'number' && stream.seeds >= 0) {
        seeders = stream.seeds;
    } else if (typeof stream.peerCount === 'number' && stream.peerCount >= 0) {
        seeders = stream.peerCount;
    } else {
        const textForSeeds = `${statsLine} ${rawTitle} ${rawName}`;
        const seedMatch = textForSeeds.match(/(?:👤|👥|🌱|\bseeds?[:\s]*|\bseeders?[:\s]*|\bs:)\s*(\d+)/i)
            || textForSeeds.match(/\[\s*(\d+)\s*\/\s*\d+\s*\]/);
        if (seedMatch) {
            seeders = parseInt(seedMatch[1], 10);
        }
    }

    // 4. Extract InfoHash & P2P / Debrid status
    const infoHash = stream.infoHash 
        ? normalizeInfoHash(stream.infoHash) 
        : (stream.url ? normalizeInfoHash(stream.url) : null);

    const isP2P = Boolean(
        infoHash || 
        (stream.url && stream.url.startsWith('magnet:')) ||
        /\b\[?p2p\]?/i.test(rawName) ||
        /\b\[?p2p\]?/i.test(rawTitle)
    );

    let isDebridCached = Boolean(stream.isDebridCached);
    if (!isDebridCached) {
        if (/\[\s*(?:rd|ad|tb|pm)\+\s*\]|instant|cached/i.test(rawName) || /\[\s*(?:rd|ad|tb|pm)\+\s*\]|instant|cached/i.test(rawTitle)) {
            isDebridCached = true;
        }
    }

    // 5. Parse release metadata using AIOStreams torrentParser
    // Parse using candidate filename first, then enrich with full title and name text to capture multi-line metadata (e.g. Dolby Atmos, DDP 5.1, DV)
    const parsed = parseTorrentTitle(candidateFilename);
    const combinedText = `${candidateFilename} ${rawTitle} ${rawName}`;
    const fullParsed = parseTorrentTitle(combinedText);

    if (!parsed.resolution && fullParsed.resolution) parsed.resolution = fullParsed.resolution;
    if (!parsed.quality && fullParsed.quality) parsed.quality = fullParsed.quality;
    if ((!parsed.hdr || parsed.hdr.length === 0) && fullParsed.hdr && fullParsed.hdr.length > 0) parsed.hdr = fullParsed.hdr;
    if (!parsed.dvProfile && fullParsed.dvProfile) parsed.dvProfile = fullParsed.dvProfile;
    if (!parsed.codec && fullParsed.codec) parsed.codec = fullParsed.codec;
    if ((!parsed.audio || parsed.audio.length === 0) && fullParsed.audio && fullParsed.audio.length > 0) parsed.audio = fullParsed.audio;
    if (!parsed.channels && fullParsed.channels) parsed.channels = fullParsed.channels;
    if ((!parsed.languages || parsed.languages.length === 0) && fullParsed.languages && fullParsed.languages.length > 0) {
        parsed.languages = fullParsed.languages;
        parsed.languageFlags = fullParsed.languageFlags;
        parsed.isMultiAudio = fullParsed.isMultiAudio;
        parsed.isDualAudio = fullParsed.isDualAudio;
    }
    if ((!parsed.special || parsed.special.length === 0) && fullParsed.special && fullParsed.special.length > 0) {
        parsed.special = fullParsed.special;
    }
    if (!parsed.bitDepth && fullParsed.bitDepth) parsed.bitDepth = fullParsed.bitDepth;
    if (!parsed.releaseGroup && fullParsed.releaseGroup) parsed.releaseGroup = fullParsed.releaseGroup;

    // 6. Clean provider label
    const originalProvider = stream.originalProvider || stream.provider || extractCleanProvider(rawName);

    return {
        originalStream: stream,
        rawFilename: candidateFilename,
        parsed: parsed,
        sizeBytes: sizeBytes,
        sizeFormatted: sizeFormatted,
        seeders: seeders,
        infoHash: infoHash,
        isP2P: isP2P,
        isDebridCached: isDebridCached,
        originalProvider: originalProvider,
        providers: stream.providers && Array.isArray(stream.providers) ? stream.providers : [originalProvider],
        behaviorHints: {
            ...(stream.behaviorHints || {}),
            filename: behaviorFilename || candidateFilename
        }
    };
}

module.exports = {
    ingestStream,
    normalizeInfoHash,
    parseSizeToBytes,
    formatBytesToSize,
    extractCleanProvider
};
