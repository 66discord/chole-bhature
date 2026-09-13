/**
 * AIOStreams-Standard Torrent & Release Title Parser Engine
 * Modeled after @viren070/parse-torrent-title and AIOStreams core parser.
 * Provides high-speed, deterministic metadata extraction from torrent/release filenames.
 */

// LRU/Map memoization cache (up to 10,000 entries)
const parseCache = new Map();
const MAX_CACHE_SIZE = 10000;

// Language definitions with standard codes, display names, and flag emojis
const LANGUAGE_DEFINITIONS = [
    { name: 'Hindi', regex: /(?:\bhindi\b|(?:^|[\. _\[\(\-,+/])hin(?:[\. _\]\)\-,+/]|$))/i, flag: '🇮🇳' },
    { name: 'Tamil', regex: /(?:\btamil\b|(?:^|[\. _\[\(\-,+/])tam(?:[\. _\]\)\-,+/]|$))/i, flag: '🇮🇳' },
    { name: 'Telugu', regex: /(?:\btelugu\b|(?:^|[\. _\[\(\-,+/])tel(?:[\. _\]\)\-,+/]|$))/i, flag: '🇮🇳' },
    { name: 'Malayalam', regex: /(?:\bmalayalam\b|(?:^|[\. _\[\(\-,+/])mal(?:[\. _\]\)\-,+/]|$))/i, flag: '🇮🇳' },
    { name: 'Kannada', regex: /(?:\bkannada\b|(?:^|[\. _\[\(\-,+/])kan(?:[\. _\]\)\-,+/]|$))/i, flag: '🇮🇳' },
    { name: 'Bengali', regex: /(?:\bbengali\b|\bbangla\b|(?:^|[\. _\[\(\-,+/])ben(?:[\. _\]\)\-,+/]|$))/i, flag: '🇮🇳' },
    { name: 'Punjabi', regex: /(?:\bpunjabi\b|(?:^|[\. _\[\(\-,+/])pun(?:[\. _\]\)\-,+/]|$))/i, flag: '🇮🇳' },
    { name: 'Marathi', regex: /(?:\bmarathi\b|(?:^|[\. _\[\(\-,+/])mar(?:[\. _\]\)\-,+/]|$))/i, flag: '🇮🇳' },
    { name: 'English', regex: /(?:\benglish\b|(?:^|[\. _\[\(\-,+/])eng(?:[\. _\]\)\-,+/]|$))/i, flag: '🇬🇧' },
    { name: 'Japanese', regex: /(?:\bjapanese\b|\bjap\b|(?:^|[\. _\[\(\-,+/])jpn(?:[\. _\]\)\-,+/]|$))/i, flag: '🇯🇵' },
    { name: 'Korean', regex: /(?:\bkorean\b|(?:^|[\. _\[\(\-,+/])kor(?:[\. _\]\)\-,+/]|$))/i, flag: '🇰🇷' },
    { name: 'Spanish', regex: /(?:\bspanish\b|\bespanol\b|\bcastellano\b|\blatino\b|(?:^|[\. _\[\(\-,+/])esp(?:[\. _\]\)\-,+/]|$))/i, flag: '🇪🇸' },
    { name: 'French', regex: /(?:\bfrench\b|\bfrancais\b|\bvff\b|\bvfq\b|(?:^|[\. _\[\(\-,+/])(?:fre|fra)(?:[\. _\]\)\-,+/]|$))/i, flag: '🇫🇷' },
    { name: 'German', regex: /(?:\bgerman\b|\bdeutsch\b|(?:^|[\. _\[\(\-,+/])(?:ger|deu)(?:[\. _\]\)\-,+/]|$))/i, flag: '🇩🇪' },
    { name: 'Italian', regex: /(?:\bitalian\b|\bitaliano\b|(?:^|[\. _\[\(\-,+/])ita(?:[\. _\]\)\-,+/]|$))/i, flag: '🇮🇹' },
    { name: 'Portuguese', regex: /(?:\bportuguese\b|\bportugues\b|(?:^|[\. _\[\(\-,+/])por(?:[\. _\]\)\-,+/]|$))/i, flag: '🇵🇹' },
    { name: 'Russian', regex: /(?:\brussian\b|(?:^|[\. _\[\(\-,+/])rus(?:[\. _\]\)\-,+/]|$))/i, flag: '🇷🇺' },
    { name: 'Chinese', regex: /(?:\bchinese\b|\bmandarin\b|\bcantonese\b|(?:^|[\. _\[\(\-,+/])(?:chi|zho)(?:[\. _\]\)\-,+/]|$))/i, flag: '🇨🇳' },
    { name: 'Arabic', regex: /(?:\barabic\b|(?:^|[\. _\[\(\-,+/])ara(?:[\. _\]\)\-,+/]|$))/i, flag: '🇦🇪' },
    { name: 'Turkish', regex: /(?:\bturkish\b|(?:^|[\. _\[\(\-,+/])tur(?:[\. _\]\)\-,+/]|$))/i, flag: '🇹🇷' }
];

