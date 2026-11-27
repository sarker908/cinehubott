/* ═══════════════════════════════════════════════════════
   CINEHUB — script.js
   Direct TMDB API + curated working streaming sources
═══════════════════════════════════════════════════════ */

// ── CONFIG ───────────────────────────────────────────
const API_KEY        = '17f0e8466113d048979b4f379b94909c';
const TMDB           = 'https://api.themoviedb.org/3';
const IMG            = 'https://image.tmdb.org/t/p/';
const PLACEHOLDER    = 'https://placehold.co/500x750/141417/555?text=No+Poster';
const PLACEHOLDER_EP = 'https://placehold.co/300x169/141417/555?text=No+Preview';
const PLACEHOLDER_AC = 'https://placehold.co/185x278/141417/555?text=No+Photo';

// ── STREAMING PLATFORM FILTER — new ──────────────────
// TMDB Watch Providers (watch/providers API — provider IDs are stable/global).
// Text-only labels; `id` matches TMDB's with_watch_providers provider ID.
const WATCH_REGION = 'BD';
let STREAMING_PLATFORMS = [{ id: '', label: 'All' }];
const PLATFORM_STORAGE_KEY = 'ch_platform'; // remembers the last selected platform id

// ── AGE RATING FILTER/BADGE — new ────────────────────
// Maps real TMDB certifications (US movie MPAA ratings + US TV Parental
// Guidelines) to the 4 categories this feature supports. Only actual TMDB
// certification values are ever mapped here — nothing is inferred from
// score, popularity, genre, year, or keywords.
const CERT_REGION = 'US'; // US certification labels are used for the age-rating filter
const CERT_MAP = {
    'G': 'G/U',    'TV-Y': 'G/U',  'TV-Y7': 'G/U', 'TV-G': 'G/U',
    'PG': 'PG',    'TV-PG': 'PG',
    'PG-13': 'PG-13', 'TV-14': 'PG-13',
    'R': 'R',  'NC-17': 'R', 'TV-MA': 'R',
};
// TMDB discover/movie supports certification filtering natively; R uses
// certification.gte so it also captures NC-17 (a stricter rating than R).
const MOVIE_CERT_DISCOVER_PARAMS = {
    'G/U':   { certification: 'G' },
    'PG':    { certification: 'PG' },
    'PG-13': { certification: 'PG-13' },
    'R': { 'certification.gte': 'R' },
};
// Maps each supported rating category to a color class for the badge
// (see .age-badge.rating-* rules in styles.css).
const CERT_COLOR_CLASS = {
    'G/U':   'rating-g',
    'PG':    'rating-pg',
    'PG-13': 'rating-pg13',
    'R':     'rating-r',
};
const CERT_CACHE_KEY = 'ch_cert_cache_v2'; // avoids re-fetching certifications already looked up (v2: bumped so stale "R/17+" cache entries from before the R rename get discarded)
let certCache = JSON.parse(localStorage.getItem(CERT_CACHE_KEY) || '{}'); // `${type}_${id}` -> category | null

// ── EMBEDDED STREAMING PROVIDERS ─────────────────────
// These are the ONLY active embedded providers. They are a completely
// separate system from the direct-source engine (direct-streaming.js +
// cinehub-player.js): embedded providers always use their own iframe
// player and are NEVER automatically selected or used as an automatic
// fallback — the user must manually tap one (see renderSources /
// playSource below and rule set in the direct-streaming.js header).
//
// AutoEmbed, MoviesAPI, EmbedSu, and vidsrc.wtf have been removed from
// this active list per the current provider policy. Their old getUrl
// implementations aren't needed anymore, so they were dropped rather than
// kept dead in this file — restore them here if they need to come back.
const SOURCES = [
    {
        name: 'VidSrc.me',
        recommended: true,
        getUrl: (imdb, type, s, e) =>
            type === 'movie'
                ? `https://vidsrc.me/embed/movie?imdb=${imdb}`
                : `https://vidsrc.me/embed/tv?imdb=${imdb}&season=${s}&episode=${e}`
    },
    {
        name: '2Embed',
        getUrl: (imdb, type, s, e) =>
            type === 'movie'
                ? `https://2embed.cc/embed/${imdb}`
                : `https://2embed.cc/embedtv/${imdb}?s=${s}&e=${e}`
    },
    {
        name: 'VidNest',
        recommended: true,
        getUrl: (imdb, type, s, e) => {
            const tmdbId = currentItem?.id;
            return type === 'movie'
                ? `https://vidnest.fun/movie/${tmdbId}`
                : `https://vidnest.fun/tv/${tmdbId}/${s}/${e}`;
        }
    },
    {
        name: 'SmashyStream',
        getUrl: (imdb, type, s, e) =>
            type === 'movie'
                ? `https://embed.smashystream.com/playere.php?imdb=${imdb}`
                : `https://embed.smashystream.com/playere.php?tvimdb=${imdb}&season=${s}&episode=${e}`
    },
    {
        name: 'NontonGo',
        getUrl: (imdb, type, s, e) =>
            type === 'movie'
                ? `https://nontongo.win/embed/movie/${imdb}`
                : `https://nontongo.win/embed/tv/${imdb}/${s}/${e}`
    }
];

// ── DOM REFS ─────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// Sections
const moviesSection   = $('movies-section');
const tvSection       = $('tvshows-section');

// Movie elements
const movieGrid       = $('movie-grid');
const movieLoading    = $('movie-loading');
const movieLoadMore   = $('movie-load-more');
const movieSearch     = $('movie-search');
const movieSearchBtn  = $('movie-search-btn');
const movieSearchType = $('movie-search-type');
const movieSuggEl     = $('movie-suggestions');
const movieGenre      = $('movie-genre');
const movieYear       = $('movie-year');
const movieRating     = $('movie-rating');
const movieLanguage   = $('movie-language');
const movieAgeRating  = $('movie-age-rating');
const moviePlatformFilters = $('movie-platform-filters');

// TV elements
const tvGrid          = $('tv-grid');
const tvLoading       = $('tv-loading');
const tvLoadMore      = $('tv-load-more');
const tvSearch        = $('tv-search');
const tvSearchBtn     = $('tv-search-btn');
const tvSearchType    = $('tv-search-type');
const tvSuggEl        = $('tv-suggestions');
const tvGenre         = $('tv-genre');
const tvYear          = $('tv-year');
const tvRating        = $('tv-rating');
const tvLanguage      = $('tv-language');
const tvAgeRating     = $('tv-age-rating');
const tvPlatformFilters = $('tv-platform-filters');

// Recommended For You (new — does not affect existing Similar Movies/TV)
const recommendSection = $('recommended-section');
const recommendRow     = $('recommend-row');
const recommendLoading = $('recommend-loading');

// Modals
const episodeModal    = $('episode-modal');
const episodeModalBody= $('episode-modal-body');
const watchlistModal  = $('watchlist-modal');
const watchlistGrid   = $('watchlist-grid');
const continueModal   = $('continue-modal');
const continueGrid    = $('continue-grid');
const similarModal    = $('similar-modal');
const similarGrid     = $('similar-grid');
const statsModal      = $('stats-modal');
const statsGrid       = $('stats-grid');
const castModal       = $('cast-modal');
const castDetails     = $('cast-details');
const streamingModal  = $('streaming-modal');

// Streaming
const streamingInfo   = $('streaming-info');
const episodeNavBar   = $('episode-nav-bar');
const prevEpBtn       = $('prev-ep-btn');
const nextEpBtn       = $('next-ep-btn');
const currentEpLabel  = $('current-ep-label');
const sourcesGrid     = $('sources-grid');
const sourceCountBadge= $('source-count-badge');
const playerWrap      = $('player-wrap');
const playerIframeWrap= $('player-iframe-wrap');
const nowPlayingLabel = $('now-playing-label');
const activeSourceName= $('active-source-name');
const activeQuality   = $('active-quality');
const notification    = $('notification');

// Direct sources (Stremio addons) — separate system, see direct-streaming.js / cinehub-player.js
const directPlayerWrap       = $('direct-player-wrap');
const directPlayerContainer  = $('direct-player-container');
const directSourcesGrid      = $('direct-sources-grid');
const directSourceCountBadge = $('direct-source-count-badge');
const directSourcesEmpty     = $('direct-sources-empty');
const directNowPlayingLabel  = $('direct-now-playing-label');
const directActiveSourceName = $('direct-active-source-name');
const devDiagToggle          = $('dev-diag-toggle');
const diagnosticsPanel       = $('diagnostics-panel');
let directPlayer = null; // CineHubPlayer instance, created lazily

// ── STATE ────────────────────────────────────────────
let moviePage = 1, movieTotalPages = 1, movieResults = [], movieQuery = '', movieFilters = {}, currentMovieEndpoint = 'movie/now_playing';
let tvPage    = 1, tvTotalPages    = 1, tvResults    = [], tvQuery    = '', tvFilters    = {}, currentTvEndpoint    = 'tv/airing_today';
let watchlist        = JSON.parse(localStorage.getItem('ch_watchlist') || '[]');
let continueWatching = JSON.parse(localStorage.getItem('ch_continue')  || '[]');
let currentItem      = null;
let progressTimer     = null; // interval driving live watch-progress updates
let progressStartedAt = null; // Date.now() when the current playback session began
let progressBaseMin   = 0;    // minutes-in already "banked" (from resume point) when this session started
let progressRuntimeMin= 0;    // known/estimated runtime (minutes) for the item currently playing
let pendingPlayback   = null; // { source, url } — set when a source is picked, consumed on facade click
let movieSuggTimer   = null;
let tvSuggTimer      = null;
let trendingItems    = [];
let trendingFetchedAt = null;
let movieGenreMap    = {};   // id → name
let tvGenreMap       = {};   // id → name

// ── INIT ─────────────────────────────────────────────
async function init() {
    $('current-year').textContent = new Date().getFullYear();
    populateYears();
    setupListeners();
    await Promise.all([
        loadTrendingHeader(),
        fetchGenres('movie', movieGenre),
        fetchGenres('tv', tvGenre),
    ]);
    await loadPlatformProviders();
    renderPlatformFilters();
    const savedPlatform = localStorage.getItem(PLATFORM_STORAGE_KEY) || '';
    if (savedPlatform) {
        // Restore the user's last selected streaming platform (no extra/duplicate fetch)
        movieFilters.platform = savedPlatform;
        tvFilters.platform    = savedPlatform;
        updatePlatformButtonsUI(savedPlatform);
        showLoading(movieLoading, movieGrid);
        showLoading(tvLoading, tvGrid);
        fetchMoviesDiscover();
        fetchTVDiscover();
    } else {
        fetchMovies(currentMovieEndpoint);
        fetchTVShows(currentTvEndpoint);
    }
    loadRecommendations();
    setInterval(loadTrendingHeader, 12000);
}

// ── TRENDING HEADER ───────────────────────────────────
let currentHeaderItem = null;

async function loadTrendingHeader() {
    try {
        const now = Date.now();
        if (!trendingItems.length || !trendingFetchedAt || (now - trendingFetchedAt) > 86400000) {
            const d = await api('trending/all/day');
            trendingItems = d.results.filter(r => r.backdrop_path);
            trendingFetchedAt = now;
        }
        if (!trendingItems.length) return;
        const item = trendingItems[Math.floor(Math.random() * trendingItems.length)];
        currentHeaderItem = item;
        const img = new Image();
        img.onload = () => {
            const h = $('dynamic-header');
            h.style.backgroundImage = `url('${IMG}original${item.backdrop_path}')`;
            // First image has arrived — the hero shimmer never shows again
            // (later rotations already have their own smooth crossfade).
            $('header-bg')?.classList.remove('skel-loading');
            const titleEl = $('header-title');
            const tagEl   = $('header-tagline');
            // Brief fade so the title/tagline change smoothly alongside the background crossfade
            if (titleEl) titleEl.style.opacity = '0';
            if (tagEl)   tagEl.style.opacity = '0';
            setTimeout(() => {
                if (titleEl) {
                    titleEl.innerHTML = `${escHtml(item.title || item.name)}<br><em>${item.release_date?.slice(0,4) || item.first_air_date?.slice(0,4) || ''}</em>`;
                    titleEl.style.opacity = '1';
                }
                if (tagEl) {
                    tagEl.textContent = item.overview ? item.overview.slice(0, 120) + '…' : 'Now Trending';
                    tagEl.style.opacity = '1';
                }
            }, 220);
            // Wire header action buttons
            const playBtn = $('header-play-btn');
            const infoBtn = $('header-info-btn');
            if (playBtn) {
                playBtn.onclick = () => {
                    if (!currentHeaderItem) return;
                    const type = currentHeaderItem.media_type;
                    if (type === 'movie') window.openMovieStream(currentHeaderItem.id);
                    else window.openTVEpisodes(currentHeaderItem.id);
                };
            }
            if (infoBtn) {
                infoBtn.onclick = () => {
                    if (!currentHeaderItem) return;
                    showCast(currentHeaderItem.id, currentHeaderItem.media_type || 'movie');
                };
            }
        };
        img.src = `${IMG}original${item.backdrop_path}`;
    } catch(e) { console.warn('Header load failed', e); }
}

// ── IMDb TOP 250 ──────────────────────────────────────
async function fetchImdbTop250(more = false) {
    if (!more) { showLoading(movieLoading, movieGrid); movieResults = []; moviePage = 1; }
    try {
        const d = await api('discover/movie', {
            sort_by: 'vote_average.desc',
            'vote_count.gte': 5000,
            'vote_average.gte': 7.5,
            page: moviePage,
        });
        movieTotalPages = d.total_pages;
        renderMovies(d.results, !more);
    } catch { notify('Failed to load IMDb Top 250', 'error'); }
    finally { hideLoading(movieLoading, movieGrid); }
}

