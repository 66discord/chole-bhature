/**
 * AIOStreams Multi-Preset Stream Card Formatter
 * Formats stream.name and stream.title for Stremio without destroying or hallucinating metadata.
 */

function formatProviderChain(providers, fallback = 'Stream') {
    if (!providers || !Array.isArray(providers) || providers.length === 0) {
        return fallback;
    }
    const cleanList = [...new Set(providers.filter(Boolean))];
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

    // 1. Build Header Line (stream.name)
    const topBadges = [
        debridBadge,
        parsed.resolution === '2160p' ? '4K UHD' : (parsed.resolution === '1080p' ? '1080p FHD' : (parsed.resolution === '720p' ? '720p HD' : parsed.resolution)),
        ...parsed.hdr,
        parsed.special.includes('REMUX') ? 'REMUX' : (parsed.quality || null),
        parsed.audio.includes('Dolby Atmos') ? 'Atmos' : (parsed.audio.includes('TrueHD') ? 'TrueHD' : (parsed.audio.includes('DTS-HD MA') ? 'DTS-HD' : null)),
        parsed.channels || null,
        parsed.languages.includes('Hindi') ? 'Hindi' : (parsed.languages.includes('Dual-Audio') ? 'Dual' : null)
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

    // Line 3: Languages & Dubs (with accurate country flags)
    if (parsed.languages && parsed.languages.length > 0) {
        const langTags = parsed.languages.map(l => {
            if (l === 'Hindi') return '🇮🇳 Hindi Dub';
            if (l === 'Tamil') return '🇮🇳 Tamil';
            if (l === 'Telugu') return '🇮🇳 Telugu';
            if (l === 'Malayalam') return '🇮🇳 Malayalam';
            if (l === 'Kannada') return '🇮🇳 Kannada';
            if (l === 'Japanese') return '🇯🇵 Japanese Audio';
            if (l === 'English') return '🇬🇧 English';
            if (l === 'Korean') return '🇰🇷 Korean';
            if (l === 'Dual-Audio') return '🌐 Dual-Audio';
            if (l === 'Multi-Audio') return '🌐 Multi-Audio';
            return l;
        });
        cardLines.push(`🌐 ${[...new Set(langTags)].join(' • ')}`);
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
