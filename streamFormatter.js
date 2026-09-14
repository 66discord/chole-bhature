/**
 * AIOStreams Multi-Preset Stream Card Formatter
 * Formats stream.name and stream.title for Stremio without destroying or hallucinating metadata.
 */

function formatProviderChain(providers, fallback = 'Stream') {
    if (!providers || !Array.isArray(providers) || providers.length === 0) {
        if (typeof fallback === 'string' && (fallback.includes('Telegram') || fallback.includes('PencariMovie'))) {
            return '⚡ Telegram';
        }
        return fallback;
    }
    const cleanList = [...new Set(providers.filter(Boolean))].map(p => {
        if (typeof p === 'string' && (p.includes('Telegram') || p.includes('PencariMovie'))) {
            return '⚡ Telegram';
        }
        return p;
    });
    if (cleanList.length === 0) return fallback;
    if (cleanList.length === 1) return cleanList[0];
    if (cleanList.length === 2) return `${cleanList[0]} + ${cleanList[1]}`;
    if (cleanList.length === 3) return `${cleanList[0]} + ${cleanList[1]} + ${cleanList[2]}`;
    return `${cleanList[0]} + ${cleanList[1]} (+${cleanList.length - 2} more)`;
}

function getDebridBadge(ingested, config = {}) {
    const provider = (config.debridProvider || '').toLowerCase();
    if (ingested.isDebridCached) {
        if (provider === 'torbox') return '⚡ [TB+] Instant';
        if (provider === 'alldebrid') return '⚡ [AD+] Instant';
        if (provider === 'premiumize') return '⚡ [PM+] Instant';
        return '⚡ [RD+] Instant';
    }
    if (ingested.isP2P && provider) {
        if (provider === 'torbox') return '⚡ [TB]';
        if (provider === 'alldebrid') return '⚡ [AD]';
        if (provider === 'premiumize') return '⚡ [PM]';
        return '⚡ [RD]';
    }
    return null;
}

function getSeederBadge(seeders, show = true) {
    if (seeders === null || seeders === undefined || show === false) return null;
    if (seeders >= 25) return `🟢 ${seeders} Seeders`;
    if (seeders >= 5) return `🟡 ${seeders} Seeders`;
    return `🔴 ${seeders} Seeder${seeders === 1 ? '' : 's'}`;
}

/**
 * Formats an ingested stream into Stremio name and title fields
 * @param {object} ingested - Ingested & normalized stream from streamIngest
 * @param {object} options - Latency, isDead, config
 * @returns {object} { name, title }
 */