// ── SUPERHERO MOVIES (Marvel + DC combined) ───────────
async function fetchSuperheroMovies(more = false) {
    if (!more) { showLoading(movieLoading, movieGrid); movieResults = []; moviePage = 1; }
    try {
        // Fetch Marvel (company 420) and DC (keyword 9715) in parallel
        const [marvelRes, dcRes] = await Promise.all([
            api('discover/movie', {
                sort_by: 'release_date.desc',
                with_companies: '420',    // Marvel Studios
                'vote_count.gte': 100,
                page: moviePage,
            }),
            api('discover/movie', {
                sort_by: 'release_date.desc',
                with_keywords: '9715',    // dc comics
                without_genres: '16',     // exclude Animation
                'vote_count.gte': 200,
                page: moviePage,
            }),
        ]);

        // Merge and deduplicate
        const seen = new Set();
        const merged = [];
        [...marvelRes.results, ...dcRes.results].forEach(m => {
            if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
        });

        // Sort merged list by release date descending
        merged.sort((a, b) => {
            const da = a.release_date || '0000-00-00';
            const db = b.release_date || '0000-00-00';
            return db.localeCompare(da);
        });

        movieTotalPages = Math.max(marvelRes.total_pages, dcRes.total_pages);
        renderMovies(merged, !more);
    } catch { notify('Failed to load superhero movies', 'error'); }
    finally { hideLoading(movieLoading, movieGrid); }
}

// ── API HELPER ────────────────────────────────────────
async function api(endpoint, params = {}) {
    const url = new URL(`${TMDB}/${endpoint}`);
    url.searchParams.set('api_key', API_KEY);
    url.searchParams.set('language', 'en-US');
    Object.entries(params).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, v); });
    const r = await fetch(url);
    if (!r.ok) throw new Error(`TMDB ${r.status}`);
    return r.json();
}

// ── GENRES ───────────────────────────────────────────
async function fetchGenres(type, select) {
    const d = await api(`genre/${type}/list`);
    const map = type === 'movie' ? movieGenreMap : tvGenreMap;
    d.genres.forEach(g => {
        map[g.id] = g.name;
        const o = document.createElement('option');
        o.value = g.id; o.textContent = g.name;
        select.appendChild(o);
    });
}

// ── AGE RATING CERTIFICATION ─────────────────────────
// Resolves a single item's real TMDB certification, mapped to one of the
// 4 supported categories (see CERT_MAP). Results are cached in-memory and
// in localStorage so the same title never triggers a repeat TMDB request.
// Movies use /release_dates; TV uses /content_ratings — never mixed.
async function getCertification(id, type) {
    const key = `${type}_${id}`;
    if (Object.prototype.hasOwnProperty.call(certCache, key)) return certCache[key];
    let category = null;
    try {
        if (type === 'movie') {
            const d = await api(`movie/${id}/release_dates`);
            const us = (d.results || []).find(r => r.iso_3166_1 === CERT_REGION);
            const withCert = (us?.release_dates || []).find(rd => rd.certification);
            category = CERT_MAP[withCert?.certification] || null;
        } else {
            const d = await api(`tv/${id}/content_ratings`);
            const us = (d.results || []).find(r => r.iso_3166_1 === CERT_REGION);
            category = CERT_MAP[us?.rating] || null;
        }
    } catch { category = null; }
    certCache[key] = category;
    try { localStorage.setItem(CERT_CACHE_KEY, JSON.stringify(certCache)); } catch {}
    return category;
}

// Looks up a card's certification (cached) and reveals its badge once
// resolved. No badge is shown if TMDB has no certification for the title.
function attachAgeBadge(card, id, type) {
    getCertification(id, type).then(category => {
        if (!category) return;
        const badge = card.querySelector('[data-age-badge]');
        if (!badge) return;
        badge.textContent = category;
        if (CERT_COLOR_CLASS[category]) badge.classList.add(CERT_COLOR_CLASS[category]);
        badge.style.display = '';
    });
}

// ── RECOMMENDED FOR YOU ────────────────────────────────
// New, self-contained recommendation engine. Reads only from the
// existing `watchlist` / `continueWatching` state (no data-structure
// changes) and reuses `api()`, `createCard()`, `IMG`, genre maps, etc.
// Does NOT touch fetchMovies/fetchTVShows or the "Similar" modal system.
const RECO_CACHE_KEY = 'ch_recommendations'; // new key — only new storage needed
const RECO_CACHE_TTL = 3 * 60 * 60 * 1000;   // 3h — avoids refetching on every reload

async function loadRecommendations() {
    try {
        // Serve from cache when fresh to avoid unnecessary API calls
        const cached = JSON.parse(localStorage.getItem(RECO_CACHE_KEY) || 'null');
        if (cached && cached.at && (Date.now() - cached.at) < RECO_CACHE_TTL && cached.items?.length) {
            renderRecommendations(cached.items);
            return;
        }
        // Skeleton cards (in the row itself) replace the old spinner —
        // section must be visible for the row to show while loading.
        recommendSection.style.display = '';
        renderSkeletonCards(recommendRow, 6);
        const items = await computeRecommendations();
        if (items.length) {
            localStorage.setItem(RECO_CACHE_KEY, JSON.stringify({ at: Date.now(), items }));
        }
        renderRecommendations(items);
    } catch (e) {
        console.warn('Recommendations failed', e);
        recommendSection.style.display = 'none';
    }
}

async function computeRecommendations() {
    const excludeKeys = new Set([
        ...watchlist.map(w => `${w.type}_${w.id}`),
        ...continueWatching.map(c => `${c.type}_${c.id}`),
    ]);
    const seenKeys = new Set();
    const recs = []; // { item, type, label }

    function addFrom(list, type, label, limit) {
        let added = 0;
        for (const it of (list || [])) {
            if (added >= limit) break;
            if (!it || !it.poster_path) continue;
            const key = `${type}_${it.id}`;
            if (seenKeys.has(key) || excludeKeys.has(key)) continue;
            seenKeys.add(key);
            recs.push({ item: it, type, label });
            added++;
        }
    }

    const hasHistory = continueWatching.length > 0 || watchlist.length > 0;

    if (hasHistory) {
        // 1) Genres from watch history (Continue Watching) — fetch details for the
        //    most recent few items only, to keep API calls minimal.
        const recentHistory = continueWatching.slice(0, 5);
        const historyDetails = await Promise.all(
            recentHistory.map(h => api(`${h.type}/${h.id}`).catch(() => null))
        );
        const historyGenreCount = {};
        let sourceCollection = null;
        historyDetails.forEach(d => {
            if (!d) return;
            (d.genres || []).forEach(g => { historyGenreCount[g.id] = (historyGenreCount[g.id] || 0) + 1; });
            if (!sourceCollection && d.belongs_to_collection) sourceCollection = d.belongs_to_collection;
        });
        const topHistoryGenreId = Object.keys(historyGenreCount).sort((a, b) => historyGenreCount[b] - historyGenreCount[a])[0];

        if (topHistoryGenreId) {
            const genreName = movieGenreMap[topHistoryGenreId] || tvGenreMap[topHistoryGenreId] || 'similar';
            const d = await api('discover/movie', { with_genres: topHistoryGenreId, sort_by: 'popularity.desc' }).catch(() => ({ results: [] }));
            addFrom(d.results, 'movie', `Because you watched ${genreName} movies`, 6);
        }

        // 2) Genres from Watchlist (genre_ids are already present on watchlist items)
        const watchlistGenreCount = {};
        watchlist.forEach(w => (w.genre_ids || []).forEach(id => { watchlistGenreCount[id] = (watchlistGenreCount[id] || 0) + 1; }));
        const topWatchlistGenreId = Object.keys(watchlistGenreCount).sort((a, b) => watchlistGenreCount[b] - watchlistGenreCount[a])[0];

        if (topWatchlistGenreId) {
            const d = await api('discover/movie', { with_genres: topWatchlistGenreId, sort_by: 'popularity.desc' }).catch(() => ({ results: [] }));
            addFrom(d.results, 'movie', 'Based on your Watchlist', 6);
        }

        // 3) Same collection as a recently watched movie
        if (sourceCollection) {
            const d = await api(`collection/${sourceCollection.id}`).catch(() => null);
            if (d) addFrom(d.parts, 'movie', 'From the Same Collection', 6);
        }

        const bestGenreId = topHistoryGenreId || topWatchlistGenreId;

        // 4) Highly rated titles (TMDB rating above 7.5) matching the user's interests
        if (bestGenreId) {
            const d = await api('discover/movie', {
                with_genres: bestGenreId, 'vote_average.gte': 7.5, 'vote_count.gte': 200, sort_by: 'vote_average.desc',
            }).catch(() => ({ results: [] }));
            addFrom(d.results, 'movie', 'Similar Genre', 6);
        }

        // 5) Popular titles matching the user's interests
        if (bestGenreId) {
            const d = await api('discover/movie', { with_genres: bestGenreId, sort_by: 'popularity.desc', page: 2 }).catch(() => ({ results: [] }));
            addFrom(d.results, 'movie', 'Popular Right Now', 6);
        }
    } else {
        // No watch history — fall back to Trending / Popular / Top Rated
        const [trending, popular, topRated] = await Promise.all([
            api('trending/movie/day').catch(() => ({ results: [] })),
            api('movie/popular').catch(() => ({ results: [] })),
            api('movie/top_rated').catch(() => ({ results: [] })),
        ]);
        addFrom(trending.results, 'movie', 'Popular Right Now', 6);
        addFrom(popular.results, 'movie', 'Popular Right Now', 6);
        addFrom(topRated.results, 'movie', 'Popular Right Now', 6);
    }

    return recs.slice(0, 20);
}

function renderRecommendations(recs) {
    recommendRow.innerHTML = '';
    if (!recs || !recs.length) { recommendSection.style.display = 'none'; return; }
    recommendSection.style.display = '';
    const frag = document.createDocumentFragment();
    recs.forEach(r => {
        // Reuse the existing card component completely — only add a small reason label
        const card = createCard(r.item, r.type);
        const badge = document.createElement('div');
        badge.className = 'reco-label';
        badge.textContent = r.label;
        badge.title = r.label;
        card.prepend(badge);
        frag.appendChild(card);
    });
    recommendRow.appendChild(frag);
    updateWatchlistBtns();
}

function populateYears() {
    const y = new Date().getFullYear();
    [movieYear, tvYear].forEach(sel => {
        for (let yr = y; yr >= 1950; yr--) {
            const o = document.createElement('option');
            o.value = yr; o.textContent = yr;
            sel.appendChild(o);
        }
    });
}