// Edition tags
const EDITION_DEFINITIONS = [
    { name: 'Director\'s Cut', regex: /\b(?:director'?s[\s._-]?cut|dc)\b/i },
    { name: 'Extended', regex: /\b(?:extended[\s._-]?cut|extended|ext)\b/i },
    { name: 'Theatrical', regex: /\b(?:theatrical[\s._-]?cut|theatrical)\b/i },
    { name: 'Unrated', regex: /\b(?:unrated|uncensored)\b/i },
    { name: 'Remastered', regex: /\b(?:remastered|remaster)\b/i },
    { name: 'Criterion', regex: /\b(?:criterion[\s._-]?(?:collection)?)\b/i },
    { name: 'Special Edition', regex: /\b(?:special[\s._-]?edition|se)\b/i }
];

/**
 * Strips release domain prefixes/suffixes and noise (e.g., www.torrentsite.com - )
 */
function cleanReleaseNoise(title) {
    if (!title || typeof title !== 'string') return '';
    let cleaned = title.trim();

    // Strip common file extensions
    cleaned = cleaned.replace(/\.(mkv|mp4|avi|mov|ts|m2ts|webm|iso|vob)$/i, '');

    // Strip prepended website domains like "www.movies.com - " or "[TGx] "
    cleaned = cleaned.replace(/^(?:\[[^\]]+\]|\([^\)]+\)|\w+:\/\/[^\s]+|www\.[a-z0-9.-]+\.[a-z]{2,4}[\s._-]*)/i, (m) => {
        // Only strip if it looks like a domain or advertisement
        if (/www\.|https?:|\.com|\.org|\.net|\.to|\.cc|\.in|\.mx|\.tv|\.me|\.ws/i.test(m)) return '';
        return m;
    });

    // Strip domain names commonly attached within titles
    cleaned = cleaned.replace(/\b(?:uhdmovies|4khdhub|hdhub4u|hdhub|moviesmod|moviesdrive|net22|netmirror|bolly4u|extramovies|katmoviehd|vegamovies|topmovies|luxmovies)\b[\w.-]*/gi, ' ');

    return cleaned.trim();
}

/**
 * Main parser function: parses any torrent or release title into structured metadata
 * @param {string} rawInput 
 * @returns {object} ParsedResult
 */
function parseTorrentTitle(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') {
        return createEmptyResult('');
    }

    const trimmed = rawInput.trim();
    if (parseCache.has(trimmed)) {
        return parseCache.get(trimmed);
    }

    const cleaned = cleanReleaseNoise(trimmed);
    const result = extractAllAttributes(cleaned, trimmed);

    if (parseCache.size >= MAX_CACHE_SIZE) {
        // Evict oldest 1000 items
        const keys = parseCache.keys();
        for (let i = 0; i < 1000; i++) {
            parseCache.delete(keys.next().value);
        }
    }
    parseCache.set(trimmed, result);
    return result;
}

