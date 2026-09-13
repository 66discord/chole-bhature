const express = require('express');
const http = require('http');
const https = require('https');
const axios = require('axios');
const router = express.Router();

// In-memory status cache for bridge latency ping
let lastPingTime = 0;
let lastPingStatus = { online: false, latencyMs: 0 };

/**
 * Health check endpoint for dashboard to test if local/remote bridge daemon is alive
 */
router.get('/status', async (req, res) => {
    let bridgeUrl = (req.query.bridgeUrl || process.env.TELEGRAM_BRIDGE_URL || 'http://127.0.0.1:8088').trim().replace(/\/+$/, '');
    if (!bridgeUrl.startsWith('http://') && !bridgeUrl.startsWith('https://')) {
        bridgeUrl = 'http://' + bridgeUrl;
    }
    const startTime = Date.now();

    try {
        // Try /api/version first (official pencarimovie-server health endpoint), fallback to root /
        let pingRes = null;
        try {
            pingRes = await axios.get(`${bridgeUrl}/api/version`, {
                timeout: 5000,
                validateStatus: () => true
            });
        } catch (verErr) {
            pingRes = await axios.get(`${bridgeUrl}/`, {
                timeout: 5000,
                validateStatus: () => true
            });
        }

        const latencyMs = Date.now() - startTime;
        const isHealthy = Boolean(pingRes && pingRes.status >= 200 && pingRes.status < 500);

        return res.json({
            success: isHealthy,
            online: isHealthy,
            bridgeHealthy: isHealthy,
            bridgeUrl,
            status: pingRes ? pingRes.status : 200,
            latencyMs,
            versionData: (pingRes && pingRes.data && typeof pingRes.data === 'object') ? pingRes.data : null
        });
    } catch (err) {
        return res.json({
            success: false,
            online: false,
            bridgeHealthy: false,
            bridgeUrl,
            error: err.message,
            latencyMs: Date.now() - startTime
        });
    }
});

function decodeTelegramPayload(payload) {
    if (!payload || typeof payload !== 'string') return null;
    try {
        const decoded = Buffer.from(payload, 'base64url').toString('utf8');
        return JSON.parse(decoded);
    } catch (e) {
        return null;
    }
}

/**
 * Streaming Route: /stream/telegram/:payload/:filename
 * Resolves Telegram file payload and streams byte ranges with HTTP 206 Partial Content
 */
router.get('/:payload/:filename', async (req, res) => {
    const { payload, filename } = req.params;
    if (!payload) {
        return res.status(400).send('Missing file payload');
    }

    const fileData = decodeTelegramPayload(payload);
    if (!fileData) {
        return res.status(400).send('Invalid payload encoding');
    }

    const shortCode = fileData.short_code;
    const fileSize = fileData.file_size || 0;
    const mimeType = fileData.mime || 'video/mp4';

    // Bridge URL: query parameter override -> payload bridge_url -> environment variable -> default localhost:8088
    let bridgeUrl = (req.query.bridgeUrl || fileData.bridge_url || process.env.TELEGRAM_BRIDGE_URL || 'http://127.0.0.1:8088').trim().replace(/\/+$/, '');
    if (!bridgeUrl.startsWith('http://') && !bridgeUrl.startsWith('https://')) {
        bridgeUrl = 'http://' + bridgeUrl;
    }

    // Target download URL on the MTProto/Telegram streaming daemon
    const upstreamUrl = `${bridgeUrl}/api/download/${payload}/${encodeURIComponent(filename || 'video.mp4')}`;

    // 1. Prepare proxy headers, forwarding Range header if present
    const headers = {
        'User-Agent': req.headers['user-agent'] || 'CholeBhature/1.0',
        'X-Forwarded-For': req.ip || req.connection.remoteAddress || '127.0.0.1'
    };

    if (req.headers.range) {
        headers['Range'] = req.headers.range;
    }

    try {
        // 2. Request chunk from upstream bridge daemon
        const upstreamReq = (upstreamUrl.startsWith('https:') ? https : http).request(upstreamUrl, {
            method: 'GET',
            headers: headers,
            timeout: 10000
        }, (upstreamRes) => {
            // Forward HTTP Status (200 OK or 206 Partial Content)
            res.status(upstreamRes.statusCode || 200);

            // Forward essential streaming & range headers
            const headerNames = [
                'content-type',
                'content-length',
                'content-range',
                'accept-ranges',
                'content-disposition',
                'cache-control',
                'etag',
                'last-modified'
            ];

            for (const h of headerNames) {
                if (upstreamRes.headers[h]) {
                    res.setHeader(h, upstreamRes.headers[h]);
                }
            }

            // Always ensure video player knows Range requests are supported
            if (!res.getHeader('accept-ranges')) {
                res.setHeader('Accept-Ranges', 'bytes');
            }
            if (!res.getHeader('content-type')) {
                res.setHeader('Content-Type', mimeType);
            }

            // Pipe video stream directly to player
            upstreamRes.pipe(res);

            upstreamRes.on('error', (err) => {
                console.warn('[Telegram Stream] Upstream pipe error:', err.message);
                if (!res.headersSent) {
                    res.status(502).end();
                }
            });
        });

        upstreamReq.on('error', (err) => {
            console.warn(`[Telegram Stream] Bridge connection failed (${bridgeUrl}):`, err.message);
            
            // Graceful Fallback: If daemon is not running locally, redirect to public web link
            if (shortCode && !res.headersSent) {
                const fallbackWebUrl = `https://pencarimovie.com/link/${shortCode}`;
                console.log(`[Telegram Stream] Redirecting to web fallback: ${fallbackWebUrl}`);
                return res.redirect(302, fallbackWebUrl);
            }

            if (!res.headersSent) {
                res.status(503).json({
                    error: 'Telegram Bridge Daemon Offline',
                    message: `Could not connect to Telegram streaming daemon at ${bridgeUrl}. Please verify the daemon is running.`,
                    fallbackUrl: shortCode ? `https://pencarimovie.com/link/${shortCode}` : null
                });
            }
        });

        req.on('close', () => {
            upstreamReq.destroy();
        });

        upstreamReq.end();
    } catch (err) {
        console.error('[Telegram Stream] Handler error:', err.message);
        if (!res.headersSent) {
            if (shortCode) {
                return res.redirect(302, `https://pencarimovie.com/link/${shortCode}`);
            }
            res.status(500).send('Streaming error');
        }
    }
});

router.decodeTelegramPayload = decodeTelegramPayload;

module.exports = router;