// ── EVENT LISTENERS ───────────────────────────────────
function setupListeners() {
    // Recommended For You row: let mouse-wheel scroll move the row
    // horizontally (like other streaming sites) instead of just scrolling
    // the page vertically while the cursor happens to be over it. Only
    // takes over the wheel event when the row actually has horizontal
    // room to scroll, so normal page scrolling still works at its edges.
(function setupRecommendRowDrag() {
    const row = recommendRow;
    if (!row) return;

    const DRAG_THRESHOLD = 6; // px of horizontal movement before we treat this as an intentional drag, not a tap/click
    let pointerId = null;
    let isDragging = false;   // threshold exceeded — actively driving scrollLeft
    let startX = 0;
    let startScrollLeft = 0;

    row.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return; // left-click / primary touch or pen only
        pointerId = e.pointerId;
        isDragging = false;
        startX = e.clientX;
        startScrollLeft = row.scrollLeft;
    });

    row.addEventListener('pointermove', (e) => {
        if (pointerId === null || e.pointerId !== pointerId) return;
        const dx = e.clientX - startX;

        if (!isDragging) {
            // Below threshold: could still become a tap, or (on touch) a vertical
            // page-scroll gesture the browser is handling natively — do nothing yet.
            if (Math.abs(dx) < DRAG_THRESHOLD) return;
            isDragging = true;
            row.classList.add('dragging');
            try { row.setPointerCapture(pointerId); } catch (_) {}
        }

        // Reaching here means the browser handed us this gesture (for touch,
        // it never natively pans this element horizontally — see touch-action
        // in CSS — so this is the only thing moving scrollLeft).
        row.scrollLeft = startScrollLeft - dx;
        e.preventDefault();
    }, { passive: false });

    function endDrag(e) {
        if (pointerId !== null) {
            try { row.releasePointerCapture(pointerId); } catch (_) {}
        }
        if (isDragging) {
            // Swallow the click that fires right after this pointer sequence,
            // so dragging a card doesn't also open its details.
            const suppressClick = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
            row.addEventListener('click', suppressClick, { capture: true, once: true });
            setTimeout(() => row.removeEventListener('click', suppressClick, { capture: true }), 0);
        }
        pointerId = null;
        isDragging = false;
        row.classList.remove('dragging');
    }

    row.addEventListener('pointerup', endDrag);
    row.addEventListener('pointercancel', endDrag);
    row.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'mouse') endDrag(e); // touch/pen already end via pointerup/cancel
    });
})();
    // Section nav
    $$('.nav-btn[data-section]').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            switchSection(btn.dataset.section);
        });
    });

    $('watchlist-nav-btn').addEventListener('click', openWatchlist);
    $('continue-nav-btn').addEventListener('click', openContinue);
    $('watchlist-nav-btn-m')?.addEventListener('click', openWatchlist);
    $('continue-nav-btn-m')?.addEventListener('click', openContinue);
    $('footer-watchlist')?.addEventListener('click', e => { e.preventDefault(); openWatchlist(); });
    $('footer-continue')?.addEventListener('click', e => { e.preventDefault(); openContinue(); });
    $('stats-nav-btn')?.addEventListener('click', openStats);
    $('stats-nav-btn-m')?.addEventListener('click', openStats);
    $('footer-stats')?.addEventListener('click', e => { e.preventDefault(); openStats(); });

    // Movie sub-nav
    $$('[data-movie-endpoint]').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('[data-movie-endpoint]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMovieEndpoint = btn.dataset.movieEndpoint;
            moviePage = 1; movieQuery = ''; movieFilters = {};
            resetSearchInput(movieSearch, movieSuggEl);
            resetStreamingPlatform(); // curated tabs exit platform/discover mode, same as Reset Filters
            if      (currentMovieEndpoint === 'imdb_top_250')      fetchImdbTop250();
            else if (currentMovieEndpoint === 'superhero_movies')  fetchSuperheroMovies();
            else fetchMovies(currentMovieEndpoint);
        });
    });

    // TV sub-nav
    $$('[data-tv-endpoint]').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('[data-tv-endpoint]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTvEndpoint = btn.dataset.tvEndpoint;
            tvPage = 1; tvQuery = ''; tvFilters = {};
            resetSearchInput(tvSearch, tvSuggEl);
            resetStreamingPlatform(); // curated tabs exit platform/discover mode, same as Reset Filters
            fetchTVShows(currentTvEndpoint);
        });
    });

    // Search
    setupSearch(movieSearch, movieSearchBtn, movieSuggEl, movieSearchType, 'movie');
    setupSearch(tvSearch, tvSearchBtn, tvSuggEl, tvSearchType, 'tv');

    // Filters
    $('movie-apply-filters').addEventListener('click', applyMovieFilters);
    $('movie-reset-filters').addEventListener('click', resetMovieFilters);
    $('movie-random').addEventListener('click', getRandom.bind(null, 'movie'));
    $('tv-apply-filters').addEventListener('click', applyTVFilters);
    $('tv-reset-filters').addEventListener('click', resetTVFilters);
    $('tv-random').addEventListener('click', getRandom.bind(null, 'tv'));

    // Load more
    movieLoadMore.addEventListener('click', loadMoreMovies);
    tvLoadMore.addEventListener('click', loadMoreTV);

    // Modal closes
    document.querySelector('.close-episode')?.addEventListener('click', () => closeModal(episodeModal));
    document.querySelector('.close-watchlist')?.addEventListener('click', () => closeModal(watchlistModal));
    document.querySelector('.close-continue')?.addEventListener('click', () => closeModal(continueModal));
    document.querySelector('.close-similar')?.addEventListener('click', () => closeModal(similarModal));
    document.querySelector('.close-stats')?.addEventListener('click', () => closeModal(statsModal));
    document.querySelector('.close-cast')?.addEventListener('click', () => closeModal(castModal));
    document.querySelector('.close-streaming')?.addEventListener('click', closeStreamingModal);

    // Click outside modal — NOT for streaming modal to prevent misclick
    document.addEventListener('click', e => {
        [episodeModal, watchlistModal, continueModal, similarModal, castModal, statsModal].forEach(m => {
            if (e.target === m) closeModal(m);
        });
        // Streaming modal — close on outside click only if no player is active
        if (e.target === streamingModal) {
            const playerActive = (playerWrap && playerWrap.style.display !== 'none') ||
                                  (directPlayerWrap && directPlayerWrap.style.display !== 'none');
            if (!playerActive) closeStreamingModal();
        }
        if (e.target === $('addon-manager-modal')) closeModal($('addon-manager-modal'));
    });

    // Episode nav
    prevEpBtn?.addEventListener('click', () => navigateEpisode(-1));
    nextEpBtn?.addEventListener('click', () => navigateEpisode(1));

    // Back to Episodes button
    $('back-to-episodes-btn')?.addEventListener('click', () => {
        if (currentItem && currentItem.media_type === 'tv') {
            closeStreamingModal();
            window.openTVEpisodes(currentItem.showId || currentItem.id);
        }
    });

    // ── developer diagnostics + addon manager (dev mode only) ──
    devDiagToggle?.addEventListener('click', () => {
        if (!diagnosticsPanel) return;
        diagnosticsPanel.style.display = diagnosticsPanel.style.display === 'none' ? 'block' : 'none';
        if (typeof window.CH_renderDiagnosticsPanel === 'function') window.CH_renderDiagnosticsPanel();
    });

    // 5 clicks on the footer copy within 3s toggles developer mode
    let devClickCount = 0, devClickTimer = null;
    $('footer-dev-trigger')?.addEventListener('click', () => {
        devClickCount++;
        clearTimeout(devClickTimer);
        devClickTimer = setTimeout(() => { devClickCount = 0; }, 3000);
        if (devClickCount >= 5) {
            devClickCount = 0;
            const next = !window.CH_isDevMode();
            window.CH_setDevMode(next);
            notify(next ? 'Developer mode enabled' : 'Developer mode disabled', 'success');
        }
    });

    $('footer-addon-manager')?.addEventListener('click', e => {
        e.preventDefault();
        renderAddonManager();
        openModal($('addon-manager-modal'));
    });
    document.querySelector('.close-addon-manager')?.addEventListener('click', () => closeModal($('addon-manager-modal')));

    $('addon-manager-add-btn')?.addEventListener('click', () => {
        const name = $('addon-manager-name').value.trim();
        const url = $('addon-manager-url').value.trim();
        if (!url) { notify('Manifest URL required', 'warning'); return; }
        window.CineHubDirectStreaming.AddonManager.add({ name: name || url, manifestUrl: url });
        $('addon-manager-name').value = '';
        $('addon-manager-url').value = '';
        renderAddonManager();
        notify('Addon added', 'success');
    });

    refreshDevUI();
    window.CH_refreshDevUI = refreshDevUI;
}

function refreshDevUI() {
    const on = window.CH_isDevMode ? window.CH_isDevMode() : false;
    if (devDiagToggle) devDiagToggle.style.display = on ? 'inline-flex' : 'none';
    const link = $('footer-addon-manager');
    if (link) link.style.display = on ? 'inline' : 'none';
    if (!on && diagnosticsPanel) diagnosticsPanel.style.display = 'none';
}

function renderAddonManager() {
    const listEl = $('addon-manager-list');
    if (!listEl || !window.CineHubDirectStreaming) return;
    const addons = window.CineHubDirectStreaming.AddonManager.list();
    listEl.innerHTML = addons.map(a => `
        <div class="addon-manager-row" data-url="${escHtml(a.manifestUrl)}">
            <input type="checkbox" class="amr-enabled" ${a.enabled ? 'checked' : ''} title="Enabled">
            <span class="amr-name">${escHtml(a.name)}</span>
            <span class="amr-url">${escHtml(a.manifestUrl)}</span>
            <button class="amr-refresh" title="Refresh manifest"><i class="fas fa-rotate"></i></button>
            <button class="amr-test" title="Test manifest">Test</button>
            <button class="amr-remove" title="Remove"><i class="fas fa-trash"></i></button>
        </div>
    `).join('') || '<div class="sources-empty-msg">No addons configured.</div>';

    listEl.querySelectorAll('.addon-manager-row').forEach(row => {
        const url = row.dataset.url;
        row.querySelector('.amr-enabled').addEventListener('change', e => {
            window.CineHubDirectStreaming.AddonManager.toggle(url, e.target.checked);
        });
        row.querySelector('.amr-remove').addEventListener('click', () => {
            window.CineHubDirectStreaming.AddonManager.remove(url);
            renderAddonManager();
        });
        row.querySelector('.amr-refresh').addEventListener('click', async () => {
            try { await window.CineHubDirectStreaming.AddonManager.refreshManifest(url); notify('Manifest refreshed', 'success'); }
            catch (e) { notify('Refresh failed: ' + e.message, 'error'); }
        });
        row.querySelector('.amr-test').addEventListener('click', async () => {
            try {
                const m = await window.CineHubDirectStreaming.AddonManager.testManifest(url);
                notify(`${m.name}: stream=${m.supportsStream}, movie=${m.supportsMovie}, series=${m.supportsSeries}`, 'success');
            } catch (e) { notify('Manifest test failed: ' + e.message, 'error'); }
        });
    });
}

function setupSearch(input, btn, suggEl, typeSelect, section) {
    input.addEventListener('input', () => {
        const q = input.value.trim();
        clearTimeout(section === 'movie' ? movieSuggTimer : tvSuggTimer);
        if (q.length < 2) { suggEl.style.display = 'none'; return; }
        const timer = setTimeout(() => fetchSuggestions(q, typeSelect.value, section), 300);
        if (section === 'movie') movieSuggTimer = timer; else tvSuggTimer = timer;
    });
    input.addEventListener('focus', () => {
        if (input.value.trim().length >= 2 && suggEl.children.length > 0) suggEl.style.display = 'block';
    });
    btn.addEventListener('click', () => runSearch(section));
    input.addEventListener('keypress', e => {
        if (e.key === 'Enter') { suggEl.style.display = 'none'; runSearch(section); }
    });
}

// Single document click handler for both suggestion dropdowns
document.addEventListener('click', e => {
    if (!movieSearch.contains(e.target) && !movieSuggEl.contains(e.target)) movieSuggEl.style.display = 'none';
    if (!tvSearch.contains(e.target) && !tvSuggEl.contains(e.target)) tvSuggEl.style.display = 'none';
});

// ── SEARCH ───────────────────────────────────────────
async function runSearch(section) {
    const isMovie = section === 'movie';
    const input = isMovie ? movieSearch : tvSearch;
    const typeSelect = isMovie ? movieSearchType : tvSearchType;
    const q = input.value.trim();
    if (q.length < 2) { notify('Enter at least 2 characters', 'warning'); return; }

    const type = typeSelect.value;
    if (isMovie) { movieQuery = q; movieFilters = {}; moviePage = 1; }
    else          { tvQuery = q; tvFilters = {}; tvPage = 1; }
    updatePlatformButtonsUI(''); // search clears filters, incl. platform — keep buttons in sync

    const suggEl = isMovie ? movieSuggEl : tvSuggEl;
    suggEl.style.display = 'none';

    if (type === 'actor') {
        await searchByActor(q, section);
    } else {
        if (isMovie) { showLoading(movieLoading, movieGrid); await fetchMovieSearch(q); }
        else          { showLoading(tvLoading, tvGrid); await fetchTVSearch(q); }
    }
    // Show back button after search
    showBackBtn(section);
}

function showBackBtn(section) {
    const isMovie = section === 'movie';
    const btnId = isMovie ? 'movie-back-btn' : 'tv-back-btn';
    if ($(btnId)) return;
    const resetBtn = $(isMovie ? 'movie-reset-filters' : 'tv-reset-filters');
    const backBtn = document.createElement('button');
    backBtn.id = btnId;
    backBtn.className = 'pill-btn back-btn';
    backBtn.innerHTML = '<i class="fas fa-arrow-left"></i> Back';
    backBtn.addEventListener('click', () => {
        if (isMovie) resetMovieFilters();
        else resetTVFilters();
    });
    resetBtn.parentNode.insertBefore(backBtn, resetBtn);
}

function hideBackBtn(section) {
    const btn = $(`${section}-back-btn`);
    if (btn) btn.remove();
}

async function fetchSuggestions(q, type, section) {
    const suggEl = section === 'movie' ? movieSuggEl : tvSuggEl;
    try {
        let endpoint = type === 'actor' ? 'search/person' : type === 'movie' ? 'search/movie' : 'search/tv';
        const d = await api(endpoint, { query: q });
        const items = type === 'actor'
            ? d.results.slice(0, 5).map(p => ({ name: p.name, id: p.id, type: 'actor', sub: p.known_for_department || 'Actor' }))
            : d.results.slice(0, 5).map(i => ({ name: i.title || i.name, id: i.id, type, sub: (i.release_date || i.first_air_date || '').slice(0, 4) }));

        if (!items.length) { suggEl.style.display = 'none'; return; }

        suggEl.innerHTML = items.map(item => `
            <div class="suggestion-item" data-name="${escHtml(item.name)}" data-section="${section}" data-type="${item.type}" data-id="${item.id}">
                <i class="fas fa-${item.type === 'actor' ? 'user' : item.type === 'movie' ? 'film' : 'tv'}"></i>
                <span class="suggestion-name">${escHtml(item.name)}</span>
                <span class="suggestion-year">${item.sub}</span>
            </div>
        `).join('');

        suggEl.querySelectorAll('.suggestion-item').forEach(el => {
            el.addEventListener('click', () => {
                const input = section === 'movie' ? movieSearch : tvSearch;
                input.value = el.dataset.name;
                suggEl.style.display = 'none';
                if (el.dataset.type === 'actor') searchByActor(el.dataset.name, section);
                else runSearch(section);
            });
        });

        suggEl.style.display = 'block';
    } catch { suggEl.style.display = 'none'; }
}

async function searchByActor(name, section) {
    const isMovie = section === 'movie';
    if (isMovie) showLoading(movieLoading, movieGrid); else showLoading(tvLoading, tvGrid);
    try {
        const pData = await api('search/person', { query: name });
        if (!pData.results.length) { notify('No actor found', 'info'); return; }
        const person = pData.results[0];
        const credits = await api(`person/${person.id}/${isMovie ? 'movie' : 'tv'}_credits`);
        const items = credits.cast.sort((a, b) => b.popularity - a.popularity);
        if (isMovie) {
            movieResults = []; movieGrid.innerHTML = '';
            items.forEach(m => { const c = createCard(m, 'movie'); movieGrid.appendChild(c); });
            movieLoadMore.style.display = 'none';
        } else {
            tvResults = []; tvGrid.innerHTML = '';
            items.forEach(s => { const c = createCard(s, 'tv'); tvGrid.appendChild(c); });
            tvLoadMore.style.display = 'none';
        }
        notify(`${items.length} titles found for ${person.name}`, 'success');
    } catch { notify('Search failed', 'error'); }
    finally {
        if (isMovie) hideLoading(movieLoading, movieGrid);
        else hideLoading(tvLoading, tvGrid);
    }
}

// ── FETCH MOVIES ─────────────────────────────────────
async function fetchMovies(endpoint, more = false) {
    if (!more) { showLoading(movieLoading, movieGrid); movieResults = []; }
    try {
        // For TMDB list endpoints (now_playing, popular) we can't force sort_by
        // But for popular we can use discover with release_date.desc
        let d;
        if (endpoint === 'movie/popular') {
            d = await api('discover/movie', {
                sort_by: 'release_date.desc',
                'vote_count.gte': 50,
                page: moviePage,
            });
        } else {
            d = await api(endpoint, { page: moviePage });
            // Sort results by release date newest first
            if (d.results) {
                d.results.sort((a, b) => {
                    const da = a.release_date || '0000-00-00';
                    const db = b.release_date || '0000-00-00';
                    return db.localeCompare(da);
                });
            }
        }
        movieTotalPages = d.total_pages;
        renderMovies(d.results, !more);
    } catch { notify('Failed to load movies', 'error'); }
    finally { hideLoading(movieLoading, movieGrid); }
}