function formatStreamCard(ingested, options = {}) {
    const {
        latency = 150,
        isDead = false,
        config = {},
        preset = 'aiostreams'
    } = options;

    const parsed = ingested.parsed || {};
    const providerLabel = formatProviderChain(ingested.providers, ingested.originalProvider || 'Stream');
    const debridBadge = getDebridBadge(ingested, config);
    const seederBadge = getSeederBadge(ingested.seeders, config.showSeeders !== false);

    // Language badge for header line
    let langTopBadge = null;
    const realLangs = (parsed.languages || []).filter(l => l !== 'Dual-Audio' && l !== 'Multi-Audio');
    if (parsed.isMultiAudio || parsed.languages.includes('Multi-Audio') || realLangs.length >= 3) {
        langTopBadge = 'Multi Audio';
    } else if (parsed.isDualAudio || parsed.languages.includes('Dual-Audio') || realLangs.length === 2) {
        langTopBadge = 'Dual Audio';
    } else if (realLangs.length === 1) {
        if (realLangs[0] !== 'English') {
            langTopBadge = realLangs[0];
        }
    }

    // 1. Build Header Line (stream.name)
    const topBadges = [
        debridBadge,
        parsed.resolution === '2160p' ? '4K UHD' : (parsed.resolution === '1080p' ? '1080p FHD' : (parsed.resolution === '720p' ? '720p HD' : parsed.resolution)),
        ...parsed.hdr,
        parsed.special.includes('REMUX') ? 'REMUX' : (parsed.quality || null),
        parsed.audio.includes('Dolby Atmos') ? 'Atmos' : (parsed.audio.includes('TrueHD') ? 'TrueHD' : (parsed.audio.includes('DTS-HD MA') ? 'DTS-HD' : (parsed.audio.includes('DDP') ? 'DDP' : null))),
        parsed.channels || null,
        langTopBadge
    ].filter(Boolean);

    const uniqueTopBadges = [...new Set(topBadges)];
    const topBadgeStr = uniqueTopBadges.length > 0 ? ` • ${uniqueTopBadges.slice(0, 6).join(' • ')}` : '';

    let nameLine = '';
    if (isDead) {
        nameLine = `🔴 DEAD • ${providerLabel}${topBadgeStr}`;
    } else if (ingested.isP2P && !debridBadge) {
        nameLine = `🧲 P2P • ${providerLabel}${topBadgeStr}`;
    } else {
        const statusEmoji = latency < 800 ? '🟢' : '🟡';
        const statusTag = latency < 800 ? 'FAST' : 'SLOW';
        nameLine = `${statusEmoji} ${statusTag} (${latency}ms) • ${providerLabel}${topBadgeStr}`;
    }

    // 2. Build Card Description (stream.title)
    // If cleanTitles is disabled, show raw scene name cleanly with stats row
    if (config.cleanTitles === false) {
        const lines = [ingested.rawFilename];
        const stats = [];
        if (ingested.sizeFormatted && config.showFileSize !== false) stats.push(`💾 ${ingested.sizeFormatted}`);
        if (seederBadge && config.showSeeders !== false) stats.push(seederBadge);
        stats.push(`⚙️ ${providerLabel}`);
        lines.push(stats.join(' '));
        return {
            name: nameLine,
            title: lines.join('\n')
        };
    }

    // Torrentio Classic Preset
    if (preset === 'torrentio') {
        const lines = [ingested.rawFilename];
        const stats = [];
        if (ingested.sizeFormatted && config.showFileSize !== false) stats.push(`💾 ${ingested.sizeFormatted}`);
        if (seederBadge && config.showSeeders !== false) stats.push(seederBadge);
        stats.push(`⚙️ ${providerLabel}`);
        lines.push(stats.join(' '));
        return {
            name: nameLine,
            title: lines.join('\n')
        };
    }

    // AIOStreams Modern Preset (Default)
    const cardLines = [];

    // Line 1: Header (Title, Year, Episode, Main Release Specs)
    const titleHeaderParts = [];
    const resolvedTitle = (config.target && config.target.title)
        ? config.target.title
        : (parsed.title || ingested.rawFilename);

    const resolvedYear = (config.target && config.target.year)
        ? config.target.year
        : parsed.year;

    let resolvedSeasonEpisode = parsed.seasonEpisode;
    if (config.target && (config.target.type === 'series' || config.target.type === 'tv') && config.target.season && config.target.episode) {
        const reqS = String(config.target.season).padStart(2, '0');
        const reqE = String(config.target.episode).padStart(2, '0');
        resolvedSeasonEpisode = `S${reqS}E${reqE}`;
    }

    if (resolvedTitle) {
        let titleHeader = resolvedTitle;
        if (resolvedYear) titleHeader += ` (${resolvedYear})`;
        if (resolvedSeasonEpisode) titleHeader += ` • ${resolvedSeasonEpisode}`;
        titleHeaderParts.push(titleHeader);
    }

    const qualitySpecs = [
        parsed.resolution ? (parsed.resolution === '2160p' ? '4K UHD' : parsed.resolution === '1080p' ? '1080p FHD' : parsed.resolution === '720p' ? '720p HD' : parsed.resolution) : null,
        parsed.special.includes('REMUX') ? 'REMUX' : (parsed.quality || null),
        parsed.special.includes('IMAX Enhanced') ? 'IMAX Enhanced' : (parsed.special.includes('IMAX') ? 'IMAX' : null),
        parsed.codec || null,
        parsed.bitDepth || null
    ].filter(Boolean);

    if (qualitySpecs.length > 0) {
        titleHeaderParts.push(`[${qualitySpecs.join(' • ')}]`);
    }
    if (titleHeaderParts.length > 0) {
        cardLines.push(`🎬 ${titleHeaderParts.join(' ')}`);
    }

    // Original Stream File Title (if enabled)
    const rawTitleToDisplay = ingested.originalTitle || ingested.rawFilename;
    if (config.includeOriginalTitle !== false && rawTitleToDisplay) {
        const cleanRaw = String(rawTitleToDisplay).replace(/[🎬💎🌐📦🟢🟡🔴🧲⚡⚙️🔗🏷️]/g, '').trim();
        const isGeneric = !cleanRaw || cleanRaw.toLowerCase() === 'stream' || cleanRaw.toLowerCase() === 'video';
        if (!isGeneric) {
            cardLines.push(`📄 ${cleanRaw}`);
        }
    }

    // Line 2: Visual & Audio Studio Badges
    const avBadges = [];
    if (parsed.hdr && parsed.hdr.length > 0) {
        parsed.hdr.forEach(h => {
            if (h === 'Dolby Vision' && parsed.dvProfile) avBadges.push(`Dolby Vision ${parsed.dvProfile}`);
            else avBadges.push(h);
        });
    }
    if (parsed.audio && parsed.audio.length > 0) {
        const audioStr = parsed.audio.join(' + ');
        const chanStr = parsed.channels ? ` ${parsed.channels}` : '';
        avBadges.push(`${audioStr}${chanStr}`);
    } else if (parsed.channels) {
        avBadges.push(`Audio ${parsed.channels}`);
    }
    if (avBadges.length > 0) {
        cardLines.push(`💎 ${avBadges.join(' • ')}`);
    }

    // Line 3: Spoken Languages & Audio Tracks (with accurate country flags)
    const displayLangs = [];
    const nonGenericLangs = (parsed.languages || []).filter(l => l !== 'Dual-Audio' && l !== 'Multi-Audio');

    if (parsed.isMultiAudio || parsed.languages.includes('Multi-Audio') || nonGenericLangs.length >= 3) {
        const langNames = nonGenericLangs.map(l => {
            if (l === 'English') return '🇬🇧 English';
            if (l === 'Hindi') return '🇮🇳 Hindi';
            if (l === 'Tamil') return '🇮🇳 Tamil';
            if (l === 'Telugu') return '🇮🇳 Telugu';
            if (l === 'Malayalam') return '🇮🇳 Malayalam';
            if (l === 'Kannada') return '🇮🇳 Kannada';
            if (l === 'Japanese') return '🇯🇵 Japanese';
            if (l === 'Korean') return '🇰🇷 Korean';
            return l;
        });
        const details = langNames.length > 0 ? ` [${[...new Set(langNames)].join(' • ')}]` : '';
        displayLangs.push(`🌐 Multi-Audio${details}`);
    } else if (parsed.isDualAudio || parsed.languages.includes('Dual-Audio') || nonGenericLangs.length === 2) {
        const langNames = nonGenericLangs.map(l => {
            if (l === 'English') return '🇬🇧 English';
            if (l === 'Hindi') return '🇮🇳 Hindi';
            if (l === 'Tamil') return '🇮🇳 Tamil';
            if (l === 'Telugu') return '🇮🇳 Telugu';
            if (l === 'Malayalam') return '🇮🇳 Malayalam';
            if (l === 'Kannada') return '🇮🇳 Kannada';
            if (l === 'Japanese') return '🇯🇵 Japanese';
            if (l === 'Korean') return '🇰🇷 Korean';
            return l;
        });
        const details = langNames.length > 0 ? ` [${[...new Set(langNames)].join(' + ')}]` : '';
        displayLangs.push(`🌐 Dual-Audio${details}`);
    } else if (nonGenericLangs.length > 0) {
        nonGenericLangs.forEach(l => {
            if (l === 'Hindi') displayLangs.push('🇮🇳 Hindi');
            else if (l === 'Tamil') displayLangs.push('🇮🇳 Tamil');
            else if (l === 'Telugu') displayLangs.push('🇮🇳 Telugu');
            else if (l === 'Malayalam') displayLangs.push('🇮🇳 Malayalam');
            else if (l === 'Kannada') displayLangs.push('🇮🇳 Kannada');
            else if (l === 'Japanese') displayLangs.push('🇯🇵 Japanese');
            else if (l === 'English') displayLangs.push('🇬🇧 English');
            else if (l === 'Korean') displayLangs.push('🇰🇷 Korean');
            else displayLangs.push(l);
        });
    } else {
        displayLangs.push('🇬🇧 English');
    }

    // Include subtitle tags cleanly if present
    if (parsed.subtitles && parsed.subtitles.length > 0) {
        const subTags = parsed.subtitles.map(s => {
            if (s === 'English') return '🇬🇧 Eng';
            if (s === 'Hindi') return '🇮🇳 Hin';
            return s;
        });
        displayLangs.push(`💬 Subs: ${[...new Set(subTags)].join(', ')}`);
    }

    if (displayLangs.length > 0) {
        cardLines.push(`${[...new Set(displayLangs)].join(' • ')}`);
    }

    // Line 4: Media Specs Row (File Size, Seeders, Release Group, Providers)
    const metaRow = [];
    if (ingested.sizeFormatted && config.showFileSize !== false) {
        metaRow.push(`📦 ${ingested.sizeFormatted}`);
    }
    if (seederBadge && config.showSeeders !== false) {
        metaRow.push(seederBadge);
    }
    if (parsed.releaseGroup && config.showReleaseGroup !== false) {
        metaRow.push(`🏷️ ${parsed.releaseGroup}`);
    }
    metaRow.push(`🔗 ${providerLabel}`);
    if (metaRow.length > 0) {
        cardLines.push(metaRow.join(' • '));
    }

    return {
        name: nameLine,
        title: cardLines.join('\n') || ingested.rawFilename
    };
}

module.exports = {
    formatStreamCard,
    formatProviderChain,
    getDebridBadge,
    getSeederBadge
};