function createEmptyResult(raw) {
    return {
        raw: raw,
        title: '',
        year: null,
        resolution: null,
        quality: null,
        codec: null,
        bitDepth: null,
        hdr: [],
        dvProfile: null,
        special: [],
        audio: [],
        channels: null,
        languages: [],
        languageFlags: [],
        subtitles: [],
        isMultiAudio: false,
        isDualAudio: false,
        isHindi: false,
        seasons: [],
        episodes: [],
        seasonEpisode: null,
        isComplete: false,
        edition: null,
        releaseGroup: null,
        isCam: false,
        isSample: false,
        isRepack: false,
        isProper: false
    };
}

function extractAllAttributes(text, originalRaw) {
    const res = createEmptyResult(originalRaw);

    // 1. CAM / Low quality detection
    if (/\b(?:cam|camrip|hdcam|hd[\s._-]?cam|telesync|tele[\s._-]?sync|ts|hdts|hd[\s._-]?ts|tc|telecine|tele[\s._-]?cine|dvdscr|scr|screener|workprint)\b/i.test(text)) {
        res.isCam = true;
        res.quality = 'CAM';
    }

    // Sample / Trailer check
    if (/\b(?:sample|trailer|promo|teaser)\b/i.test(text) || /(?:^|[\s._\-/])sample(?:[\s._\-\]\/]|$)/i.test(text)) {
        res.isSample = true;
    }

    // Repack / Proper check
    if (/\brepack\b/i.test(text)) res.isRepack = true;
    if (/\bproper\b/i.test(text)) res.isProper = true;

    // 2. Resolution
    const has2160 = /\b(?:2160[pi]?|4k|uhd|3840x2160)\b/i.test(text);
    const has1080 = /\b(?:1080[pi]?|fhd|full[\s._-]?hd|1920x1080)\b/i.test(text);
    const has720  = /\b(?:720[pi]?|1280x720)\b/i.test(text) || (/\bhd\b/i.test(text) && !/\b(?:hdtv|hdrip|hdcam|hdts|hdr)\b/i.test(text));
    const has480  = /\b(?:480[pi]?|576[pi]?|sd|848x480)\b/i.test(text);

    if (has2160 && !has1080) {
        res.resolution = '2160p';
    } else if (has1080 && !has2160) {
        res.resolution = '1080p';
    } else if (has720 && !has1080 && !has2160) {
        res.resolution = '720p';
    } else if (has480 && !has1080 && !has2160 && !has720) {
        res.resolution = '480p';
    } else if (has2160 && has1080) {
        // Determine if 4K was source remaster or real resolution
        if (/1080p.*(?:bluray|web-dl|webrip|remux|hevc|x264|x265)/i.test(text)) {
            res.resolution = '1080p';
        } else if (/2160p.*(?:bluray|web-dl|webrip|remux|hevc|x265)/i.test(text)) {
            res.resolution = '2160p';
        } else {
            const idx2160 = text.search(/\b(?:2160[pi]?|4k|uhd)\b/i);
            const idx1080 = text.search(/\b(?:1080[pi]?|fhd)\b/i);
            res.resolution = idx2160 < idx1080 ? '2160p' : '1080p';
        }
    }

    // 3. Quality & Source
    if (/\b(?:bd|uhd)?remux\b/i.test(text)) {
        res.special.push('REMUX');
    }
    if (/\b(?:bluray|blu[\s._-]?ray|bd[\s._-]?rip|br[\s._-]?rip|bdr)\b/i.test(text)) {
        res.quality = 'BluRay';
    } else if (/\b(?:web[\s._-]?dl|webdl)\b/i.test(text) || /\b(?:amzn|nf|dsnp|atvp|hmax|itunes|appletv)[\s._-]?web\b/i.test(text)) {
        res.quality = 'WEB-DL';
    } else if (/\b(?:web[\s._-]?rip|webrip)\b/i.test(text)) {
        res.quality = 'WEBRip';
    } else if (/\b(?:hdtv|pdtv|dsr|tvrip)\b/i.test(text)) {
        res.quality = 'HDTV';
    } else if (/\b(?:dvd[\s._-]?rip|dvd|dvd-r)\b/i.test(text)) {
        res.quality = 'DVDRip';
    } else if (res.isCam) {
        res.quality = 'CAM';
    }

    // 4. Visual Enhancements: Dolby Vision, HDR10+, HDR10, HDR, IMAX
    const hasDV = /\b(?:dv|dovi|dvision|dolby[\s._-]?vision)\b/i.test(text)
        || /(?:^|[\s._\-\[/])(?:dv|dovi)(?:[\s._\-\]\/]|$)/i.test(text)
        || /\bprofile[\s._-]?[578]\b/i.test(text)
        || /\b(?:dv[\s._-]?(?:hdr|hdr10|hdr10\+|hevc|remux|bluray|web|p[578]))\b/i.test(text)
        || /\b(?:hdr10[\s._-]?dv|hdr[\s._-]?dv)\b/i.test(text);

    // DV Profile (Profile 5, 7, 8)
    const dvMatch = text.match(/\bprofile[\s._-]?([578])\b/i) 
        || text.match(/\b(?:dv|dovi)[\s._-]?p?([578])\b/i)
        || text.match(/\bP([578])\b/);
    if (dvMatch && dvMatch[1]) {
        res.dvProfile = `Profile ${dvMatch[1]}`;
    }

    const hasHDR10Plus = /\bhdr[\s._-]?10[\s._-]?(?:\+|plus)(?=[^a-z0-9]|$)/i.test(text);
    const hasHDR10 = /\bhdr[\s._-]?10\b/i.test(text) && !hasHDR10Plus;
    const hasHDR = (/\bhdr\b/i.test(text) || /(?:^|[\s._\-\[/])hdr(?:[\s._\-\]\/]|$)/i.test(text)) && !hasHDR10Plus && !hasHDR10;

    if (hasDV) {
        res.hdr.push('Dolby Vision');
        if (hasHDR10Plus) res.hdr.push('HDR10+');
        else if (hasHDR10) res.hdr.push('HDR10');
    } else if (hasHDR10Plus) {
        res.hdr.push('HDR10+');
    } else if (hasHDR10) {
        res.hdr.push('HDR10');
    } else if (hasHDR) {
        res.hdr.push('HDR');
    }

    // IMAX Enhanced / IMAX
    if (/\b(?:imax[\s._-]?enhanced)\b/i.test(text)) {
        res.special.push('IMAX Enhanced');
    } else if (/\bimax\b/i.test(text) || /(?:^|[\s._\-\[/])imax(?:[\s._\-\]\/]|$)/i.test(text)) {
        res.special.push('IMAX');
    }

    // Bit depth
    if (/\b10[\s._-]?bit\b/i.test(text) || /\bhevc[\s._-]?10\b/i.test(text) || /\bhi10p\b/i.test(text)) {
        res.bitDepth = '10-bit';
        res.special.push('10-bit');
    }

    // 5. Video Codec
    if (/\b(?:hevc|h[\s._-]?265|x265)\b/i.test(text)) res.codec = 'HEVC';
    else if (/\b(?:avc|h[\s._-]?264|x264)\b/i.test(text)) res.codec = 'H.264';
    else if (/\b(?:av1|av01)\b/i.test(text)) res.codec = 'AV1';
    else if (/\b(?:xvid|divx)\b/i.test(text)) res.codec = 'XviD';

    // 6. Audio Codecs & Formats (Capture ALL audio tracks present, e.g. Hindi DDP + English DTS-HD)
    const hasAtmos = /\b(?:atmos|dolby[\s._-]?atmos|ddpa|ddpa[\s._-]?[57]\.?1)\b/i.test(text)
        || /(?:^|[\s._\-\[/])atmos(?:[\s._\-\]\/]|$)/i.test(text)
        || /\b(?:ddp|dd\+|e[\s._-]?ac[\s._-]?3|true[\s._-]?hd)[\s._-]?atmos\b/i.test(text)
        || /\batmos[\s._-]?(?:ddp|dd\+|true[\s._-]?hd)\b/i.test(text)
        || /\b(?:e[\s._-]?ac[\s._-]?3[\s._-]?joc|joc)\b/i.test(text);

    const hasTrueHD = /\btrue[\s._-]?hd\b/i.test(text);
    const hasDTSX = /\bdts[\s._-]?x\b/i.test(text);
    const hasDTSHD = /\bdts[\s._-]?(?:hd|ma)\b/i.test(text);
    const hasDTS = /\bdts\b/i.test(text) && !hasDTSHD && !hasDTSX;
    const hasDDP = /(?:\bddpa?|\bdd\+|e[\s._-]?ac[\s._-]?3|dolby[\s._-]?digital[\s._-]?plus)/i.test(text);
    const hasDD = /(?:\bdd|ac[\s._-]?3|dolby[\s._-]?digital)/i.test(text) && !hasDDP;
    const hasFLAC = /\bflac\b/i.test(text);
    const hasAAC = /\baac(?:\d(?:\.\d)?)?\b/i.test(text);
    const hasOpus = /\bopus\b/i.test(text);

    if (hasAtmos) res.audio.push('Dolby Atmos');
    if (hasTrueHD) res.audio.push('TrueHD');
    if (hasDTSX) res.audio.push('DTS:X');
    if (hasDTSHD) res.audio.push('DTS-HD MA');
    else if (hasDTS) res.audio.push('DTS');
    if (hasDDP) res.audio.push('DDP');
    else if (hasDD) res.audio.push('DD');
    if (hasFLAC) res.audio.push('FLAC');
    if (hasAAC && res.audio.length === 0) res.audio.push('AAC');
    else if (hasOpus && res.audio.length === 0) res.audio.push('Opus');

    // Channels - detect highest channel count across audio tracks
    const has71 = /(?:^|[^0-9])7[. ]1(?![0-9])|\b8ch\b/i.test(text);
    const has51 = /(?:^|[^0-9])5[. ]1(?![0-9])|\b6ch\b/i.test(text);
    const has20 = /(?:^|[^0-9])2[. ]0(?![0-9])|\b2ch\b|\bstereo\b/i.test(text);
    if (has71) res.channels = '7.1';
    else if (has51) res.channels = '5.1';
    else if (has20) res.channels = '2.0';

    // 7. Subtitle Isolation & Language Detection
    // Do NOT allow subtitle tags (e.g. [Subs: Hin, Eng], HinSub, ESubs) to contaminate spoken audio languages
    let audioText = text;
    const subMatches = [];
    audioText = audioText.replace(/(?:\[|\(|\b)(?:(?:hard|soft|forced)?subs?|subtitles?|esubs?|vost)[\s:._-]*([^\]\)\n]+)(?:\]|\)|\b)/gi, (match, p1) => {
        subMatches.push(p1);
        return ' ';
    });
    audioText = audioText.replace(/\b(?:hinsub|engsub|esub|softsub|hardsub)\b/gi, ' ');

    for (const lang of LANGUAGE_DEFINITIONS) {
        if (subMatches.some(s => lang.regex.test(s))) {
            if (!res.subtitles.includes(lang.name)) {
                res.subtitles.push(lang.name);
            }
        }
    }

    // Spoken Audio Languages & Multi-Audio
    const hasMultiAudio = /\b(?:multi[\s._-]?audio)\b/i.test(audioText) || (/\bmulti\b/i.test(audioText) && !/\bmulti[\s._-]?sub/i.test(text));
    const hasDualAudio = /\b(?:dual[\s._-]?audio|dual)\b/i.test(audioText) && !hasMultiAudio;

    for (const lang of LANGUAGE_DEFINITIONS) {
        if (lang.regex.test(audioText)) {
            if (!res.languages.includes(lang.name)) {
                res.languages.push(lang.name);
                res.languageFlags.push(lang.flag);
            }
        }
    }

    // Determine Dual-Audio / Multi-Audio flags accurately
    const isDual = hasDualAudio || (res.languages.length === 2 && !hasMultiAudio);
    const isMulti = hasMultiAudio || res.languages.length >= 3;

    res.isDualAudio = isDual && !isMulti;
    res.isMultiAudio = isMulti;

    if (res.isMultiAudio && !res.languages.includes('Multi-Audio')) {
        res.languages.unshift('Multi-Audio');
    } else if (res.isDualAudio && !res.languages.includes('Dual-Audio')) {
        res.languages.unshift('Dual-Audio');
    }

    res.isHindi = res.languages.includes('Hindi');

    // 8. Editions
    for (const ed of EDITION_DEFINITIONS) {
        if (ed.regex.test(text)) {
            res.edition = ed.name;
            break;
        }
    }

    // 9. Season & Episode Detection (AIOStreams pattern)
    // S01E05, S01-S03, 1x04, Season 1 Complete, etc.
    const seRegex = /\b(?:s(\d{1,2})[\s._-]?e(\d{1,3})(?:[\s._-]?e(\d{1,3}))?|(\d{1,2})x(\d{1,3}))\b/i;
    const seMatch = text.match(seRegex);
    if (seMatch) {
        const s = parseInt(seMatch[1] || seMatch[4], 10);
        const e1 = parseInt(seMatch[2] || seMatch[5], 10);
        const e2 = seMatch[3] ? parseInt(seMatch[3], 10) : null;
        res.seasons.push(s);
        res.episodes.push(e1);
        if (e2) res.episodes.push(e2);
        res.seasonEpisode = e2 
            ? `S${String(s).padStart(2, '0')}E${String(e1).padStart(2, '0')}-E${String(e2).padStart(2, '0')}`
            : `S${String(s).padStart(2, '0')}E${String(e1).padStart(2, '0')}`;
    } else {
        // Season pack or range check: "S01-S03", "Season 1", "S01 Complete"
        const sRangeMatch = text.match(/\b(?:s(\d{1,2})[\s._-]?-(?:[\s._-]?s)?(\d{1,2})|season[\s._-]?(\d{1,2})[\s._-]?(?:to|-)?[\s._-]?(?:season[\s._-]?)?(\d{1,2}))\b/i);
        if (sRangeMatch) {
            const startS = parseInt(sRangeMatch[1] || sRangeMatch[3], 10);
            const endS = parseInt(sRangeMatch[2] || sRangeMatch[4], 10);
            for (let i = startS; i <= endS; i++) res.seasons.push(i);
            res.seasonEpisode = `S${String(startS).padStart(2, '0')}-S${String(endS).padStart(2, '0')}`;
            res.isComplete = true;
        } else {
            const sOnlyMatch = text.match(/\b(?:s(\d{1,2})|season[\s._-]?(\d{1,2}))\b/i);
            if (sOnlyMatch) {
                const sNum = parseInt(sOnlyMatch[1] || sOnlyMatch[2], 10);
                res.seasons.push(sNum);
                res.seasonEpisode = `S${String(sNum).padStart(2, '0')}`;
                if (/\b(?:complete|all[\s._-]?episodes?|pack)\b/i.test(text)) {
                    res.isComplete = true;
                }
            }
        }
    }

    // Anime standalone episode pattern: " - 01 ", " Ep 05 ", " Episode 12 "
    if (res.episodes.length === 0) {
        const animeEpMatch = text.match(/(?:^|[\s._-])(?:e|ep|episode|\-)\s*0*(\d{1,3})(?=\s*[\(\[._\s-]|$)/i);
        if (animeEpMatch) {
            res.episodes.push(parseInt(animeEpMatch[1], 10));
            res.seasonEpisode = `E${String(parseInt(animeEpMatch[1], 10)).padStart(2, '0')}`;
        }
    }

    // 10. Year Extraction (1900 - 2035)
    const yearMatch = text.match(/\b(19\d\d|20[0-3]\d)\b/);
    if (yearMatch) {
        res.year = parseInt(yearMatch[1], 10);
    }

    // 11. Release Group Extraction
    // Look at end of string: -Group or [Group]
    const groupMatch = text.match(/[-_]([A-Za-z0-9]+)$/) || text.match(/\[([A-Za-z0-9]+)\]$/);
    if (groupMatch) {
        const potential = groupMatch[1];
        if (!/^(?:mkv|mp4|avi|2160p|1080p|720p|480p|hevc|x265|x264|aac|ac3|dvd|hd|uhd|web|dl|rip|ita|eng|fra|ger|spa|rus|complete)$/i.test(potential)) {
            res.releaseGroup = potential;
        }
    }

    // Also check for leading bracket group in anime releases: [SubsPlease] Show Name - 01
    const animeGroupMatch = text.match(/^\[([A-Za-z0-9_.-]+)\]\s*(.+)/);
    if (animeGroupMatch) {
        res.releaseGroup = animeGroupMatch[1];
    }

    // 12. Clean Title Extraction
    // Determine the boundary where metadata tokens begin
    let titlePortion = text;
    if (animeGroupMatch) {
        titlePortion = animeGroupMatch[2]; // skip leading [Group]
    }

    // Scene token delimiter: Year, Season, or standard technical scene markers
    const sceneTokensRegex = /\b(?:19\d\d|20[0-3]\d|s\d{1,2}|season[\s._-]?\d{1,2}|\d{1,2}x\d{1,3}|2160p|1080p|720p|480p|4k|uhd|fhd|bluray|blu-ray|bdrip|brrip|web-dl|webdl|webrip|web|hdtv|dvdrip|remux|imax|hdr|hdr10|hdr10\+|dv|dovi|dolby|atmos|truehd|ddp|dd\+|eac3|ac3|dts|flac|aac|hevc|h265|x265|h264|x264|av1|10bit|hindi|tamil|telugu|malayalam|kannada|english|japanese|multi|dual|subs?|complete|repack|proper)\b/i;
    
    let boundaryIndex = -1;
    if (res.year && titlePortion.includes(String(res.year))) {
        const idx = titlePortion.indexOf(String(res.year));
        if (idx > 2) boundaryIndex = idx;
    } 
    if (boundaryIndex === -1 && seMatch) {
        const idx = titlePortion.search(seRegex);
        if (idx > 2) boundaryIndex = idx;
    }
    if (boundaryIndex === -1) {
        const tokenMatch = titlePortion.match(sceneTokensRegex);
        if (tokenMatch && tokenMatch.index > 2) {
            boundaryIndex = tokenMatch.index;
        }
    }

    if (boundaryIndex > 2) {
        titlePortion = titlePortion.substring(0, boundaryIndex);
    }

    // Clean delimiters (dots, underscores, brackets, dashes) into clean spacing
    let clean = titlePortion
        .replace(/[\._]/g, ' ')
        .replace(/[\[\]\(\)\{\}]/g, ' ')
        .replace(/[-+]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Prevent generic garbage or single letters from becoming the title
    if (/^(?:2160p|1080p|720p|480p|4k|uhd|fhd|hd|stream|video|fast|slow|dead|nuvio|torrentio|rd|ad|tb|movie|series|episode)$/i.test(clean) || clean.length < 2) {
        clean = '';
    }

    res.title = clean;
    return res;
}

module.exports = {
    parseTorrentTitle,
    LANGUAGE_DEFINITIONS,
    cleanReleaseNoise
};