async function fetchMovieSearch(q, more = false) {
    try {
        const d = await api('search/movie', { query: q, page: moviePage });
        if (!d.results.length) notify('No results found', 'info');
        movieTotalPages = d.total_pages;
        renderMovies(d.results, !more);
    } catch { notify('Search failed', 'error'); }
    finally { hideLoading(movieLoading, movieGrid); }
}

async function fetchMoviesDiscover(more = false) {
    // Sorting by release date needs a minimum vote-count floor, otherwise    // TMDB surfaces obscure/undated entries ahead of real releases —
    // same guard used elsewhere in the app (fetchMovies' Popular tab, fetchTVSorted).
    let params = { page: moviePage, sort_by: 'primary_release_date.desc', 'vote_count.gte': 20 };
    if (movieFilters.genre)    params.with_genres = movieFilters.genre;
    if (movieFilters.year)     params.primary_release_year = movieFilters.year;
    if (movieFilters.rating)   params['vote_average.gte'] = movieFilters.rating;
    if (movieFilters.language) params.with_original_language = movieFilters.language;
    if (movieFilters.platform) { params.with_watch_providers = movieFilters.platform; params.watch_region = WATCH_REGION; }
    // Age Rating — TMDB discover/movie supports certification filtering natively
    if (movieFilters.ageRating && MOVIE_CERT_DISCOVER_PARAMS[movieFilters.ageRating]) {
        params.certification_country = CERT_REGION;
        Object.assign(params, MOVIE_CERT_DISCOVER_PARAMS[movieFilters.ageRating]);
    }
    try {
        const d = await api('discover/movie', params);
        if (!d.results.length) notify('No movies match filters', 'info');
        movieTotalPages = d.total_pages;
        renderMovies(d.results, !more);
    } catch { notify('Failed to apply filters', 'error'); }
    finally { hideLoading(movieLoading, movieGrid); }
}

// ── FETCH TV ──────────────────────────────────────────
// Popular streaming service network IDs on TMDB:
// Netflix=213, Amazon=1024, Disney+=2739, HBO=49, Apple TV+=2552, Hulu=453, Peacock=3353, Paramount+=4330
const PREMIUM_NETWORKS = '213|1024|2739|49|2552|453|3353|4330';

async function fetchTVShows(endpoint, more = false) {
    if (!more) { showLoading(tvLoading, tvGrid); tvResults = []; }
    try {
        // All default tab loads use the sorted/premium-first logic
        if (!more) {
            await fetchTVSorted(endpoint, false);
            return;
        }
        const d = await api(endpoint, { page: tvPage });
        tvTotalPages = d.total_pages;
        renderTV(d.results, false);
    } catch { notify('Failed to load TV shows', 'error'); }
    finally { hideLoading(tvLoading, tvGrid); }
}

// Fetch TV sorted: newest year first, premium networks prioritised
async function fetchTVSorted(endpoint = 'tv/airing_today', more = false) {
    const currentYear = new Date().getFullYear();
    try {
        // Determine base sort: on_the_air / airing_today → date desc; popular → popularity; top_rated → vote
        let baseSort = 'first_air_date.desc';
        if (endpoint === 'tv/popular')   baseSort = 'popularity.desc';
        if (endpoint === 'tv/top_rated') baseSort = 'vote_average.desc';

        // Fetch 1: premium streaming networks, current + last year, sorted
        const [premiumRes, broadRes] = await Promise.all([
            api('discover/tv', {
                page: tvPage,
                sort_by: baseSort,
                'first_air_date.gte': `${currentYear - 1}-01-01`,
                with_networks: PREMIUM_NETWORKS,
                'vote_count.gte': 10,
            }),
            api('discover/tv', {
                page: tvPage,
                sort_by: baseSort,
                'first_air_date.gte': `${currentYear - 3}-01-01`,
                'vote_count.gte': 20,
            })
        ]);

        // Merge: premium first, then broad, deduplicated
        const seen = new Set();
        const merged = [];
        [...premiumRes.results, ...broadRes.results].forEach(s => {
            if (!seen.has(s.id)) { seen.add(s.id); merged.push(s); }
        });

        // Sort: newest release date first, exact day-level precision
        merged.sort((a, b) => {
            const da = a.first_air_date || '0000-00-00';
            const db = b.first_air_date || '0000-00-00';
            return db.localeCompare(da);
        });

        tvTotalPages = Math.max(premiumRes.total_pages, broadRes.total_pages);
        renderTV(merged, !more);
    } catch { notify('Failed to load TV shows', 'error'); }
    finally { hideLoading(tvLoading, tvGrid); }
}

async function fetchTVSearch(q, more = false) {
    try {
        const d = await api('search/tv', { query: q, page: tvPage });
        if (!d.results.length) notify('No results found', 'info');
        tvTotalPages = d.total_pages;
        renderTV(d.results, !more);
    } catch { notify('Search failed', 'error'); }
    finally { hideLoading(tvLoading, tvGrid); }
}

async function fetchTVDiscover(more = false) {
    // Same vote-count floor as fetchMoviesDiscover — keeps date-sorted
    // results meaningful instead of surfacing obscure/undated entries.
    let params = { page: tvPage, sort_by: 'first_air_date.desc', 'vote_count.gte': 20 };
    if (tvFilters.genre)    params.with_genres = tvFilters.genre;
    if (tvFilters.year)     params.first_air_date_year = tvFilters.year;
    if (tvFilters.rating)   params['vote_average.gte'] = tvFilters.rating;
    if (tvFilters.language) params.with_original_language = tvFilters.language;
    if (tvFilters.platform) { params.with_watch_providers = tvFilters.platform; params.watch_region = WATCH_REGION; }
    try {
        const d = await api('discover/tv', params);
        let results = d.results;
        // Age Rating — TMDB's discover/tv has no certification parameter,
        // so matching shows are resolved (cached) and filtered client-side.
        // Titles with no TMDB content rating are excluded, per spec.
        if (tvFilters.ageRating) {
            const cats = await Promise.all(results.map(s => getCertification(s.id, 'tv')));
            results = results.filter((s, i) => cats[i] === tvFilters.ageRating);
        }
        if (!results.length) notify('No shows match filters', 'info');
        tvTotalPages = d.total_pages;
        renderTV(results, !more);
    } catch { notify('Failed to apply filters', 'error'); }
    finally { hideLoading(tvLoading, tvGrid); }
}

// Fetch the actual provider catalogue for Bangladesh. TMDB provider IDs are
// global, but which services are available differs by region.
async function loadPlatformProviders() {
    try {
        const [movies, shows] = await Promise.all([
            api('watch/providers/movie', { watch_region: WATCH_REGION }),
            api('watch/providers/tv', { watch_region: WATCH_REGION })
        ]);
        const merged = new Map();
        [...(movies.results || []), ...(shows.results || [])].forEach(provider => {
            if (!merged.has(String(provider.provider_id))) {
                merged.set(String(provider.provider_id), {
                    id: String(provider.provider_id),
                    label: provider.provider_name,
                    priority: Number(provider.display_priority) || 999
                });
            }
        });
        STREAMING_PLATFORMS = [
            { id: '', label: 'All' },
            ...[...merged.values()]
                .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label))
                .slice(0, 14)
        ];
    } catch (error) {
        console.warn('Could not load Bangladesh streaming providers from TMDB:', error);
        STREAMING_PLATFORMS = [{ id: '', label: 'All' }];
    }
}

// ── STREAMING PLATFORM FILTER ────────────────────────
// Extends the existing filter system: reuses fetchMoviesDiscover/fetchTVDiscover,
// the filters-bar UI language, and hideBackBtn/resetSearchInput helpers.
function renderPlatformFilters() {
    [moviePlatformFilters, tvPlatformFilters].forEach(bar => {
        if (!bar) return;
        bar.innerHTML = '';
        const frag = document.createDocumentFragment();
        STREAMING_PLATFORMS.forEach(p => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'platform-btn' + (p.id === '' ? ' active' : ''); // "All" active by default
            btn.textContent = p.label;
            btn.dataset.platform = p.id;
            btn.addEventListener('click', () => selectStreamingPlatform(p.id));
            frag.appendChild(btn);
        });
        bar.appendChild(frag);
    });
}

function updatePlatformButtonsUI(id) {
    [moviePlatformFilters, tvPlatformFilters].forEach(bar => {
        if (!bar) return;
        bar.querySelectorAll('.platform-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.platform === (id || ''));
        });
    });
}

// Selecting a platform updates both Movies and TV filters/grids at once, so
// whichever section the user is on (or switches to) already reflects it —
// no manual re-selection needed per section.
function selectStreamingPlatform(id) {
    if (id) {
        movieFilters = { ...movieFilters, platform: id };
        tvFilters    = { ...tvFilters, platform: id };
    } else {
        delete movieFilters.platform;
        delete tvFilters.platform;
    }
    localStorage.setItem(PLATFORM_STORAGE_KEY, id || '');
    updatePlatformButtonsUI(id);

    moviePage = 1; movieQuery = ''; resetSearchInput(movieSearch, movieSuggEl); hideBackBtn('movie');
    tvPage = 1;    tvQuery = '';    resetSearchInput(tvSearch, tvSuggEl);       hideBackBtn('tv');

    showLoading(movieLoading, movieGrid);
    showLoading(tvLoading, tvGrid);
    fetchMoviesDiscover();
    fetchTVDiscover();
}

// Clears the platform selection only (used by Reset Filters); does not fetch
// itself since callers already trigger their own fetch right after.
function resetStreamingPlatform() {
    delete movieFilters.platform;
    delete tvFilters.platform;
    localStorage.removeItem(PLATFORM_STORAGE_KEY);
    updatePlatformButtonsUI('');
}

// ── FILTERS ───────────────────────────────────────────
function applyMovieFilters() {
    movieFilters = { genre: movieGenre.value, year: movieYear.value, rating: movieRating.value, language: movieLanguage.value, ageRating: movieAgeRating.value, platform: movieFilters.platform };
    movieQuery = ''; moviePage = 1;
    resetSearchInput(movieSearch, movieSuggEl);
    showLoading(movieLoading, movieGrid);
    fetchMoviesDiscover();
}

function resetMovieFilters() {
    movieGenre.value = ''; movieYear.value = ''; movieRating.value = '0'; movieLanguage.value = ''; movieAgeRating.value = '';
    movieFilters = {}; movieQuery = ''; moviePage = 1;
    resetSearchInput(movieSearch, movieSuggEl);
    hideBackBtn('movie');
    resetStreamingPlatform(); // also clear any active platform selection (no extra fetch — reset already fetches below)
    fetchMovies(currentMovieEndpoint);
    notify('Filters reset', 'info');
}

function applyTVFilters() {
    tvFilters = { genre: tvGenre.value, year: tvYear.value, rating: tvRating.value, language: tvLanguage.value, ageRating: tvAgeRating.value, platform: tvFilters.platform };
    tvQuery = ''; tvPage = 1;
    resetSearchInput(tvSearch, tvSuggEl);
    showLoading(tvLoading, tvGrid);
    fetchTVDiscover();
}

function resetTVFilters() {
    tvGenre.value = ''; tvYear.value = ''; tvRating.value = '0'; tvLanguage.value = ''; tvAgeRating.value = '';
    tvFilters = {}; tvQuery = ''; tvPage = 1;
    resetSearchInput(tvSearch, tvSuggEl);
    hideBackBtn('tv');
    resetStreamingPlatform(); // also clear any active platform selection (no extra fetch — reset already fetches below)
    fetchTVShows(currentTvEndpoint);
    notify('Filters reset', 'info');
}

async function getRandom(type) {
    const isMovie = type === 'movie';
    if (isMovie) showLoading(movieLoading, movieGrid); else showLoading(tvLoading, tvGrid);
    try {
        const d = await api(`discover/${type}`, { sort_by: 'popularity.desc', page: 1 });
        const maxP = Math.min(d.total_pages, 100);
        const randP = Math.floor(Math.random() * maxP) + 1;
        const d2 = await api(`discover/${type}`, { sort_by: 'popularity.desc', page: randP });
        const item = d2.results[Math.floor(Math.random() * d2.results.length)];
        if (isMovie) renderMovies([item], true);
        else         renderTV([item], true);
    } catch { notify('Failed to get random', 'error'); }
    finally {
        if (isMovie) hideLoading(movieLoading, movieGrid); else hideLoading(tvLoading, tvGrid);
    }
}

// ── LOAD MORE ─────────────────────────────────────────
async function loadMoreMovies() {
    if (moviePage >= movieTotalPages) return;
    moviePage++;
    movieLoadMore.innerHTML = '<span>Loading…</span>';
    movieLoadMore.disabled = true;
    if      (movieQuery)                                    await fetchMovieSearch(movieQuery, true);
    else if (Object.keys(movieFilters).length)              await fetchMoviesDiscover(true);
    else if (currentMovieEndpoint === 'imdb_top_250')       await fetchImdbTop250(true);
    else if (currentMovieEndpoint === 'superhero_movies')   await fetchSuperheroMovies(true);
    else                                                    await fetchMovies(currentMovieEndpoint, true);
    movieLoadMore.innerHTML = '<span>Load More</span><i class="fas fa-chevron-down"></i>';
    movieLoadMore.disabled = false;
}

