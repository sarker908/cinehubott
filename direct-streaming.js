/* CineHub Direct Streaming
 * Stremio-compatible addon discovery for direct HTTP media streams.
 * Torrent-only entries are intentionally ignored because the browser player
 * cannot fetch BitTorrent peers directly.
 */
(function (global) {
    'use strict';

    const STORAGE_KEY = 'ch_direct_addons_v1';
    const cache = new Map();

    function readAddons() {
        try {
            const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            return Array.isArray(value) ? value : [];
        } catch (_) {
            return [];
        }
    }

    function writeAddons(addons) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(addons));
    }

    function cleanManifestUrl(value) {
        const url = new URL(String(value || '').trim());
        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error('Only HTTP or HTTPS manifest URLs are supported.');
        }
        return url.href.replace(/\/+$/, '');
    }

    function addonBase(manifestUrl) {
        return cleanManifestUrl(manifestUrl).replace(/\/manifest\.json(?:\?.*)?$/i, '');
    }

    async function fetchJson(url) {
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
    }

    async function fetchManifest(manifestUrl, force) {
        const url = cleanManifestUrl(manifestUrl);
        if (!force && cache.has(url)) return cache.get(url);
        const manifest = await fetchJson(url);
        if (!manifest || !manifest.id || !Array.isArray(manifest.resources)) {
            throw new Error('This does not look like a valid Stremio addon manifest.');
        }
        cache.set(url, manifest);
        return manifest;
    }

    function supports(manifest, type) {
        const types = Array.isArray(manifest.types) ? manifest.types : [];
        const resources = Array.isArray(manifest.resources) ? manifest.resources : [];
        return resources.some(resource =>
            resource === 'stream' ||
            (resource && resource.name === 'stream' &&
             (!Array.isArray(resource.types) || resource.types.includes(type)))
        ) && types.includes(type);
    }

    const AddonManager = {
        list() {
            return readAddons().map(addon => ({
                name: addon.name || addon.manifestUrl,
                manifestUrl: addon.manifestUrl,
                enabled: addon.enabled !== false
            }));
        },

        add(addon) {
            const manifestUrl = cleanManifestUrl(addon && addon.manifestUrl);
            const addons = readAddons();
            const existing = addons.find(item => item.manifestUrl === manifestUrl);
            if (existing) {
                existing.enabled = true;
                if (addon.name) existing.name = String(addon.name).slice(0, 80);
            } else {
                addons.push({
                    name: String((addon && addon.name) || manifestUrl).slice(0, 80),
                    manifestUrl,
                    enabled: true
                });
            }
            writeAddons(addons);
            return true;
        },

        toggle(manifestUrl, enabled) {
            const url = cleanManifestUrl(manifestUrl);
            const addons = readAddons();
            const item = addons.find(addon => addon.manifestUrl === url);
            if (!item) return false;
            item.enabled = Boolean(enabled);
            writeAddons(addons);
            return true;
        },

        remove(manifestUrl) {
            const url = cleanManifestUrl(manifestUrl);
            writeAddons(readAddons().filter(addon => addon.manifestUrl !== url));
            cache.delete(url);
        },

        async refreshManifest(manifestUrl) {
            return fetchManifest(manifestUrl, true);
        },

        async testManifest(manifestUrl) {
            const manifest = await fetchManifest(manifestUrl, true);
            const resources = Array.isArray(manifest.resources) ? manifest.resources : [];
            return {
                name: manifest.name || manifest.id,
                supportsStream: resources.some(resource => resource === 'stream' || resource?.name === 'stream'),
                supportsMovie: supports(manifest, 'movie'),
                supportsSeries: supports(manifest, 'series')
            };
        }
    };

    function streamUrl(base, type, id) {
        return base + '/stream/' + type + '/' + encodeURIComponent(id) + '.json';
    }

    function inferQuality(stream) {
        const text = [stream.name, stream.title, stream.description].filter(Boolean).join(' ');
        const match = text.match(/\b(2160|1440|1080|720|576|480|360)p\b/i);
        return match ? Number(match[1]) : 0;
    }

    function normalizeStream(stream, addonName) {
        if (!stream || typeof stream.url !== 'string') return null;
        let url;
        try {
            url = new URL(stream.url);
        } catch (_) {
            return null;
        }
        if (!['http:', 'https:'].includes(url.protocol)) return null;

        const rawType = String(stream.type || '').toLowerCase();
        const isHls = rawType.includes('hls') || /\.m3u8(?:$|\?)/i.test(url.pathname + url.search);
        // CineHub's player supports HLS and ordinary browser-playable media.
        // DASH manifests and torrent/infoHash-only streams are not passed to it.
        if (rawType.includes('dash') || /\.mpd(?:$|\?)/i.test(url.pathname + url.search)) return null;

        const subtitles = Array.isArray(stream.subtitles)
            ? stream.subtitles.filter(item => item && item.url).map(item => ({
                url: item.url,
                lang: item.lang || item.language || 'Subtitle'
            }))
            : [];

        const quality = inferQuality(stream);
        const language = stream.language || '';
        return {
            url: url.href,
            provider: String(addonName || 'Direct source').slice(0, 90),
            quality,
            streamType: isHls ? 'hls' : 'file',
            language: String(language).slice(0, 32),
            subtitles
        };
    }

    const StreamingManager = {
        async getDirectStreams(request) {
            if (!request || !request.imdbId) return [];
            const type = request.type === 'tv' ? 'series' : 'movie';
            const imdbId = String(request.imdbId);
            if (!/^tt\\d+$/i.test(imdbId)) return [];
            const itemId = type === 'series'
                ? imdbId + ':' + Number(request.season) + ':' + Number(request.episode)
                : imdbId;

            const addons = readAddons().filter(addon => addon.enabled !== false);
            const results = await Promise.all(addons.map(async addon => {
                try {
                    const manifest = await fetchManifest(addon.manifestUrl, false);
                    if (!supports(manifest, type)) return [];
                    const url = streamUrl(addonBase(addon.manifestUrl), type, itemId);
                    const payload = await fetchJson(url);
                    const streams = Array.isArray(payload.streams) ? payload.streams : [];
                    return streams
                        .map(stream => normalizeStream(stream, manifest.name || addon.name))
                        .filter(Boolean)
                        .map(stream => ({ ...stream, provider: stream.provider || manifest.name || addon.name }));
                } catch (error) {
                    console.warn('CineHub addon failed:', addon.name, error.message);
                    return [];
                }
            }));

            const unique = new Map();
            results.flat().forEach(stream => {
                if (!unique.has(stream.url)) unique.set(stream.url, stream);
            });
            return [...unique.values()].sort((a, b) =>
                (b.quality || 0) - (a.quality || 0) ||
                (a.streamType === b.streamType ? 0 : a.streamType === 'hls' ? -1 : 1)
            );
        }
    };

    global.CineHubDirectStreaming = { AddonManager, StreamingManager };
})(window);