async function loadMoreTV() {
    if (tvPage >= tvTotalPages) return;
    tvPage++;
    tvLoadMore.innerHTML = '<span>Loading…</span>';
    tvLoadMore.disabled = true;
    if (tvQuery)                            await fetchTVSearch(tvQuery, true);
    else if (Object.keys(tvFilters).length) await fetchTVDiscover(true);
    else                                    await fetchTVSorted(currentTvEndpoint, true);
    tvLoadMore.innerHTML = '<span>Load More</span><i class="fas fa-chevron-down"></i>';
    tvLoadMore.disabled = false;
}

// ── RENDER CARDS ─────────────────────────────────────
function renderMovies(items, clear) {
    if (clear) { movieResults = []; movieGrid.innerHTML = ''; }
    const fresh = items.filter(m => !movieResults.some(x => x.id === m.id));
    movieResults = [...movieResults, ...fresh];
    const frag = document.createDocumentFragment();
    fresh.forEach(m => frag.appendChild(createCard(m, 'movie')));
    movieGrid.appendChild(frag);
    // Friendly empty state instead of a blank grid (only on a fresh render)
    if (clear && !movieResults.length) {
        movieGrid.innerHTML = emptyState('Nothing to display yet.', 'fas fa-film', 'Start exploring to discover great movies.');
    }
    movieLoadMore.style.display = moviePage < movieTotalPages ? 'block' : 'none';
    updateWatchlistBtns();
}

function renderTV(items, clear) {
    if (clear) { tvResults = []; tvGrid.innerHTML = ''; }
    const fresh = items.filter(s => !tvResults.some(x => x.id === s.id));
    tvResults = [...tvResults, ...fresh];
    const frag = document.createDocumentFragment();
    fresh.forEach(s => frag.appendChild(createCard(s, 'tv')));
    tvGrid.appendChild(frag);
    // Friendly empty state instead of a blank grid (only on a fresh render)
    if (clear && !tvResults.length) {
        tvGrid.innerHTML = emptyState('Nothing to display yet.', 'fas fa-tv', 'Start exploring to discover great shows.');
    }
    tvLoadMore.style.display = tvPage < tvTotalPages ? 'block' : 'none';
    updateWatchlistBtns();
}

function createCard(item, type) {
    const isMovie = type === 'movie';
    const title   = isMovie ? item.title : item.name;
    const date    = isMovie ? item.release_date : item.first_air_date;
    const year    = date ? date.slice(0, 4) : 'N/A';
    // Format full date e.g. "Mar 15, 2025"
    const fullDate = date ? new Date(date).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '';
    const rating  = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
    const poster  = item.poster_path ? `${IMG}w500${item.poster_path}` : PLACEHOLDER;
    // Language display
    const langMap = { en:'English', hi:'Hindi', es:'Spanish', fr:'French', de:'German', ja:'Japanese', ko:'Korean', zh:'Chinese', ar:'Arabic', tr:'Turkish', pt:'Portuguese', ru:'Russian', it:'Italian', th:'Thai' };
    const lang    = item.original_language ? (langMap[item.original_language] || item.original_language.toUpperCase()) : '';

    // Build genre tags — clickable, show up to 2
    const genreMap = isMovie ? movieGenreMap : tvGenreMap;
    const genreIds = (item.genre_ids || []).slice(0, 2);
    const genreTagsHtml = genreIds.length
        ? genreIds.map(id => genreMap[id]
            ? `<span class="genre-tag clickable-genre" data-genre-id="${id}" data-type="${type}" title="Browse ${escHtml(genreMap[id])}">${escHtml(genreMap[id])}</span>`
            : '').join('')
        : '';
    // Row always renders (even with no genres) so the age-rating badge —
    // resolved asynchronously below — has a row to appear in beside the
    // genre tags, per the existing badge layout.
    const genreHtml = `<div class="card-genres">${genreTagsHtml}<span class="age-badge" data-age-badge style="display:none"></span></div>`;

    const card = document.createElement('div');
    card.className = 'content-card';
    card.dataset.id = item.id;
    card.dataset.type = type;

    card.innerHTML = `
        <button class="watchlist-btn ${isInWatchlist(item.id) ? 'added' : ''}" data-id="${item.id}" data-type="${type}" title="Watchlist">
            <i class="fas fa-${isInWatchlist(item.id) ? 'check' : 'bookmark'}"></i>
        </button>
        <img src="${poster}" alt="${escHtml(title)}" class="poster" loading="lazy"
             onerror="this.src='${PLACEHOLDER}'">
        <div class="card-info">
            <div class="card-title" title="${escHtml(title)}">${escHtml(title)}</div>
            <div class="card-meta">
                <span class="card-year">${fullDate || year}</span>
                <span class="card-rating"><i class="fas fa-star"></i> ${rating}</span>
            </div>
            ${lang ? `<div class="card-lang"><i class="fas fa-globe"></i> ${escHtml(lang)}</div>` : ''}
            ${genreHtml}
        </div>
        <div class="card-actions">
            <button class="btn-watch" data-id="${item.id}" data-type="${type}">
                <i class="fas fa-${isMovie ? 'play' : 'list'}"></i> ${isMovie ? 'Watch' : 'Episodes'}
            </button>
            <button class="btn-icon btn-similar" data-id="${item.id}" data-type="${type}" title="Similar">
                <i class="fas fa-film"></i>
            </button>
            <button class="btn-icon btn-cast" data-id="${item.id}" data-type="${type}" title="Cast">
                <i class="fas fa-users"></i>
            </button>
        </div>
    `;

    // Fix 4 — clicking poster opens stream/episodes
    card.querySelector('.poster').addEventListener('click', () => {
        if (isMovie) window.openMovieStream(item.id);
        else window.openTVEpisodes(item.id);
    });

    card.querySelector('.watchlist-btn').addEventListener('click', e => {
        e.stopPropagation();
        toggleWatchlist(item.id, type, item);
    });
    card.querySelector('.btn-watch').addEventListener('click', e => {
        e.stopPropagation();
        if (isMovie) window.openMovieStream(item.id);
        else window.openTVEpisodes(item.id);
    });
    card.querySelector('.btn-similar').addEventListener('click', e => {
        e.stopPropagation();
        showSimilar(item.id, type);
    });
    card.querySelector('.btn-cast').addEventListener('click', e => {
        e.stopPropagation();
        showCast(item.id, type);
    });

    // Fix 6 — clickable genre tags filter by genre
    card.querySelectorAll('.clickable-genre').forEach(tag => {
        tag.addEventListener('click', e => {
            e.stopPropagation();
            const genreId = tag.dataset.genreId;
            const tagType = tag.dataset.type;
            if (tagType === 'movie') {
                movieFilters = { genre: genreId };
                moviePage = 1; movieQuery = '';
                resetSearchInput(movieSearch, movieSuggEl);
                switchSection('movies');
                showLoading(movieLoading, movieGrid);
                fetchMoviesDiscover();
                notify(`Browsing genre: ${tag.textContent}`, 'info');
            } else {
                tvFilters = { genre: genreId };
                tvPage = 1; tvQuery = '';
                resetSearchInput(tvSearch, tvSuggEl);
                switchSection('tvshows');
                showLoading(tvLoading, tvGrid);
                fetchTVDiscover();
                notify(`Browsing genre: ${tag.textContent}`, 'info');
            }
        });
    });

    // Age rating badge — resolved asynchronously (cached) so it never
    // blocks the card from rendering; stays hidden if TMDB has no rating.
    // Rendered beside the genre tags (see .card-genres above), not on the poster.
    attachAgeBadge(card, item.id, type);

    return card;
}

// ── STREAMING ─────────────────────────────────────────
window.openMovieStream = async function(movieId) {
    // Open immediately with a skeleton (replaces the old "Loading..." toast)
    // so the modal responds instantly; real details swap in once fetched.
    episodeNavBar.style.display = 'none';
    streamingInfo.innerHTML = renderStreamingSkeleton();
    sourcesGrid.innerHTML = '';
    openModal(streamingModal);
    try {
        const movie = await api(`movie/${movieId}`, { append_to_response: 'external_ids' });
        const imdb = movie.imdb_id || movie.external_ids?.imdb_id;
        if (!imdb) { notify('Could not find streaming ID', 'error'); closeModal(streamingModal); return; }

        const saved = continueWatching.find(x => x.id == movieId && x.type === 'movie');

        currentItem = { ...movie, media_type: 'movie', imdb_id: imdb,
            progress: saved?.progress || 0, lastSource: saved?.lastSource || null,
            runtimeMin: movie.runtime || null };

        streamingInfo.innerHTML = buildStreamingInfo(
            movie.poster_path, movie.title,
            movie.release_date?.slice(0,4), movie.vote_average,
            movie.runtime ? movie.runtime + ' min' : null,
            movie.overview,
            movie.backdrop_path
        );

        renderSources(imdb, 'movie', null, null, saved?.lastSource);

        const resumeSeconds = (saved?.progress && movie.runtime) ? (saved.progress / 100) * movie.runtime * 60 : 0;
        renderDirectSources({ imdbId: imdb, tmdbId: movie.id, type: 'movie' }, resumeSeconds);
    } catch(err) { console.error(err); notify('Failed to open stream', 'error'); closeModal(streamingModal); }
};

window.openTVEpisodes = async function(showId) {
    // Full skeleton immediately — nothing about the show is known yet.
    episodeModalBody.innerHTML = renderEpisodeSelectorSkeleton();
    openModal(episodeModal);
    try {
        const show = await api(`tv/${showId}`, { append_to_response: 'external_ids' });
        const imdb = show.external_ids?.imdb_id;
        if (!imdb) { notify('Could not find streaming ID', 'error'); closeModal(episodeModal); return; }

        currentItem = { ...show, media_type: 'tv', imdb_id: imdb, showId };

        const seasons = show.seasons.filter(s => s.season_number > 0);
        const saved = continueWatching.find(x => x.id == showId && x.type === 'tv');
        const startSeason = saved?.season || seasons[0]?.season_number || 1;

        await renderEpisodeSelector(show, imdb, startSeason, saved?.lastSource);
    } catch(err) { console.error(err); notify('Failed to load episodes', 'error'); closeModal(episodeModal); }
};

// Episode-card skeleton — reused by both the full first-open skeleton
// and the lighter grid-only skeleton shown when switching seasons.
function renderEpisodeCardSkeletons(count = 8) {
    return Array.from({ length: count }).map(() => `
        <div class="episode-card skeleton-episode" aria-hidden="true">
            <div class="skel episode-still"></div>
            <div class="episode-info-text" style="flex:1">
                <div class="skel skel-line" style="width:70%;height:13px;margin-bottom:6px"></div>
                <div class="skel skel-line" style="width:95%;height:10px"></div>
                <div class="skel skel-line" style="width:40%;height:10px"></div>
            </div>
        </div>
    `).join('');
}

// Full episode-selector skeleton — shown the instant a TV show is
// clicked, before its name/poster/overview are even known yet.
function renderEpisodeSelectorSkeleton() {
    return `
        <div class="episode-selector-wrap" aria-busy="true">
            <div class="episode-header">
                <div class="skel episode-show-poster" style="aspect-ratio:2/3"></div>
                <div class="episode-show-info" style="flex:1">
                    <div class="skel skel-line" style="width:50%;height:20px;margin-bottom:10px"></div>
                    <div class="skel skel-line" style="width:100%"></div>
                    <div class="skel skel-line" style="width:85%"></div>
                </div>
            </div>
            <div class="episodes-grid">${renderEpisodeCardSkeletons(6)}</div>
        </div>
    `;
}

async function renderEpisodeSelector(show, imdb, seasonNum, savedSource = null) {
    const saved = continueWatching.find(x => x.id == show.id && x.type === 'tv');
    const poster = show.poster_path ? `${IMG}w200${show.poster_path}` : PLACEHOLDER;

    // Header/season-select are already known at this point — render them
    // for real immediately; only the episode list needs to skeleton-load.
    episodeModalBody.innerHTML = `
        <div class="episode-selector-wrap">
            <div class="episode-header">
                <img src="${poster}" alt="${escHtml(show.name)}" class="episode-show-poster">
                <div class="episode-show-info">
                    <h2>${escHtml(show.name)}</h2>
                    <p>${escHtml((show.overview || '').slice(0, 180))}${show.overview?.length > 180 ? '...' : ''}</p>
                    ${saved ? `<div class="resume-notice"><i class="fas fa-play-circle"></i> Resume from S${saved.season} E${saved.episode} (${Math.round(saved.progress)}%)</div>` : ''}
                </div>
            </div>
            <div class="season-select-wrap">
                <label>Season:</label>
                <select id="season-sel" onchange="changeSeason(${show.id}, '${imdb}', this.value, '${savedSource || ''}')">
                    ${show.seasons.filter(s => s.season_number > 0).map(s => `
                        <option value="${s.season_number}" ${s.season_number == seasonNum ? 'selected' : ''}>
                            ${escHtml(s.name)} (${s.episode_count} eps)
                        </option>
                    `).join('')}
                </select>
            </div>
            <div class="episodes-grid" aria-busy="true">${renderEpisodeCardSkeletons(8)}</div>
        </div>
    `;
    openModal(episodeModal);

    const seasonData = await api(`tv/${show.id}/season/${seasonNum}`);
    const episodesGridEl = episodeModalBody.querySelector('.episodes-grid');
    episodesGridEl.innerHTML = seasonData.episodes.map(ep => {
        const isResume = saved && saved.season == seasonNum && saved.episode == ep.episode_number;
        const still = ep.still_path ? `${IMG}w300${ep.still_path}` : PLACEHOLDER_EP;
        return `
            <div class="episode-card ${isResume ? 'resume-ep' : ''}"
                 onclick="playEpisode(${show.id}, '${imdb}', ${seasonNum}, ${ep.episode_number}, '${savedSource || ''}')">
                <img src="${still}" alt="Ep ${ep.episode_number}" class="episode-still"
                     onerror="this.src='${PLACEHOLDER_EP}'">
                <div class="episode-info-text">
                    <h4>E${ep.episode_number}: ${escHtml(ep.name || '')}</h4>
                    <p>${escHtml((ep.overview || 'No description').slice(0, 80))}...</p>
                    <div class="ep-rating"><i class="fas fa-star"></i> ${ep.vote_average?.toFixed(1) || 'N/A'}</div>
                    ${isResume ? '<span class="resume-badge"><i class="fas fa-play"></i> Resume</span>' : ''}
                </div>
            </div>
        `;
    }).join('');
    episodesGridEl.removeAttribute('aria-busy');
}

window.changeSeason = async function(showId, imdb, seasonNum, savedSource) {
    const show = await api(`tv/${showId}`);
    await renderEpisodeSelector(show, imdb, parseInt(seasonNum), savedSource);
};

window.playEpisode = async function(showId, imdb, season, episode, savedSource = null) {
    closeModal(episodeModal);
    await loadEpisode(showId, imdb, season, episode, savedSource);
};

async function loadEpisode(showId, imdb, season, episode, savedSource = null) {
    stopStreaming();
    // Skeleton first so switching episodes feels instant even while the
    // next episode's data is still being fetched.
    streamingInfo.innerHTML = renderStreamingSkeleton();
    sourcesGrid.innerHTML = '';
    directSourcesGrid.innerHTML = '';
    directSourcesEmpty.style.display = 'none';
    directPlayerWrap.style.display = 'none';
    openModal(streamingModal);
    try {
        const show = await api(`tv/${showId}`);
        const seasonData = await api(`tv/${showId}/season/${season}`);
        const totalEps = seasonData.episodes.length;
        const ep = seasonData.episodes.find(e => e.episode_number == episode) || {};
        const saved = continueWatching.find(x => x.id == showId && x.type === 'tv' && x.season == season && x.episode == episode);

        currentItem = {
            ...show, media_type: 'tv', imdb_id: imdb, showId,
            season, episode, totalEpisodes: totalEps,
            progress: saved?.progress || 0, lastSource: savedSource,
            runtimeMin: ep.runtime || show.episode_run_time?.[0] || null
        };

        currentEpLabel.textContent = `S${season} • E${episode} • ${ep.name || ''}`;
        prevEpBtn.disabled = episode <= 1;
        nextEpBtn.disabled = episode >= totalEps;
        episodeNavBar.style.display = 'flex';

        const overview = ep.overview || show.overview || 'No overview.';
        streamingInfo.innerHTML = buildStreamingInfo(
            show.poster_path, show.name,
            show.first_air_date?.slice(0,4), show.vote_average,
            `S${season} E${episode}`,
            overview,
            show.backdrop_path
        );

        renderSources(imdb, 'tv', season, episode, savedSource);

        const epRuntime = ep.runtime || show.episode_run_time?.[0] || null;
        const resumeSeconds = (saved?.progress && epRuntime) ? (saved.progress / 100) * epRuntime * 60 : 0;
        // update-in-place, don't reload the whole website / bounce back to details (rule #16)
        renderDirectSources({ imdbId: imdb, tmdbId: showId, type: 'tv', season, episode }, resumeSeconds);
    } catch(err) { console.error(err); notify('Failed to load episode', 'error'); closeModal(streamingModal); }
}

function navigateEpisode(dir) {
    if (!currentItem) return;
    const newEp = parseInt(currentItem.episode) + dir;
    if (newEp < 1 || newEp > currentItem.totalEpisodes) return;
    loadEpisode(currentItem.showId, currentItem.imdb_id, currentItem.season, newEp, currentItem.lastSource);
}

function buildStreamingInfo(poster, title, year, rating, meta, overview, backdrop) {
    // Use backdrop for the bg (landscape, looks better), fall back to poster
    const bgPath    = backdrop || poster;
    const posterUrl = bgPath   ? `${IMG}original${bgPath}` : null;
    const thumbUrl  = poster   ? `${IMG}w200${poster}` : PLACEHOLDER;
    const bgStyle   = posterUrl
        ? `background: url('${posterUrl}') center/cover no-repeat;`
        : '';
    return `
        <div class="streaming-hero" style="${bgStyle}">
            <div class="streaming-hero-overlay"></div>
            <div class="streaming-hero-content">
                <img src="${thumbUrl}" alt="${escHtml(title)}" class="streaming-poster"
                     onerror="this.src='${PLACEHOLDER}'">
                <div class="streaming-details">
                    <h2>${escHtml(title)}${year ? ` <span class="streaming-year">(${year})</span>` : ''}</h2>
                    <div class="streaming-meta">
                        ${rating ? `<span class="gold"><i class="fas fa-star"></i> ${parseFloat(rating).toFixed(1)}/10</span>` : ''}
                        ${meta ? `<span><i class="fas fa-info-circle"></i> ${escHtml(String(meta))}</span>` : ''}
                    </div>
                    <p class="streaming-overview">${escHtml(overview || '')}</p>
                </div>
            </div>
        </div>
    `;
}

// Streaming-info skeleton — mirrors buildStreamingInfo()'s exact markup
// (backdrop / poster / title / meta / overview) so nothing shifts when
// the real details replace it.
function renderStreamingSkeleton() {
    return `
        <div class="streaming-hero skeleton-hero">
            <div class="streaming-hero-overlay"></div>
            <div class="streaming-hero-content">
                <div class="skel streaming-poster"></div>
                <div class="streaming-details" aria-hidden="true">
                    <div class="skel skel-line" style="width:55%;height:22px;margin-bottom:12px"></div>
                    <div class="skel skel-line" style="width:35%;height:13px;margin-bottom:12px"></div>
                    <div class="skel skel-line" style="width:100%"></div>
                    <div class="skel skel-line" style="width:96%"></div>
                    <div class="skel skel-line" style="width:70%"></div>
                </div>
            </div>
        </div>
    `;
}


// EMBEDDED providers list. Rendering this NEVER plays anything — unlike
// the old behavior, an embedded provider is only ever loaded when the
// user explicitly clicks its card (rule: embedded sources must always be
// manually selected, never auto-selected/auto-fallback-to).
function renderSources(imdb, type, season, episode, lastSource) {
    sourcesGrid.innerHTML = '';
    sourceCountBadge.textContent = `${SOURCES.length} players`;
    const tmdbId = currentItem?.id;

    SOURCES.forEach(source => {
        const card = document.createElement('div');
        card.className = 'source-card';
        if (lastSource === source.name) card.classList.add('last-used');
        card.innerHTML = `
            ${source.recommended ? '<span class="source-star"><i class="fas fa-star"></i></span>' : ''}
            <div class="source-card-name">${escHtml(source.name)}</div>
            <div class="source-card-cta"><i class="fas fa-play-circle"></i> Click to play</div>
        `;
        card.addEventListener('click', () => playSource(source, tmdbId));
        sourcesGrid.appendChild(card);
    });
}

// ── DIRECT SOURCES (Stremio addons) ──────────────────
// Queries all enabled direct addons concurrently, ranks the results, and
// — unlike embedded providers — auto-loads the top pick into CineHub's
// own player. Automatic fallback on playback failure only ever moves to
// the next DIRECT stream (handled inside CineHubPlayer); if every direct
// stream fails, playback simply stops and the embedded list below remains
// available for the user to pick from manually.
async function renderDirectSources(request, resumeSeconds) {
    directSourcesGrid.innerHTML = '';
    directSourcesEmpty.style.display = 'none';
    directSourceCountBadge.textContent = 'Finding best source…';
    directSourcesGrid.innerHTML = `<div class="sources-empty-msg"><i class="fas fa-spinner fa-spin"></i> Finding best source…</div>`;

    let top = [];
    try {
        top = await window.CineHubDirectStreaming.StreamingManager.getDirectStreams(request);
    } catch (e) {
        console.error('Direct source query failed', e);
    }

    // Stale response guard — the user may have switched episodes/closed
    // the modal while addons were still being queried.
    if (!currentItem || currentItem.imdb_id !== request.imdbId ||
        currentItem.media_type !== request.type ||
        (request.type === 'tv' && (currentItem.season != request.season || currentItem.episode != request.episode))) {
        return;
    }

    directSourcesGrid.innerHTML = '';

    if (!top.length) {
        directSourceCountBadge.textContent = '0 sources';
        directSourcesEmpty.style.display = 'block';
        directPlayerWrap.style.display = 'none';
        return;
    }

    directSourceCountBadge.textContent = `${top.length} sources`;
    top.forEach((stream, i) => {
        const card = document.createElement('div');
        card.className = 'source-card direct-card';
        card.innerHTML = `
            ${i === 0 ? '<span class="source-star"><i class="fas fa-star"></i></span>' : ''}
            <div class="source-card-name">${escHtml(stream.provider)}</div>
            <div class="source-card-sub">${stream.quality ? stream.quality + 'p · ' : ''}${escHtml(stream.streamType.toUpperCase())}${stream.language ? ' · ' + escHtml(stream.language) : ''}</div>
            <div class="source-card-cta"><i class="fas fa-play-circle"></i> Click to play</div>
        `;
        card.addEventListener('click', () => loadDirectStreams(top, i, 0));
        directSourcesGrid.appendChild(card);
    });

    // Auto-load the top-ranked direct stream (top3 fallback chain starts here).
    loadDirectStreams(top, 0, resumeSeconds || 0);
}

function loadDirectStreams(streams, startIndex, resumeSeconds) {
    if (!streams.length) return;

    // Switching into DIRECT mode — destroy any active embedded iframe
    // first so only one player is ever active at a time (rule #14).
    playerWrap.style.display = 'none';
    playerIframeWrap.innerHTML = '';
    pendingPlayback = null;
    stopSubtitles();
    stopProgressTracking();

    // Reorder so the chosen card plays first, but keep the rest as its
    // automatic-fallback chain (still direct-only fallback).
    const ordered = streams.slice(startIndex).concat(streams.slice(0, startIndex));

    if (!directPlayer) {
        directPlayer = new window.CineHubPlayer(directPlayerContainer, {
            onAllFailed: () => {
                notify('All direct sources failed — pick an embedded player below', 'warning');
            },
            onProgress: (t, d) => {
                if (!currentItem || !d) return;
                currentItem.progress = Math.max(currentItem.progress || 0, Math.min(96, (t / d) * 100));
                currentItem.lastSource = 'direct';
                saveContinue(currentItem, 'direct');
            },
            onEnded: () => {
                if (currentItem?.media_type === 'tv') navigateEpisode(1); // auto-next episode
            },
            // Direct addons almost never return subtitle URLs themselves, so
            // this is what actually powers the CC menu's "search" entries —
            // reuses the same Subdl lookup as the rest of CineHub, converted
            // to a WebVTT blob the <video> element's native <track> can use.
            onSearchSubtitles: (langLabel) => searchDirectPlayerSubtitles(langLabel)
        });
    }
    directPlayerWrap.style.display = 'block';
    directPlayer.load(ordered, { resumeSeconds: resumeSeconds || 0 });
    directNowPlayingLabel.textContent = currentItem?.title || currentItem?.name || 'Now Playing';
    directActiveSourceName.textContent = ordered[0].provider;
    currentItem.lastSource = 'direct';
    saveContinue(currentItem, 'direct');
}

function playSource(source, tmdbId) {
    if (!currentItem) return;
    const url = source.getUrl(currentItem.imdb_id, currentItem.media_type, currentItem.season, currentItem.episode, tmdbId || currentItem.id);
    if (!url) { notify(`${source.name} unavailable for this title`, 'warning'); return; }

    // Switching into EMBEDDED mode — destroy the direct player first so
    // only one player is ever active at a time (rule #14).
    if (directPlayer) { directPlayer.destroy(); directPlayer = null; }
    directPlayerWrap.style.display = 'none';
    if (diagnosticsPanel) diagnosticsPanel.style.display = 'none';

    playerWrap.style.display = 'block';
    // Don't set the iframe src yet — show a facade first. This stops
    // third-party ad/popup scripts from firing on load or on incidental
    // hover; the real iframe is only created once the user clicks Play
    // (see loadPendingSource).
    pendingPlayback = { source, url };
    playerIframeWrap.innerHTML = `
        <div class="player-facade" onclick="loadPendingSource()">
            <div class="player-facade-btn"><i class="fas fa-play"></i></div>
            <div class="player-facade-label">Click to play via ${escHtml(source.name)}</div>
        </div>
    `;
    nowPlayingLabel.textContent = currentItem.title || currentItem.name || 'Now Playing';
    activeSourceName.textContent = source.name;
    if (activeQuality) activeQuality.textContent = '';
    currentItem.lastSource = source.name;
    playerWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    // Save to continue watching
    saveContinue(currentItem, source.name);
}

// Actually loads the iframe for the pending source. Only runs on an
// explicit user click on the facade button.
//
// Two-stage load, deliberately: creating the iframe synchronously inside
// the click handler and pointing it straight at the ad-supported source
// lets that source's on-load popup script inherit the click's "user
// activation" state, so the browser treats its window.open() as
// legitimate and lets it through — even though the user never actually
// clicked inside that page. Loading a blank iframe first, then setting
// the real src from a setTimeout callback (a separate task), breaks that
// inheritance: by the time the source's script runs there's no live user
// gesture for it to ride, so its popup call gets blocked like any other
// unsolicited one.
window.loadPendingSource = function() {
    if (!pendingPlayback) return;
    const { source, url } = pendingPlayback;
    playerIframeWrap.innerHTML = `
        <iframe id="active-player-iframe" src="about:blank" allowfullscreen scrolling="no"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            frameborder="0"></iframe>
    `;
    const iframe = $('active-player-iframe');
    setTimeout(() => { if (iframe) iframe.src = url; }, 60);
    notify(`Streaming via ${source.name}`, 'success');
    // Start tracking real elapsed watch time so the progress bar actually
    // advances instead of staying frozen (see startProgressTracking).
    startProgressTracking();
    pendingPlayback = null;
};

// ── WATCH PROGRESS TRACKING ──────────────────────────
// The video itself plays inside a cross-origin third-party iframe, so we
// can't read its actual playhead position. Instead we estimate progress
// from real elapsed wall-clock time against the title's known runtime
// (TMDB movie runtime / episode runtime), continuing on from wherever the
// saved progress left off. This runs on an interval while a source is
// actively playing and persists periodically to Continue Watching.
const PROGRESS_TICK_MS = 15000; // how often we re-estimate + save progress
const DEFAULT_MOVIE_RUNTIME_MIN = 100; // fallback when TMDB has no runtime
const DEFAULT_EPISODE_RUNTIME_MIN = 30;

function startProgressTracking() {
    stopProgressTracking();
    if (!currentItem) return;
    progressRuntimeMin = currentItem.runtimeMin ||
        (currentItem.media_type === 'movie' ? DEFAULT_MOVIE_RUNTIME_MIN : DEFAULT_EPISODE_RUNTIME_MIN);
    progressBaseMin = ((currentItem.progress || 0) / 100) * progressRuntimeMin;
    progressStartedAt = Date.now();
    progressTimer = setInterval(updateWatchProgress, PROGRESS_TICK_MS);
}

function stopProgressTracking() {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = null;
    progressStartedAt = null;
}

function updateWatchProgress() {
    if (!currentItem || !progressStartedAt) return;
    const elapsedMin = (Date.now() - progressStartedAt) / 60000;
    const pct = Math.min(96, ((progressBaseMin + elapsedMin) / progressRuntimeMin) * 100);
    // Progress only ever moves forward within a session.
    currentItem.progress = Math.max(currentItem.progress || 0, pct);
    saveContinue(currentItem, currentItem.lastSource);
}

function saveContinue(item, sourceName) {
    const isMovie = item.media_type === 'movie';
    const entry = {
        id:          item.id,
        type:        isMovie ? 'movie' : 'tv',
        title:       item.title || item.name || 'Unknown',
        poster_path: item.poster_path || null,
        progress:    item.progress ?? 5,
        lastSource:  sourceName,
        lastWatched: new Date().toISOString(),
        ...(isMovie ? {} : {
            season:  item.season  || 1,
            episode: item.episode || 1,
        }),
    };
    continueWatching = continueWatching.filter(x => !(x.id == entry.id && x.type === entry.type));
    continueWatching.unshift(entry);
    if (continueWatching.length > 20) continueWatching = continueWatching.slice(0, 20);
    localStorage.setItem('ch_continue', JSON.stringify(continueWatching));
}




// ══════════════════════════════════════════
// SUBTITLE SYSTEM — Subdl API
// ══════════════════════════════════════════
const SUBDL_KEY = 'UMHVfbgFcp-WFDQVt3PfmWK4zZrj96Gl';
let subtitleCues    = [];
let subtitleTimer   = null;
let subtitleOffset  = 0;
let subtitleVisible = true;
let subtitleStartMs = 0;
let subtitleRunning = false;

function toggleSubtitlePanel() {
    const panel = $('subtitle-panel');
    const ccBtn = document.querySelector('.cc-btn');
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'block';
    if (ccBtn) ccBtn.classList.toggle('active', !isOpen);
}

function toggleSubtitles() {
    subtitleVisible = !subtitleVisible;
    $('subtitle-overlay').style.display = subtitleVisible ? 'block' : 'none';
    $('subtitle-toggle-label').textContent = subtitleVisible ? 'Hide Subtitles' : 'Show Subtitles';
}

function adjustOffset(val) {
    subtitleOffset += val;
    $('offset-display').textContent = subtitleOffset.toFixed(1) + 's';
}

function applySubtitleTime() {
    const raw = $('subtitle-start-time').value.trim();
    const parts = raw.split(':').map(Number);
    let ms = 0;
    if (parts.length === 2) ms = (parts[0] * 60 + parts[1]) * 1000;
    else if (parts.length === 3) ms = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    subtitleStartMs = Date.now() - ms;
    $('subtitle-status').textContent = `▶ Subtitles synced from ${raw}`;
    $('subtitle-status').style.color = '#4cbb5c';
}

// Shared network+parse logic — used by both the embedded-provider subtitle
// panel (wall-clock synced, since that video lives in a cross-origin
// iframe) and the direct player (synced to real video.currentTime).
// Returns a parsed cues array (possibly empty); throws on network failure.
async function fetchSubtitleCuesForCurrentItem(lang) {
    if (!currentItem) return [];
    const isMovie = currentItem.media_type === 'movie';
    const tmdbId  = currentItem.id;
    let url = `https://api.subdl.com/api/v1/subtitles?api_key=${SUBDL_KEY}&languages=${lang}&subs_per_page=10&full_season=false`;
    if (isMovie) {
        url += `&tmdb_id=${tmdbId}&type=movie`;
    } else {
        url += `&tmdb_id=${tmdbId}&type=tv&season_number=${currentItem.season}&episode_number=${currentItem.episode}`;
    }

    const res  = await fetch(url);
    const data = await res.json();
    if (!data.subtitles || !data.subtitles.length) return [];

    for (const sub of data.subtitles) {
        if (!sub.url) continue;
        try {
            const rawUrl = `https://dl.subdl.com${sub.url}`;
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`;
            const srtRes  = await fetch(proxyUrl);
            const srtText = await srtRes.text();
            const parsed = parseSRT(srtText);
            if (parsed.length > 0) return parsed;
        } catch (e) { continue; }
    }
    return [];
}

// ── Subtitle search for the DIRECT (custom) player ──
// Converts the same Subdl-sourced cues into a real WebVTT track so the
// native <video> element can render them via <track>, instead of the
// wall-clock overlay hack the embedded/iframe player has to use.
const SUBDL_LANG_CODES = {
    'English': 'EN', 'Hindi': 'HI', 'Spanish': 'ES', 'French': 'FR', 'Arabic': 'AR', 'German': 'DE'
};

async function searchDirectPlayerSubtitles(langLabel) {
    const code = SUBDL_LANG_CODES[langLabel] || langLabel;
    const cues = await fetchSubtitleCuesForCurrentItem(code);
    if (!cues.length) return null;
    const vtt = cuesToVTT(cues);
    const blob = new Blob([vtt], { type: 'text/vtt' });
    return URL.createObjectURL(blob);}

function cuesToVTT(cues) {
    let out = 'WEBVTT\n\n';
    cues.forEach((c, i) => {
        out += `${i + 1}\n${msToVttTime(c.start)} --> ${msToVttTime(c.end)}\n${c.text}\n\n`;
    });
    return out;
}

function msToVttTime(ms) {
    ms = Math.max(0, ms);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const rem = Math.floor(ms % 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(rem).padStart(3, '0')}`;
}

async function loadSubtitles() {
    if (!currentItem) return;
    const btn = $('load-subtitle-btn');
    const lang = $('subtitle-lang').value;
    const statusEl = $('subtitle-status');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading…';
    btn.disabled = true;
    statusEl.textContent = '';

    try {
        const parsed = await fetchSubtitleCuesForCurrentItem(lang);

        if (!parsed.length) {
            statusEl.textContent = '✗ No subtitles found — try another language';
            statusEl.style.color = 'var(--accent)';
        } else {
            subtitleCues    = parsed;
            subtitleOffset  = 0;
            subtitleStartMs = Date.now();
            subtitleVisible = true;
            $('offset-display').textContent = '0s';
            $('subtitle-overlay').style.display = 'block';
            $('subtitle-on-btn').style.display  = 'block';
            $('subtitle-toggle-label').textContent = 'Hide Subtitles';
            statusEl.textContent = `✓ ${parsed.length} cues loaded`;
            statusEl.style.color = '#4cbb5c';
            startSubtitleTimer();
        }
    } catch(e) {
        statusEl.textContent = '✗ Failed — check connection';
        statusEl.style.color = 'var(--accent)';
        console.error('Subtitle error:', e);
    }

    btn.innerHTML = '<i class="fas fa-download"></i> Load Subtitles';
    btn.disabled = false;
}

function parseSRT(raw) {
    const cues = [];
    // Handle both zip-extracted text and raw SRT
    // Normalize all line endings
    const text = raw
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // Remove BOM
        .replace(/^\uFEFF/, '')
        .trim();

    // Split into blocks by double newline
    const blocks = text.split(/\n{2,}/);

    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 2) continue;

        // Find the timestamp line (contains -->)
        const tsIdx = lines.findIndex(l => l.includes('-->'));
        if (tsIdx === -1) continue;

        const tsLine = lines[tsIdx];
        const arrow  = tsLine.indexOf('-->');
        const start  = srtTimeToMs(tsLine.slice(0, arrow).trim());
        const end    = srtTimeToMs(tsLine.slice(arrow + 3).trim());

        if (isNaN(start) || isNaN(end)) continue;

        // All lines after timestamp = subtitle text
        const text = lines
            .slice(tsIdx + 1)
            .join('\n')
            .replace(/<[^>]+>/g, '')       // strip HTML tags like <i>
            .replace(/\{[^}]+\}/g, '')      // strip ASS/SSA tags like {\an8}
            .replace(/^- /gm, '')           // strip leading dashes
            .trim();

        if (text) cues.push({ start, end, text });
    }
    return cues;
}

function srtTimeToMs(t) {
    const clean = t.replace(/,/g, '.');
    const parts = clean.split(':');
    if (parts.length !== 3) return 0;
    const [h, m, s] = parts.map(Number);
    return Math.round((h * 3600 + m * 60 + s) * 1000);
}

function startSubtitleTimer() {
    if (subtitleTimer) clearInterval(subtitleTimer);
    subtitleRunning = true;
    subtitleTimer = setInterval(() => {
        if (!subtitleRunning || !subtitleCues.length) return;
        const elapsed = Date.now() - subtitleStartMs + (subtitleOffset * 1000);
        const cue = subtitleCues.find(c => elapsed >= c.start && elapsed <= c.end);
        const el  = $('subtitle-text');
        if (cue) {
            el.innerHTML = cue.text.replace(/\n/g, '<br>');
            el.style.display = 'block';
        } else {
            el.style.display = 'none';
        }
    }, 100);
}

function stopSubtitles() {
    if (subtitleTimer) clearInterval(subtitleTimer);
    subtitleTimer   = null;
    subtitleRunning = false;
    subtitleCues    = [];
    subtitleOffset  = 0;
    subtitleStartMs = 0;
    const overlay = $('subtitle-overlay');
    const panel   = $('subtitle-panel');
    const onBtn   = $('subtitle-on-btn');
    const status  = $('subtitle-status');
    if (overlay) { overlay.style.display = 'none'; }
    if (panel)   { panel.style.display   = 'none'; }
    if (onBtn)   { onBtn.style.display   = 'none'; }
    if (status)  { status.textContent    = '';     }
}

window.toggleSubtitlePanel = toggleSubtitlePanel;
window.toggleSubtitles     = toggleSubtitles;
window.adjustOffset        = adjustOffset;
window.applySubtitleTime   = applySubtitleTime;
window.loadSubtitles       = loadSubtitles;
async function showSimilar(id, type) {
    // Same skeleton-first pattern as showCast — modal responds instantly.
    renderSkeletonCards(similarGrid, 8);
    $('similar-title').innerHTML = `<i class="fas fa-film"></i> Similar ${type === 'movie' ? 'Movies' : 'TV Shows'}`;
    openModal(similarModal);
    try {
        const d = await api(`${type}/${id}/similar`);
        similarGrid.innerHTML = '';
        if (!d.results.length) {
            similarGrid.innerHTML = emptyState('No similar content found');
        } else {
            const frag = document.createDocumentFragment();
            d.results.slice(0, 12).forEach(item => frag.appendChild(createSimilarCard(item, type)));
            similarGrid.appendChild(frag);
        }
    } catch { notify('Failed to load similar', 'error'); closeModal(similarModal); }
}

// Cards inside similar modal close the modal before opening stream
function createSimilarCard(item, type) {
    const card = createCard(item, type);
    // Override watch button to close similar modal first
    const watchBtn = card.querySelector('.btn-watch');
    const poster   = card.querySelector('.poster');
    const isMovie  = type === 'movie';

    const playAction = () => {
        closeModal(similarModal);
        if (isMovie) window.openMovieStream(item.id);
        else window.openTVEpisodes(item.id);
    };

    if (watchBtn) {
        watchBtn.replaceWith(watchBtn.cloneNode(true));
        card.querySelector('.btn-watch').addEventListener('click', e => {
            e.stopPropagation();
            playAction();
        });
    }
    if (poster) {
        poster.replaceWith(poster.cloneNode(true));
        card.querySelector('.poster').addEventListener('click', playAction);
    }
    return card;
}

// Cast modal skeleton — mirrors the real .cast-card layout exactly.
function renderCastSkeleton(count = 12) {
    return `
        <h2 class="modal-title"><i class="fas fa-users"></i> Cast</h2>
        <div class="cast-grid" aria-busy="true">
            ${Array.from({ length: count }).map(() => `
                <div class="cast-card skeleton-cast" aria-hidden="true">
                    <div class="skel cast-img"></div>
                    <div class="cast-card-info">
                        <div class="skel skel-line" style="width:75%"></div>
                        <div class="skel skel-line" style="width:50%;height:10px"></div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

async function showCast(id, type) {
    // Open immediately with a skeleton so the modal responds instantly,
    // then swap in the real cast once the request resolves.
    castDetails.innerHTML = renderCastSkeleton();
    openModal(castModal);
    try {
        const d = await api(`${type}/${id}/credits`);
        castDetails.innerHTML = `
            <h2 class="modal-title"><i class="fas fa-users"></i> Cast (${d.cast.length})</h2>
            <div class="cast-grid">
                ${d.cast.slice(0, 30).map(p => `
                    <div class="cast-card"
                         data-person-id="${p.id}"
                         data-person-name="${escAttr(p.name)}"
                         data-type="${type}">
                        <img src="${p.profile_path ? IMG + 'w185' + p.profile_path : PLACEHOLDER_AC}"
                             alt="${escHtml(p.name)}" class="cast-img"
                             onerror="this.src='${PLACEHOLDER_AC}'">
                        <div class="cast-card-info">
                            <div class="cast-name">${escHtml(p.name)}</div>
                            <div class="cast-character">${escHtml(p.character || '')}</div>
                            <span class="cast-search-hint"><i class="fas fa-search"></i> View filmography</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        // Attach listeners after rendering — no inline onclick, no apostrophe bug
        castDetails.querySelectorAll('.cast-card').forEach(card => {
            card.addEventListener('click', () => {
                const personId = card.dataset.personId;
                const personName = card.dataset.personName;
                const cardType = card.dataset.type;
                searchPersonFromCast(personId, personName, cardType);
            });
        });

    } catch { notify('Failed to load cast', 'error'); closeModal(castModal); }
}

window.searchPersonFromCast = async function(personId, name, type) {
    closeModal(castModal);
    const section = type === 'movie' ? 'movie' : 'tv';
    const isMovie = section === 'movie';
    if (isMovie) showLoading(movieLoading, movieGrid); else showLoading(tvLoading, tvGrid);
    try {
        const credits = await api(`person/${personId}/${isMovie ? 'movie' : 'tv'}_credits`);
        const items = credits.cast.sort((a, b) => b.popularity - a.popularity);
        if (isMovie) {
            movieResults = []; movieGrid.innerHTML = '';
            items.forEach(m => movieGrid.appendChild(createCard(m, 'movie')));
            movieLoadMore.style.display = 'none';
        } else {
            tvResults = []; tvGrid.innerHTML = '';
            items.forEach(s => tvGrid.appendChild(createCard(s, 'tv')));
            tvLoadMore.style.display = 'none';
        }
        switchSection(isMovie ? 'movies' : 'tvshows');
        notify(`${items.length} titles found for ${name}`, 'success');
    } catch { notify('Failed to load filmography', 'error'); }
    finally {
        // Ensures skeleton cards never get stuck if the request fails
        if (isMovie) hideLoading(movieLoading, movieGrid); else hideLoading(tvLoading, tvGrid);
    }
};

// ── WATCHLIST ─────────────────────────────────────────
function toggleWatchlist(id, type, data) {
    if (isInWatchlist(id)) {
        watchlist = watchlist.filter(x => x.id != id);
        notify('Removed from watchlist', 'info');
    } else {
        watchlist.push({ id, type, ...data });
        notify('Added to watchlist', 'success');
    }
    localStorage.setItem('ch_watchlist', JSON.stringify(watchlist));
    updateWatchlistBtns();
}

function isInWatchlist(id) { return watchlist.some(x => x.id == id); }

function updateWatchlistBtns() {
    $$('.watchlist-btn').forEach(btn => {
        const added = isInWatchlist(btn.dataset.id);
        btn.classList.toggle('added', added);
        btn.innerHTML = `<i class="fas fa-${added ? 'check' : 'bookmark'}"></i>`;
    });
}

function openWatchlist() {
    watchlistGrid.innerHTML = '';
    if (!watchlist.length) {
        watchlistGrid.innerHTML = emptyState('Your watchlist is empty', 'fas fa-bookmark', 'Start adding movies and TV shows');
    } else {
        const frag = document.createDocumentFragment();
        watchlist.forEach(item => frag.appendChild(createCard(item, item.type)));
        watchlistGrid.appendChild(frag);
    }
    openModal(watchlistModal);
}

// ── STATISTICS DASHBOARD ─────────────────────────────
// New feature. Reads only the existing `watchlist` / `continueWatching`
// state (same arrays used everywhere else) — no new data structures,
// and stats are computed synchronously, only when the modal is opened.
function openStats() {
    const stats = calculateStats();
    renderStats(stats);
    openModal(statsModal);
}

function calculateStats() {
    if (!watchlist.length && !continueWatching.length) return null; // triggers empty state

    const movieHistory = continueWatching.filter(c => c.type === 'movie');
    const tvHistory     = continueWatching.filter(c => c.type === 'tv');

    // TV episodes watched — derived from each show's last-viewed episode number
    // (continueWatching stores the furthest episode reached per show)
    const tvEpisodesWatched = tvHistory.length
        ? tvHistory.reduce((sum, c) => sum + (c.episode || 1), 0)
        : null;

    // Recently viewed — continue-watching items touched in the last 7 days
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentlyViewedCount = continueWatching.filter(
        c => c.lastWatched && new Date(c.lastWatched).getTime() >= weekAgo
    ).length;

    // Favorite genre — genre_ids only exist on Watchlist entries locally
    const genreCount = {};
    watchlist.forEach(w => (w.genre_ids || []).forEach(id => { genreCount[id] = (genreCount[id] || 0) + 1; }));
    const topGenreId = Object.keys(genreCount).sort((a, b) => genreCount[b] - genreCount[a])[0];
    const favoriteGenre = topGenreId ? (movieGenreMap[topGenreId] || tvGenreMap[topGenreId] || null) : null;

    // Total unique titles saved across Watchlist + Continue Watching
    const uniqueKeys = new Set([
        ...watchlist.map(w => `${w.type}_${w.id}`),
        ...continueWatching.map(c => `${c.type}_${c.id}`),
    ]);

    return {
        moviesWatched:          movieHistory.length,
        tvEpisodesWatched,                    // null → "No Data Yet"
        watchlistCount:         watchlist.length,
        continueWatchingCount:  continueWatching.length,
        recentlyViewedCount,
        favoriteGenre,                        // null → "No Data Yet"
        totalTitlesSaved:       uniqueKeys.size,
    };
}

function renderStats(stats) {
    statsGrid.innerHTML = '';
    if (!stats) {
        statsGrid.innerHTML = emptyState(
            'No statistics yet',
            'fas fa-chart-bar',
            'Start watching movies and TV shows to see your statistics.'
        );
        return;
    }

    const cards = [
        { icon: 'fas fa-film',          label: 'Movies Watched',        value: stats.moviesWatched },
        { icon: 'fas fa-tv',            label: 'TV Episodes Watched',   value: stats.tvEpisodesWatched },
        { icon: 'fas fa-bookmark',      label: 'Watchlist Count',       value: stats.watchlistCount },
        { icon: 'fas fa-play-circle',   label: 'Continue Watching',     value: stats.continueWatchingCount },
        { icon: 'fas fa-clock',         label: 'Recently Viewed',       value: stats.recentlyViewedCount },
        { icon: 'fas fa-heart',         label: 'Favorite Genre',        value: stats.favoriteGenre },
        { icon: 'fas fa-layer-group',   label: 'Total Titles Saved',    value: stats.totalTitlesSaved },
    ];

    const frag = document.createDocumentFragment();
    cards.forEach((c, i) => {
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.style.animationDelay = `${i * 0.05}s`;
        const isNumber = typeof c.value === 'number';
        const noData = c.value === null || c.value === undefined;
        card.innerHTML = `
            <div class="stat-card-icon"><i class="${c.icon}"></i></div>
            <div class="stat-card-value ${noData ? 'no-data' : ''}">${noData ? 'No Data Yet' : (isNumber ? '0' : escHtml(c.value))}</div>
            <div class="stat-card-label">${escHtml(c.label)}</div>
        `;
        frag.appendChild(card);
        if (isNumber && !noData) animateCounter(card.querySelector('.stat-card-value'), c.value);
    });
    statsGrid.appendChild(frag);
}

// Lightweight count-up animation for numeric stat cards
function animateCounter(el, target, duration = 700) {
    if (!target) { el.textContent = '0'; return; }
    const start = performance.now();
    function tick(now) {
        const progress = Math.min((now - start) / duration, 1);
        el.textContent = Math.round(progress * target);
        if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

// ── CONTINUE WATCHING ────────────────────────────────
function openContinue() {
    continueGrid.innerHTML = '';
    const sorted = [...continueWatching].sort((a, b) => new Date(b.lastWatched) - new Date(a.lastWatched));
    if (!sorted.length) {
        continueGrid.innerHTML = emptyState('Nothing in progress', 'fas fa-play-circle', 'Start watching something!');
    } else {
        sorted.forEach(item => continueGrid.appendChild(createContinueCard(item)));
    }
    openModal(continueModal);
}

function createContinueCard(item) {
    const card = document.createElement('div');
    card.className = 'content-card';
    const poster = item.poster_path ? `${IMG}w500${item.poster_path}` : PLACEHOLDER;
    card.innerHTML = `
        <img src="${poster}" alt="${escHtml(item.title)}" class="poster" loading="lazy"
             onerror="this.src='${PLACEHOLDER}'">
        <div class="card-info">
            <div class="card-title">${escHtml(item.title)}</div>
            <div class="card-meta">
                ${item.type === 'tv' ? `<span class="card-year">S${item.season} E${item.episode}</span>` : '<span class="card-year">Movie</span>'}
                ${item.lastSource ? `<span class="card-rating" style="color:var(--text-muted);font-size:10px">${escHtml(item.lastSource)}</span>` : ''}
            </div>
            <div class="continue-bar">
                <div class="progress-bar-mini"><div class="progress-bar-mini-fill" style="width:${Math.max(item.progress ?? 5, 2)}%"></div></div>
                <span style="font-size:10px;color:#555566;flex-shrink:0">${Math.round(item.progress ?? 5)}%</span>
            </div>
        </div>
        <div class="card-actions">
            <button class="btn-watch" onclick="resumeItem(${item.id}, '${item.type}', '${item.lastSource || ''}')">
                <i class="fas fa-play"></i> Resume
            </button>
            <button class="btn-icon" onclick="removeContinue(${item.id}, '${item.type}')" title="Remove">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `;
    return card;
}

window.resumeItem = function(id, type, lastSource) {
    closeModal(continueModal);
    if (type === 'movie') openMovieStream(id);
    else openTVEpisodes(id);
};

window.removeContinue = function(id, type) {
    continueWatching = continueWatching.filter(x => !(x.id == id && x.type === type));
    localStorage.setItem('ch_continue', JSON.stringify(continueWatching));
    openContinue();
    notify('Removed', 'info');
};

// ── MODAL HELPERS ────────────────────────────────────
function openModal(modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeModal(modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

function closeStreamingModal() {
    closeModal(streamingModal);
    stopStreaming();
}

window.stopStreaming = function() {
    playerWrap.style.display = 'none';
    playerIframeWrap.innerHTML = '';
    stopSubtitles();
    stopProgressTracking();
    pendingPlayback = null;

    // Prevent multiple players from playing simultaneously — destroy the
    // direct (CineHubPlayer) instance whenever the embedded/iframe flow
    // stops, and vice versa (see playSource below).
    if (directPlayer) { directPlayer.destroy(); directPlayer = null; }
    directPlayerWrap.style.display = 'none';
    if (diagnosticsPanel) diagnosticsPanel.style.display = 'none';
};

window.toggleFullscreen = function() {
    const iframe = playerIframeWrap.querySelector('iframe');
    if (!iframe) return;
    (iframe.requestFullscreen || iframe.webkitRequestFullscreen || iframe.msRequestFullscreen)?.call(iframe);
};

// ── SECTION SWITCHING ─────────────────────────────────
window.switchSection = function(section) {
    moviesSection.classList.toggle('active', section === 'movies');
    tvSection.classList.toggle('active', section === 'tvshows');
    $$('.nav-btn[data-section]').forEach(btn => btn.classList.toggle('active', btn.dataset.section === section));
};

// ── UTILS ────────────────────────────────────────────
// ── SKELETON LOADING ──────────────────────────────────
// Reusable card skeleton — reuses createCard()'s exact DOM structure
// (.content-card > poster / .card-info / .card-actions) so grid
// columns/gaps never shift when real cards replace it.
function createSkeletonCard() {
    const card = document.createElement('div');
    card.className = 'content-card skeleton-card';
    card.setAttribute('aria-hidden', 'true'); // decorative — screen readers skip it
    card.innerHTML = `
        <div class="skel poster"></div>
        <div class="card-info">
            <div class="skel skel-line skel-title"></div>
            <div class="skel skel-line" style="width:55%"></div>
            <div class="card-meta">
                <div class="skel skel-chip"></div>
                <div class="skel skel-chip"></div>
            </div>
        </div>
        <div class="card-actions">
            <div class="skel skel-btn"></div>
            <div class="skel skel-icon"></div>
        </div>
    `;
    return card;
}

// Fills a grid/row container with skeleton cards. Marks the region
// aria-busy so assistive tech knows content is still loading.
function renderSkeletonCards(container, count = 10) {
    container.setAttribute('aria-busy', 'true');
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) frag.appendChild(createSkeletonCard());
    container.innerHTML = '';
    container.appendChild(frag);
}

function showLoading(loadEl, gridEl) {
    // Skeleton cards (rendered directly in the grid) are now the loading
    // indicator, so sizing/columns exactly match the real content and
    // there's no layout shift. The old spinner element is kept in the
    // DOM (untouched) but no longer shown.
    loadEl.classList.add('hidden');
    gridEl.style.display = 'grid';
    renderSkeletonCards(gridEl);
}

function hideLoading(loadEl, gridEl) {
    loadEl.classList.add('hidden');
    gridEl.style.display = 'grid';
    gridEl.removeAttribute('aria-busy');
    // Safety net: if a fetch failed before a render() call could replace
    // them, leftover skeletons still get cleared here.
    gridEl.querySelectorAll('.skeleton-card').forEach(el => el.remove());
}

function resetSearchInput(input, suggEl) {
    input.value = '';
    suggEl.style.display = 'none';
    suggEl.innerHTML = '';
}

function emptyState(msg, icon = 'fas fa-film', sub = '') {
    return `<div class="empty-state" style="grid-column:1/-1">
        <i class="${icon}"></i>
        <h3>${escHtml(msg)}</h3>
        ${sub ? `<p>${escHtml(sub)}</p>` : ''}
    </div>`;
}

let notifTimer;
function notify(msg, type = 'info') {
    notification.textContent = msg;
    notification.className = `notification show ${type}`;
    clearTimeout(notifTimer);
    notifTimer = setTimeout(() => notification.classList.remove('show'), 3000);
}

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Safe for use inside HTML attribute values (data-* etc.)
function escAttr(str) {
    if (!str) return '';
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ── START ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);